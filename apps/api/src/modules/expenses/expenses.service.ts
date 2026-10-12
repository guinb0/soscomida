import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  type AppealInput,
  type AttachDocumentInput,
  type Assessment,
  type CampaignTransparency,
  type ExpenseInput,
  type ExpenseQueueItem,
  type ExpenseReviewDecision,
  type ExpenseStatus,
  type FiscalKeyInput,
  type ModerationExpense,
  type OwnedExpense,
  type PublicExpense,
  type UpdateExpenseInput,
} from '@soscomida/contracts';
import { publicSupplierDocument } from '@soscomida/shared';
import { and, asc, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { DB, type Database, type Executor, isUniqueViolation } from '../../infra/db/db';
import { DomainError, conflict, forbidden, notFound, versionConflict } from '../../infra/http/errors';
import { newId } from '../../infra/ids';
import { detectSuspiciousInstructions } from '../ai';
import { AuditService } from '../audit';
import { ACCOUNTABLE_STATUSES, type AccountabilityTarget, CampaignsService } from '../campaigns';
import { type Extraction, type FiscalDocumentView, FiscalService } from '../fiscal';
import { type AuthContext, IdentityService } from '../identity';
import { OutboxService } from '../outbox';
import { StorageService } from '../storage';
import {
  COUNTED_STATUSES,
  type ExpenseAction,
  aggregateFiscalCheck,
  computeFlags,
  expenseTransition,
  initialAssessment,
} from './domain/expense-rules';
import { expenseDocuments, expenseStatusHistory, expenses } from './infra/expenses.schema';

type ExpenseRow = typeof expenses.$inferSelect;
type DocRow = typeof expenseDocuments.$inferSelect;

export const EXPENSE_EVENTS = {
  statusChanged: 'ExpenseStatusChanged',
} as const;

/** Status visíveis ao público: tudo o que foi enviado para revisão. */
const PUBLIC_STATUSES: ExpenseStatus[] = ['SUBMITTED', 'IN_REVIEW', 'APPROVED', 'REJECTED'];

const TRANSITION_ERRORS = {
  INVALID_TRANSITION: () => new DomainError('INVALID_TRANSITION', 'Esta ação não é permitida no status atual da despesa', HttpStatus.CONFLICT),
  ACTOR_NOT_ALLOWED: () => forbidden('Você não pode executar esta ação nesta despesa'),
  REASON_REQUIRED: () => new DomainError('REASON_REQUIRED', 'Informe a justificativa'),
};

const docKindToAssessment = { PAYMENT_PROOF: 'paymentProof', DELIVERY: 'delivery' } as const;

@Injectable()
export class ExpensesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly campaigns: CampaignsService,
    private readonly fiscal: FiscalService,
    private readonly storage: StorageService,
    private readonly identity: IdentityService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // --- Organizador -----------------------------------------------------------

  async listForCampaign(auth: AuthContext, campaignId: string): Promise<OwnedExpense[]> {
    await this.ownedCampaign(auth, campaignId);
    const linhas = await this.db.select().from(expenses).where(eq(expenses.campaignId, campaignId)).orderBy(desc(expenses.createdAt));
    return this.toOwned(linhas);
  }

  async create(auth: AuthContext, campaignId: string, input: ExpenseInput): Promise<OwnedExpense> {
    const campanha = await this.ownedCampaign(auth, campaignId);
    if (!ACCOUNTABLE_STATUSES.includes(campanha.status)) {
      throw new DomainError('CAMPAIGN_NOT_ACCOUNTABLE', 'A prestação de contas abre quando a campanha é publicada', HttpStatus.CONFLICT);
    }
    const id = newId();
    await this.db.insert(expenses).values({ id, campaignId, createdBy: auth.userId, ...this.fields(input) });
    return this.getOwned(auth, id);
  }

  async getOwned(auth: AuthContext, expenseId: string): Promise<OwnedExpense> {
    const despesa = await this.loadOwned(auth, expenseId);
    return (await this.toOwned([despesa]))[0]!;
  }

  async update(auth: AuthContext, expenseId: string, input: UpdateExpenseInput): Promise<OwnedExpense> {
    await this.db.transaction(async (tx) => {
      const d = await this.lockOwnedDraft(tx, auth, expenseId);
      if (d.version !== input.version) throw versionConflict();
      await tx
        .update(expenses)
        .set({ ...this.fields(input), version: d.version + 1, updatedAt: new Date() })
        .where(eq(expenses.id, d.id));
    });
    return this.getOwned(auth, expenseId);
  }

  async requestUpload(auth: AuthContext, expenseId: string, contentType: Parameters<StorageService['createUploadTicket']>[2], sizeBytes: number) {
    const d = await this.loadOwned(auth, expenseId);
    if (d.status !== 'DRAFT') throw this.notDraft();
    return this.storage.createUploadTicket(auth.userId, 'expense_document', contentType, sizeBytes);
  }

  /**
   * Anexa um arquivo já enviado. Nota fiscal: lê o XML ou o QR Code da foto;
   * se não der, o anexo fica pedindo a chave de acesso (provideFiscalKey).
   */
  async attach(auth: AuthContext, expenseId: string, input: AttachDocumentInput): Promise<OwnedExpense> {
    const d = await this.loadOwned(auth, expenseId);
    if (d.status !== 'DRAFT') throw this.notDraft();
    await this.storage.confirmUpload(input.fileId, auth.userId);
    const extraction: Extraction | null = input.kind === 'FISCAL' ? await this.fiscal.extractFromFile(input.fileId) : null;

    await this.db.transaction(async (tx) => {
      const despesa = await this.lockOwnedDraft(tx, auth, expenseId);
      const docId = newId();
      if (!extraction) {
        await this.insertDoc(tx, { id: docId, expenseId, fileId: input.fileId, kind: input.kind, extractionStatus: 'NOT_APPLICABLE' });
      } else if (extraction.kind === 'NONE') {
        await this.insertDoc(tx, { id: docId, expenseId, fileId: input.fileId, kind: 'FISCAL', extractionStatus: 'NEEDS_ACCESS_KEY', extractionMessage: extraction.reason });
      } else {
        const { documentId } = await this.fiscal.register(tx, { extraction }, { fileId: input.fileId, userId: auth.userId });
        const alocacao = await this.allocate(tx, despesa, documentId, input.allocatedCents, input.sharingJustification);
        await this.insertDoc(tx, {
          id: docId,
          expenseId,
          fileId: input.fileId,
          kind: 'FISCAL',
          fiscalDocumentId: documentId,
          allocatedCents: alocacao?.cents ?? null,
          sharingJustification: alocacao?.shared ? input.sharingJustification! : null,
          extractionStatus: alocacao ? 'EXTRACTED' : 'NEEDS_TOTAL',
          extractionMessage: alocacao
            ? null
            : extraction.kind === 'TEXT_KEY'
              ? extraction.origin === 'OCR'
                ? 'Chave de acesso lida da imagem por OCR: confira os 44 dígitos com o cupom e informe o valor total.'
                : 'Chave de acesso lida do PDF. Confira e informe o valor total da nota.'
              : 'O QR Code não informa o total da nota. Informe o valor total impresso no cupom.',
        });
      }
      await this.touch(tx, despesa);
    });
    return this.getOwned(auth, expenseId);
  }

  /** Chave de acesso digitada (PDF/foto sem QR) ou total que o QR não trouxe. */
  async provideFiscalKey(auth: AuthContext, expenseId: string, documentId: string, input: FiscalKeyInput): Promise<OwnedExpense> {
    await this.db.transaction(async (tx) => {
      const despesa = await this.lockOwnedDraft(tx, auth, expenseId);
      const [doc] = await tx
        .select()
        .from(expenseDocuments)
        .where(and(eq(expenseDocuments.id, documentId), eq(expenseDocuments.expenseId, expenseId)));
      if (!doc) throw notFound('Documento');
      if (doc.extractionStatus !== 'NEEDS_ACCESS_KEY' && doc.extractionStatus !== 'NEEDS_TOTAL') {
        throw conflict('FISCAL_ALREADY_IDENTIFIED', 'Este documento já foi identificado');
      }
      if (doc.extractionStatus === 'NEEDS_TOTAL') {
        const atual = (await this.fiscal.views([doc.fiscalDocumentId!])).get(doc.fiscalDocumentId!);
        if (atual?.accessKey !== input.accessKey) throw new DomainError('FISCAL_KEY_MISMATCH', 'A chave informada é diferente da lida no QR Code');
      }
      const { documentId: fiscalId } = await this.fiscal.register(
        tx,
        { accessKey: input.accessKey, declaredTotalCents: input.declaredTotalCents },
        { fileId: doc.fileId, userId: auth.userId },
      );
      const alocacao = await this.allocate(tx, despesa, fiscalId, input.allocatedCents, input.sharingJustification, doc.id);
      if (!alocacao) throw new DomainError('FISCAL_TOTAL_REQUIRED', 'Informe o valor total da nota');
      try {
        await tx
          .update(expenseDocuments)
          .set({
            fiscalDocumentId: fiscalId,
            allocatedCents: alocacao.cents,
            sharingJustification: alocacao.shared ? input.sharingJustification! : null,
            extractionStatus: 'EXTRACTED',
            extractionMessage: null,
          })
          .where(eq(expenseDocuments.id, doc.id));
      } catch (error) {
        throw this.mapDocError(error);
      }
      await this.touch(tx, despesa);
    });
    return this.getOwned(auth, expenseId);
  }

  async removeDocument(auth: AuthContext, expenseId: string, documentId: string): Promise<OwnedExpense> {
    await this.db.transaction(async (tx) => {
      const despesa = await this.lockOwnedDraft(tx, auth, expenseId);
      const apagados = await tx
        .delete(expenseDocuments)
        .where(and(eq(expenseDocuments.id, documentId), eq(expenseDocuments.expenseId, expenseId)))
        .returning({ id: expenseDocuments.id });
      if (apagados.length === 0) throw notFound('Documento');
      await this.touch(tx, despesa);
    });
    return this.getOwned(auth, expenseId);
  }

  async organizerAction(auth: AuthContext, expenseId: string, action: 'submit' | 'withdraw' | 'cancel', version: number, reason?: string): Promise<OwnedExpense> {
    await this.db.transaction(async (tx) => {
      const [d] = await tx.select().from(expenses).where(eq(expenses.id, expenseId)).for('update');
      if (!d) throw notFound('Despesa');
      const campanha = await this.campaigns.getAccountabilityTarget(d.campaignId, tx);
      if (campanha?.organizerId !== auth.userId) throw notFound('Despesa');
      if (d.version !== version) throw versionConflict();

      const extra: Partial<ExpenseRow> = {};
      if (action === 'submit') {
        const docs = await tx.select().from(expenseDocuments).where(eq(expenseDocuments.expenseId, d.id));
        if (docs.length === 0) throw new DomainError('EXPENSE_WITHOUT_DOCUMENTS', 'Anexe ao menos a nota fiscal, recibo ou comprovante');
        if (docs.some((x) => x.extractionStatus === 'NEEDS_ACCESS_KEY' || x.extractionStatus === 'NEEDS_TOTAL')) {
          throw new DomainError('FISCAL_PENDING_IDENTIFICATION', 'Há nota fiscal esperando a chave de acesso ou o valor total');
        }
        extra.flags = await this.flagsFor(tx, d, campanha, docs);
        extra.submittedAt = new Date();
        extra.paymentProof = initialAssessment(d.paymentProof as Assessment, docs.some((x) => x.kind === 'PAYMENT_PROOF'));
        extra.delivery = initialAssessment(d.delivery as Assessment, docs.some((x) => x.kind === 'DELIVERY'));
      }
      await this.changeStatus(tx, d, action, 'organizer', auth.userId, reason ?? null, extra);
    });
    return this.getOwned(auth, expenseId);
  }

  /**
   * Contestação de uma recusa: uma vez por despesa, com justificativa. A
   * despesa volta para a fila e outra pessoa revisa. A recusa tinha liberado a
   * parte das notas: se outra despesa ocupou esse valor, a contestação para.
   */
  async appeal(auth: AuthContext, expenseId: string, input: AppealInput): Promise<OwnedExpense> {
    await this.db.transaction(async (tx) => {
      const [d] = await tx.select().from(expenses).where(eq(expenses.id, expenseId)).for('update');
      if (!d) throw notFound('Despesa');
      const campanha = await this.campaigns.getAccountabilityTarget(d.campaignId, tx);
      if (!campanha || campanha.organizerId !== auth.userId) throw notFound('Despesa');
      if (d.version !== input.version) throw versionConflict();
      if (d.appealedAt) throw conflict('APPEAL_ALREADY_USED', 'Esta despesa já foi contestada uma vez');

      const docs = await tx.select().from(expenseDocuments).where(eq(expenseDocuments.expenseId, d.id));
      for (const doc of docs.filter((x) => x.fiscalDocumentId && x.allocatedCents)) {
        const { effectiveTotalCents: total } = await this.fiscal.lockForAllocation(tx, doc.fiscalDocumentId!);
        const [r] = await tx
          .select({ usado: sql<string>`coalesce(sum(${expenseDocuments.allocatedCents}), 0)::text` })
          .from(expenseDocuments)
          .innerJoin(expenses, eq(expenses.id, expenseDocuments.expenseId))
          .where(and(eq(expenseDocuments.fiscalDocumentId, doc.fiscalDocumentId!), ne(expenseDocuments.expenseId, d.id), inArray(expenses.status, [...COUNTED_STATUSES])));
        if (total !== null && Number(r?.usado ?? 0) + doc.allocatedCents! > total) {
          throw new DomainError('APPEAL_FISCAL_REALLOCATED', 'Depois da recusa, parte desta nota foi usada em outra despesa. Não é possível contestar.', HttpStatus.CONFLICT);
        }
      }
      const comContestacao = { ...d, appealReason: input.reason };
      await this.changeStatus(tx, d, 'appeal', 'organizer', auth.userId, input.reason, {
        appealReason: input.reason,
        appealedAt: new Date(),
        submittedAt: new Date(),
        reviewerId: null,
        decidedAt: null,
        flags: await this.flagsFor(tx, comContestacao, campanha, docs),
      });
    });
    return this.getOwned(auth, expenseId);
  }

  /** Link temporário para o arquivo. Organizador da campanha ou equipe de revisão. */
  async documentUrl(auth: AuthContext, expenseId: string, documentId: string) {
    const [d] = await this.db.select().from(expenses).where(eq(expenses.id, expenseId));
    if (!d) throw notFound('Despesa');
    const campanha = await this.campaigns.getAccountabilityTarget(d.campaignId);
    const equipe = auth.roles.includes('moderator') || auth.roles.includes('admin');
    if (campanha?.organizerId !== auth.userId && !(equipe && auth.mfaVerified)) throw notFound('Despesa');
    const [doc] = await this.db.select().from(expenseDocuments).where(and(eq(expenseDocuments.id, documentId), eq(expenseDocuments.expenseId, expenseId)));
    if (!doc) throw notFound('Documento');
    if (equipe && campanha?.organizerId !== auth.userId) {
      await this.audit.record({ actorUserId: auth.userId, action: 'expense.document_viewed', targetType: 'expense_document', targetId: doc.id, metadata: { expenseId } });
    }
    return this.storage.signedDownloadUrl(doc.fileId);
  }

  // --- Revisão (moderação) ---------------------------------------------------

  async queue(): Promise<ExpenseQueueItem[]> {
    const linhas = await this.db
      .select()
      .from(expenses)
      .where(inArray(expenses.status, ['SUBMITTED', 'IN_REVIEW']))
      // Maior risco primeiro; sem análise ainda, depois; empate: quem chegou antes.
      .orderBy(sql`${expenses.riskScore} desc nulls last`, asc(expenses.submittedAt))
      .limit(200);
    const campanhas = await this.campaigns.summariesByIds([...new Set(linhas.map((l) => l.campaignId))]);
    return linhas.map((l) => ({
      id: l.id,
      campaignTitle: campanhas.get(l.campaignId)?.title ?? '',
      description: l.description,
      amountCents: l.amountCents,
      status: l.status as ExpenseStatus,
      flags: l.flags,
      submittedAt: l.submittedAt?.toISOString() ?? null,
      riskScore: l.riskScore,
      riskLevel: l.riskLevel as ExpenseQueueItem['riskLevel'],
      appealed: l.appealedAt !== null,
    }));
  }

  async getForReview(expenseId: string): Promise<Omit<ModerationExpense, 'analysis'>> {
    const [d] = await this.db.select().from(expenses).where(eq(expenses.id, expenseId));
    if (!d) throw notFound('Despesa');
    const campanha = (await this.campaigns.getAccountabilityTarget(d.campaignId))!;
    const [owned] = await this.toOwned([d]);
    const docs = await this.db.select().from(expenseDocuments).where(eq(expenseDocuments.expenseId, d.id));
    // Alertas recalculados na hora: a nota pode ter sido verificada depois do envio.
    const flags = d.status === 'DRAFT' ? owned!.flags : await this.flagsFor(this.db, d, campanha, docs);
    const nomes = await this.identity.displayNames([campanha.organizerId]);
    return {
      ...owned!,
      flags,
      campaign: { id: campanha.id, title: campanha.title, slug: campanha.slug },
      organizerName: nomes.get(campanha.organizerId) ?? '',
      reviewerId: d.reviewerId,
      rejectedBy: d.rejectedBy,
      budgetSituation: {
        plannedCents: campanha.plannedByCategory.get(d.budgetCategory) ?? 0,
        committedCents: await this.committedInCategory(this.db, d.campaignId, d.budgetCategory),
      },
    };
  }

  async claim(auth: AuthContext, expenseId: string, version: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      const d = await this.lockForReview(tx, auth, expenseId);
      if (d.version !== version) throw versionConflict();
      if (d.appealedAt && d.rejectedBy === auth.userId) throw forbidden('Quem recusou a despesa não revisa a contestação');
      await this.changeStatus(tx, d, 'claim', 'reviewer', auth.userId, null, { reviewerId: auth.userId });
    });
  }

  async decide(auth: AuthContext, expenseId: string, input: ExpenseReviewDecision): Promise<void> {
    await this.db.transaction(async (tx) => {
      const d = await this.lockForReview(tx, auth, expenseId);
      if (d.version !== input.version) throw versionConflict();
      if (d.reviewerId !== auth.userId && !auth.roles.includes('admin')) throw forbidden('Esta despesa está com outra pessoa da revisão');
      if (d.appealedAt && d.rejectedBy === auth.userId) throw forbidden('Quem recusou a despesa não revisa a contestação');

      const docs = await tx.select().from(expenseDocuments).where(eq(expenseDocuments.expenseId, d.id));
      const extra: Partial<ExpenseRow> = { decidedAt: new Date(), decisionReason: input.reason.trim() };
      for (const [tipo, campo] of Object.entries(docKindToAssessment) as [keyof typeof docKindToAssessment, 'paymentProof' | 'delivery'][]) {
        const avaliacao = input[campo];
        if (!avaliacao) continue;
        if (!docs.some((x) => x.kind === tipo)) {
          throw new DomainError('NOTHING_TO_ASSESS', tipo === 'PAYMENT_PROOF' ? 'Não há comprovante de pagamento anexado' : 'Não há evidência de entrega anexada');
        }
        extra[campo] = avaliacao;
      }
      const acao: ExpenseAction = input.decision === 'APPROVE' ? 'approve' : input.decision === 'REJECT' ? 'reject' : 'request_changes';
      if (acao === 'request_changes') {
        extra.reviewerId = null;
        extra.decidedAt = null;
      }
      if (acao === 'reject') extra.rejectedBy = auth.userId;
      await this.changeStatus(tx, d, acao, 'reviewer', auth.userId, input.reason, extra);
    });
  }

  // --- Público ---------------------------------------------------------------

  async listPublic(slug: string): Promise<PublicExpense[]> {
    const campaignId = await this.campaigns.publicIdBySlug(slug);
    const linhas = await this.db
      .select()
      .from(expenses)
      .where(and(eq(expenses.campaignId, campaignId), inArray(expenses.status, PUBLIC_STATUSES)))
      .orderBy(desc(expenses.spentOn), desc(expenses.createdAt));
    const owned = await this.toOwned(linhas);
    return owned.map((e) => ({
      id: e.id,
      status: e.status,
      budgetCategory: e.budgetCategory,
      description: e.description,
      supplierName: e.supplierName,
      supplierDocument: publicSupplierDocument(e.supplierDocument),
      amountCents: e.amountCents,
      spentOn: e.spentOn,
      fiscalCheck: e.fiscalCheck,
      paymentProof: e.paymentProof,
      delivery: e.delivery,
      decisionReason: e.status === 'APPROVED' || e.status === 'REJECTED' ? e.decisionReason : null,
      appealed: e.appeal !== null,
      fiscalDocuments: e.documents
        .filter((x) => x.fiscalDocument)
        .map((x) => {
          const { accessKey: _k, id: _i, verificationReason: _r, issuerDocument, signature, ...resto } = x.fiscalDocument!;
          // O titular do certificado pode ser pessoa física (e-CPF): não vai a público.
          return { ...resto, issuerDocument: publicSupplierDocument(issuerDocument) ?? '', signature: signature ? { ...signature, certificateSubject: null } : null };
        }),
    }));
  }

  async transparencySummary(campaignId: string): Promise<Omit<CampaignTransparency['expenses'], 'available' | 'byCategory'> & { byCategory: Map<string, { approvedCents: number; inReviewCents: number }> }> {
    const linhas = await this.db
      .select({ id: expenses.id, status: expenses.status, amount: expenses.amountCents, category: expenses.budgetCategory })
      .from(expenses)
      .where(and(eq(expenses.campaignId, campaignId), inArray(expenses.status, PUBLIC_STATUSES)));
    const aprovadas = linhas.filter((l) => l.status === 'APPROVED');
    const fiscalPorDespesa = await this.fiscalChecks(aprovadas.map((a) => a.id));
    const porCategoria = new Map<string, { approvedCents: number; inReviewCents: number }>();
    for (const l of linhas) {
      const c = porCategoria.get(l.category) ?? { approvedCents: 0, inReviewCents: 0 };
      if (l.status === 'APPROVED') c.approvedCents += l.amount;
      else if (l.status !== 'REJECTED') c.inReviewCents += l.amount;
      porCategoria.set(l.category, c);
    }
    return {
      approvedCents: aprovadas.reduce((t, l) => t + l.amount, 0),
      inReviewCents: linhas.filter((l) => l.status === 'SUBMITTED' || l.status === 'IN_REVIEW').reduce((t, l) => t + l.amount, 0),
      rejectedCount: linhas.filter((l) => l.status === 'REJECTED').length,
      fiscallyAuthenticatedCents: aprovadas.filter((a) => fiscalPorDespesa.get(a.id) === 'AUTHORIZED').reduce((t, l) => t + l.amount, 0),
      byCategory: porCategoria,
    };
  }

  /** Campanhas afetadas pela verificação de uma nota (para expirar o cache público). */
  async campaignsUsingFiscalDocument(fiscalDocumentId: string): Promise<string[]> {
    const linhas = await this.db
      .selectDistinct({ campaignId: expenses.campaignId })
      .from(expenseDocuments)
      .innerJoin(expenses, eq(expenses.id, expenseDocuments.expenseId))
      .where(eq(expenseDocuments.fiscalDocumentId, fiscalDocumentId));
    return linhas.map((l) => l.campaignId);
  }

  // --- Internos --------------------------------------------------------------

  private fields(input: ExpenseInput) {
    return {
      budgetCategory: input.budgetCategory,
      description: input.description,
      supplierName: input.supplierName,
      supplierDocument: input.supplierDocument ?? null,
      amountCents: input.amountCents,
      spentOn: input.spentOn,
    };
  }

  private notDraft() {
    return new DomainError('EXPENSE_NOT_DRAFT', 'Só é possível alterar despesas em rascunho', HttpStatus.CONFLICT);
  }

  private async ownedCampaign(auth: AuthContext, campaignId: string): Promise<AccountabilityTarget> {
    const c = await this.campaigns.getAccountabilityTarget(campaignId);
    if (!c || c.organizerId !== auth.userId) throw notFound('Campanha');
    return c;
  }

  private async loadOwned(auth: AuthContext, expenseId: string): Promise<ExpenseRow> {
    const [d] = await this.db.select().from(expenses).where(eq(expenses.id, expenseId));
    if (!d) throw notFound('Despesa');
    await this.ownedCampaign(auth, d.campaignId).catch(() => {
      throw notFound('Despesa');
    });
    return d;
  }

  private async lockOwnedDraft(tx: Executor, auth: AuthContext, expenseId: string): Promise<ExpenseRow> {
    const [d] = await tx.select().from(expenses).where(eq(expenses.id, expenseId)).for('update');
    if (!d) throw notFound('Despesa');
    const campanha = await this.campaigns.getAccountabilityTarget(d.campaignId, tx);
    if (campanha?.organizerId !== auth.userId) throw notFound('Despesa');
    if (d.status !== 'DRAFT') throw this.notDraft();
    return d;
  }

  private async lockForReview(tx: Executor, auth: AuthContext, expenseId: string): Promise<ExpenseRow> {
    const [d] = await tx.select().from(expenses).where(eq(expenses.id, expenseId)).for('update');
    if (!d) throw notFound('Despesa');
    const campanha = await this.campaigns.getAccountabilityTarget(d.campaignId, tx);
    // Conflito de interesse: ninguém revisa a prestação de contas da própria campanha.
    if (campanha?.organizerId === auth.userId) throw forbidden('Você não pode revisar despesas da sua própria campanha');
    return d;
  }

  private async touch(tx: Executor, d: ExpenseRow): Promise<void> {
    const docs = await tx.select({ kind: expenseDocuments.kind }).from(expenseDocuments).where(eq(expenseDocuments.expenseId, d.id));
    await tx
      .update(expenses)
      .set({
        version: d.version + 1,
        updatedAt: new Date(),
        paymentProof: initialAssessment(d.paymentProof as Assessment, docs.some((x) => x.kind === 'PAYMENT_PROOF')),
        delivery: initialAssessment(d.delivery as Assessment, docs.some((x) => x.kind === 'DELIVERY')),
      })
      .where(eq(expenses.id, d.id));
  }

  private async insertDoc(tx: Executor, values: typeof expenseDocuments.$inferInsert): Promise<void> {
    try {
      await tx.insert(expenseDocuments).values(values);
    } catch (error) {
      throw this.mapDocError(error);
    }
  }

  private mapDocError(error: unknown): unknown {
    if (isUniqueViolation(error, 'expense_documents_fiscal_once')) return conflict('FISCAL_DOCUMENT_ALREADY_ATTACHED', 'Esta nota fiscal já está anexada a esta despesa');
    if (isUniqueViolation(error, 'expense_documents_file')) return conflict('FILE_ALREADY_ATTACHED', 'Este arquivo já foi anexado');
    return error;
  }

  /**
   * Reserva parte do total da nota para esta despesa, com a nota travada
   * (FOR UPDATE): duas despesas não conseguem passar do total ao mesmo tempo.
   * Devolve null quando a nota ainda não tem total conhecido.
   */
  private async allocate(
    tx: Executor,
    despesa: ExpenseRow,
    fiscalDocumentId: string,
    requested: number | undefined,
    justification: string | undefined,
    exceptExpenseDocumentId?: string,
  ): Promise<{ cents: number; shared: boolean } | null> {
    const { effectiveTotalCents: total } = await this.fiscal.lockForAllocation(tx, fiscalDocumentId);
    if (total === null) return null;

    const usos = await tx
      .select({ expenseId: expenseDocuments.expenseId, cents: expenseDocuments.allocatedCents, id: expenseDocuments.id, fiscalId: expenseDocuments.fiscalDocumentId })
      .from(expenseDocuments)
      .innerJoin(expenses, eq(expenses.id, expenseDocuments.expenseId))
      .where(
        and(
          inArray(expenses.status, [...COUNTED_STATUSES]),
          sql`${expenseDocuments.allocatedCents} is not null`,
          or(eq(expenseDocuments.fiscalDocumentId, fiscalDocumentId), eq(expenseDocuments.expenseId, despesa.id)),
        ),
      );
    const outrasDespesas = usos.filter((u) => u.fiscalId === fiscalDocumentId && u.expenseId !== despesa.id).reduce((t, u) => t + (u.cents ?? 0), 0);
    const cobertoNestaDespesa = usos
      .filter((u) => u.expenseId === despesa.id && u.id !== exceptExpenseDocumentId)
      .reduce((t, u) => t + (u.cents ?? 0), 0);

    const livre = total - outrasDespesas;
    if (livre <= 0) {
      throw new DomainError('FISCAL_DOCUMENT_FULLY_ALLOCATED', 'O valor desta nota já foi todo usado em outras despesas', HttpStatus.CONFLICT, {
        totalCents: total,
        allocatedElsewhereCents: outrasDespesas,
      });
    }
    const compartilhada = outrasDespesas > 0;
    if (compartilhada && !justification) {
      throw new DomainError('SHARING_JUSTIFICATION_REQUIRED', 'Esta nota já está em outra despesa. Para ratear, explique a divisão.', HttpStatus.CONFLICT, {
        totalCents: total,
        allocatedElsewhereCents: outrasDespesas,
      });
    }
    const faltando = despesa.amountCents - cobertoNestaDespesa;
    const valor = requested ?? Math.min(livre, faltando > 0 ? faltando : livre);
    if (valor > livre) {
      throw new DomainError('ALLOCATION_EXCEEDS_DOCUMENT', 'O valor atribuído passa do que resta desta nota', HttpStatus.UNPROCESSABLE_ENTITY, {
        availableCents: livre,
      });
    }
    return { cents: valor, shared: compartilhada };
  }

  private async committedInCategory(executor: Executor, campaignId: string, category: string): Promise<number> {
    const r = await executor
      .select({ total: sql<string>`coalesce(sum(${expenses.amountCents}), 0)::text` })
      .from(expenses)
      .where(and(eq(expenses.campaignId, campaignId), eq(expenses.budgetCategory, category), inArray(expenses.status, ['SUBMITTED', 'IN_REVIEW', 'APPROVED'])));
    return Number(r[0]?.total ?? 0);
  }

  private async flagsFor(executor: Executor, d: ExpenseRow, campanha: AccountabilityTarget, docs: DocRow[]) {
    const fiscais = docs.filter((x) => x.fiscalDocumentId && x.allocatedCents);
    const views = await this.fiscal.views(fiscais.map((f) => f.fiscalDocumentId!));
    const compartilhadas = new Set<string>();
    if (fiscais.length) {
      const outros = await executor
        .select({ fiscalId: expenseDocuments.fiscalDocumentId })
        .from(expenseDocuments)
        .innerJoin(expenses, eq(expenses.id, expenseDocuments.expenseId))
        .where(
          and(
            inArray(expenseDocuments.fiscalDocumentId, fiscais.map((f) => f.fiscalDocumentId!)),
            ne(expenseDocuments.expenseId, d.id),
            inArray(expenses.status, [...COUNTED_STATUSES]),
          ),
        );
      for (const o of outros) if (o.fiscalId) compartilhadas.add(o.fiscalId);
    }

    const arquivos = await this.storage.filesInfo(docs.map((x) => x.fileId));
    const usadosEmOutra = async (fileIds: string[]) =>
      fileIds.length > 0 &&
      (
        await executor
          .select({ id: expenseDocuments.id })
          .from(expenseDocuments)
          .where(and(inArray(expenseDocuments.fileId, fileIds), ne(expenseDocuments.expenseId, d.id)))
          .limit(1)
      ).length > 0;
    const imagens = [...arquivos.values()].filter((a) => a.mimeType.startsWith('image/')).map((a) => a.id);
    const parecida = await usadosEmOutra(await this.storage.visuallySimilarFiles(imagens, docs.map((x) => x.fileId)));
    const textos = [
      d.description,
      d.supplierName,
      d.appealReason,
      ...docs.map((x) => x.sharingJustification),
      ...[...views.values()].flatMap((v) => v.items.map((i) => i.description)),
    ];
    let duplicado = false;
    for (const a of arquivos.values()) {
      const iguais = await this.storage.filesWithSameContent(a.sha256, docs.map((x) => x.fileId));
      if (iguais.length === 0) continue;
      const usados = await executor
        .select({ id: expenseDocuments.id })
        .from(expenseDocuments)
        .where(and(inArray(expenseDocuments.fileId, iguais), ne(expenseDocuments.expenseId, d.id)))
        .limit(1);
      if (usados.length) duplicado = true;
    }

    const jaComprometido = await this.committedInCategory(executor, d.campaignId, d.budgetCategory);
    const contaEsta = ['SUBMITTED', 'IN_REVIEW', 'APPROVED'].includes(d.status) ? 0 : d.amountCents;

    return computeFlags({
      amountCents: d.amountCents,
      spentOn: d.spentOn,
      supplierDocument: d.supplierDocument,
      campaign: { createdAt: campanha.createdAt, endsAt: campanha.endsAt },
      category: { plannedCents: campanha.plannedByCategory.get(d.budgetCategory) ?? 0, committedCents: jaComprometido + contaEsta },
      fiscal: fiscais.map((f) => {
        const v = views.get(f.fiscalDocumentId!)!;
        return {
          allocatedCents: f.allocatedCents!,
          issuerDocument: v.issuerDocument,
          issuedAt: v.issuedAt,
          protocolStatus: v.protocolStatus,
          source: v.source,
          environment: v.environment,
          warnings: v.warnings,
          totalFromDocument: v.totalCents !== null,
          sharedWithOtherExpenses: compartilhadas.has(v.id),
          signatureStatus: v.source === 'XML' ? v.signatureStatus : null,
          certificateProblems: v.signatureStatus === 'VALID' ? (v.signatureDetails?.problems.length ?? 0) : 0,
        };
      }),
      hasPaymentProof: docs.some((x) => x.kind === 'PAYMENT_PROOF'),
      duplicateFile: duplicado,
      similarImage: parecida,
      suspiciousInstructions: detectSuspiciousInstructions(textos).length > 0,
    });
  }

  /**
   * O que a análise automática precisa: alertas recalculados agora, situação
   * fiscal, itens das notas, textos enviados pelo organizador e a campanha.
   */
  async analysisInput(expenseId: string) {
    const [d] = await this.db.select().from(expenses).where(eq(expenses.id, expenseId));
    if (!d) throw notFound('Despesa');
    const campanha = await this.campaigns.getAccountabilityTarget(d.campaignId);
    if (!campanha) throw notFound('Campanha');
    const docs = await this.db.select().from(expenseDocuments).where(eq(expenseDocuments.expenseId, d.id));
    const fiscais = docs.filter((x) => x.fiscalDocumentId && x.allocatedCents);
    const views = await this.fiscal.views([...new Set(fiscais.map((f) => f.fiscalDocumentId!))]);
    const itens = [...views.values()].flatMap((v) => v.items);
    return {
      expense: d,
      campaign: campanha,
      flags: await this.flagsFor(this.db, d, campanha, docs),
      fiscalCheck: aggregateFiscalCheck(fiscais.map((f) => views.get(f.fiscalDocumentId!)?.verificationStatus ?? 'NOT_VERIFIED')),
      items: itens,
      texts: [d.description, d.supplierName, d.appealReason, ...docs.map((x) => x.sharingJustification), ...itens.map((i) => i.description)],
    };
  }

  /** Grava o risco da última análise na despesa (ordena a fila). Não mexe na versão. */
  async setRisk(expenseId: string, score: number, level: string): Promise<void> {
    await this.db.update(expenses).set({ riskScore: score, riskLevel: level }).where(eq(expenses.id, expenseId));
  }

  private async changeStatus(
    tx: Executor,
    d: ExpenseRow,
    action: ExpenseAction,
    actor: 'organizer' | 'reviewer',
    actorUserId: string,
    reason: string | null,
    extra: Partial<ExpenseRow>,
  ): Promise<void> {
    const r = expenseTransition(action, d.status as ExpenseStatus, actor, reason);
    if (!r.ok) throw TRANSITION_ERRORS[r.error]();
    await tx
      .update(expenses)
      .set({ ...extra, status: r.to, version: d.version + 1, updatedAt: new Date() })
      .where(eq(expenses.id, d.id));
    await tx.insert(expenseStatusHistory).values({
      id: newId(),
      expenseId: d.id,
      fromStatus: d.status,
      toStatus: r.to,
      action,
      actorUserId,
      reason: reason?.trim() || null,
    });
    await this.audit.record({ actorUserId, action: `expense.${action}`, targetType: 'expense', targetId: d.id, metadata: { from: d.status, to: r.to } }, tx);
    await this.outbox.add(tx, {
      type: EXPENSE_EVENTS.statusChanged,
      aggregateType: 'expense',
      aggregateId: d.id,
      payload: {
        expenseId: d.id,
        campaignId: d.campaignId,
        description: d.description,
        action,
        from: d.status,
        to: r.to,
        reason: reason?.trim() || null,
        createdBy: d.createdBy,
      },
    });
  }

  private async fiscalChecks(expenseIds: string[]): Promise<Map<string, ReturnType<typeof aggregateFiscalCheck>>> {
    if (expenseIds.length === 0) return new Map();
    const docs = await this.db
      .select({ expenseId: expenseDocuments.expenseId, fiscalId: expenseDocuments.fiscalDocumentId })
      .from(expenseDocuments)
      .where(and(inArray(expenseDocuments.expenseId, expenseIds), sql`${expenseDocuments.fiscalDocumentId} is not null`));
    const views = await this.fiscal.views([...new Set(docs.map((x) => x.fiscalId!))]);
    return new Map(expenseIds.map((id) => [id, aggregateFiscalCheck(docs.filter((x) => x.expenseId === id).map((x) => views.get(x.fiscalId!)!.verificationStatus))]));
  }

  private async toOwned(linhas: ExpenseRow[]): Promise<OwnedExpense[]> {
    if (linhas.length === 0) return [];
    const docs = await this.db
      .select()
      .from(expenseDocuments)
      .where(inArray(expenseDocuments.expenseId, linhas.map((l) => l.id)))
      .orderBy(asc(expenseDocuments.createdAt));
    const [views, arquivos] = await Promise.all([
      this.fiscal.views([...new Set(docs.filter((x) => x.fiscalDocumentId).map((x) => x.fiscalDocumentId!))]),
      this.storage.filesInfo(docs.map((x) => x.fileId)),
    ]);
    const fiscalView = (v: FiscalDocumentView) => ({
      id: v.id,
      accessKey: v.accessKey,
      model: v.model,
      uf: v.uf,
      series: v.series,
      number: v.number,
      issuedAt: v.issuedAt,
      issuerDocument: v.issuerDocument,
      issuerName: v.issuerName,
      effectiveTotalCents: v.effectiveTotalCents,
      totalSource: v.totalCents !== null ? ('DOCUMENT' as const) : v.declaredTotalCents !== null ? ('DECLARED' as const) : null,
      source: v.source,
      verificationStatus: v.verificationStatus,
      verificationReason: v.verificationReason,
      signature: v.signatureStatus
        ? { status: v.signatureStatus, problems: v.signatureDetails?.problems ?? [], certificateSubject: v.signatureDetails?.certificate?.subject ?? null }
        : null,
      items: v.items.map((i) => ({ description: i.description, quantity: i.quantity, unit: i.unit, totalCents: i.totalCents })),
    });

    return linhas.map((l) => {
      const meus = docs.filter((x) => x.expenseId === l.id);
      const fiscais = meus.filter((x) => x.fiscalDocumentId && x.allocatedCents);
      return {
        id: l.id,
        campaignId: l.campaignId,
        status: l.status as ExpenseStatus,
        version: l.version,
        budgetCategory: l.budgetCategory as OwnedExpense['budgetCategory'],
        description: l.description,
        supplierName: l.supplierName,
        supplierDocument: l.supplierDocument,
        amountCents: l.amountCents,
        spentOn: l.spentOn,
        fiscalCheck: aggregateFiscalCheck(fiscais.map((f) => views.get(f.fiscalDocumentId!)?.verificationStatus ?? 'NOT_VERIFIED')),
        paymentProof: l.paymentProof as Assessment,
        delivery: l.delivery as Assessment,
        flags: l.flags,
        decisionReason: l.decisionReason,
        appeal: l.appealedAt && l.appealReason ? { reason: l.appealReason, at: l.appealedAt.toISOString() } : null,
        documents: meus.map((x) => ({
          id: x.id,
          kind: x.kind as OwnedExpense['documents'][number]['kind'],
          mimeType: arquivos.get(x.fileId)?.mimeType ?? 'application/octet-stream',
          allocatedCents: x.allocatedCents,
          sharingJustification: x.sharingJustification,
          extraction: { status: x.extractionStatus as OwnedExpense['documents'][number]['extraction']['status'], message: x.extractionMessage },
          fiscalDocument: x.fiscalDocumentId && views.get(x.fiscalDocumentId) ? fiscalView(views.get(x.fiscalDocumentId)!) : null,
          createdAt: x.createdAt.toISOString(),
        })),
        createdAt: l.createdAt.toISOString(),
        updatedAt: l.updatedAt.toISOString(),
      };
    });
  }
}
