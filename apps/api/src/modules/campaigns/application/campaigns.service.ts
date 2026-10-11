import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  CampaignCard,
  CampaignDetail,
  CampaignList,
  CampaignStatus,
  CreateCampaignInput,
  ListCampaignsQuery,
  OwnedCampaign,
  UpdateCampaignInput,
} from '@soscomida/contracts';
import { slugify } from '@soscomida/shared';
import { type SQL, and, asc, desc, eq, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { DB, type Database, type Executor } from '../../../infra/db/db';
import { DomainError, forbidden, notFound, versionConflict } from '../../../infra/http/errors';
import { newId } from '../../../infra/ids';
import { AuditService } from '../../audit';
import { type AuthContext, IdentityService } from '../../identity';
import { LedgerService } from '../../ledger';
import { OutboxService } from '../../outbox';
import { StorageService } from '../../storage';
import { validateBudget } from '../domain/budget';
import {
  type Actor,
  type CampaignAction,
  EDITABLE_STATUSES,
  PUBLIC_STATUSES,
  acceptsDonations,
  allowedActions,
  transition,
} from '../domain/campaign-status';
import {
  campaignBudgetItems,
  campaignImages,
  campaignStats,
  campaignStatusHistory,
  campaignUpdates,
  campaigns,
} from '../infra/campaigns.schema';

type CampaignRow = typeof campaigns.$inferSelect;

export const CAMPAIGN_EVENTS = {
  statusChanged: 'CampaignStatusChanged',
  updatePosted: 'CampaignUpdatePosted',
} as const;

export interface StatusChangeCommand {
  action: CampaignAction;
  actor: Actor;
  actorUserId: string | null;
  expectedVersion?: number;
  reason?: string | null;
}

/** O que o módulo de doações precisa saber da campanha. */
export interface DonationTarget {
  id: string;
  slug: string;
  title: string;
  organizerId: string;
  acceptsDonations: boolean;
}

const TRANSITION_ERRORS = {
  INVALID_TRANSITION: () => new DomainError('INVALID_TRANSITION', 'Esta ação não é permitida no status atual da campanha', HttpStatus.CONFLICT),
  ACTOR_NOT_ALLOWED: () => forbidden('Você não pode executar esta ação nesta campanha'),
  REASON_REQUIRED: () => new DomainError('REASON_REQUIRED', 'Informe o motivo desta ação'),
  NO_PREVIOUS_STATUS: () => new DomainError('NO_PREVIOUS_STATUS', 'Não foi possível determinar o status anterior à investigação', HttpStatus.CONFLICT),
};

@Injectable()
export class CampaignsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly identity: IdentityService,
    private readonly ledger: LedgerService,
    private readonly storage: StorageService,
  ) {}

  // --- Organizador -----------------------------------------------------------

  async create(auth: AuthContext, input: CreateCampaignInput): Promise<OwnedCampaign> {
    this.assertEndsAtInFuture(input.endsAt);
    const id = newId();
    await this.db.transaction(async (tx) => {
      await tx.insert(campaigns).values({
        id,
        slug: `${slugify(input.title, 60)}-${id.slice(-6)}`,
        organizerId: auth.userId,
        title: input.title,
        summary: input.summary,
        description: input.description,
        category: input.category,
        goalCents: input.goalCents,
        region: input.region ?? null,
        endsAt: new Date(input.endsAt),
      });
      await this.replaceBudget(tx, id, input.budget);
      await tx.insert(campaignStats).values({ campaignId: id });
      await tx.insert(campaignStatusHistory).values({
        id: newId(),
        campaignId: id,
        fromStatus: null,
        toStatus: 'DRAFT',
        action: 'create',
        actorUserId: auth.userId,
        actorRole: 'organizer',
      });
      await this.audit.record({ actorUserId: auth.userId, action: 'campaign.created', targetType: 'campaign', targetId: id }, tx);
    });
    return this.getOwned(auth, id);
  }

  async update(auth: AuthContext, campaignId: string, input: UpdateCampaignInput): Promise<OwnedCampaign> {
    const campanha = await this.loadOwned(auth, campaignId);
    if (!EDITABLE_STATUSES.includes(campanha.status as CampaignStatus)) {
      throw new DomainError('NOT_EDITABLE', 'Só é possível editar campanhas em rascunho', HttpStatus.CONFLICT);
    }
    if (input.endsAt) this.assertEndsAtInFuture(input.endsAt);

    await this.db.transaction(async (tx) => {
      const atualizadas = await tx
        .update(campaigns)
        .set({
          title: input.title,
          summary: input.summary,
          description: input.description,
          category: input.category,
          goalCents: input.goalCents,
          region: input.region,
          endsAt: input.endsAt ? new Date(input.endsAt) : undefined,
          version: sql`${campaigns.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(campaigns.id, campaignId), eq(campaigns.version, input.version)))
        .returning({ id: campaigns.id });
      if (atualizadas.length === 0) throw versionConflict();
      if (input.budget) await this.replaceBudget(tx, campaignId, input.budget);
      await this.audit.record({ actorUserId: auth.userId, action: 'campaign.updated', targetType: 'campaign', targetId: campaignId }, tx);
    });
    return this.getOwned(auth, campaignId);
  }

  /** Ações do organizador sobre a própria campanha. */
  async organizerAction(auth: AuthContext, campaignId: string, action: CampaignAction, version: number, reason?: string): Promise<OwnedCampaign> {
    const campanha = await this.loadOwned(auth, campaignId);
    if (action === 'submit') await this.assertReadyForReview(campanha);
    await this.db.transaction((tx) =>
      this.changeStatus(tx, campanha.id, { action, actor: 'organizer', actorUserId: auth.userId, expectedVersion: version, reason }),
    );
    return this.getOwned(auth, campaignId);
  }

  async listOwned(auth: AuthContext): Promise<OwnedCampaign[]> {
    const linhas = await this.db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(and(eq(campaigns.organizerId, auth.userId), isNull(campaigns.deletedAt)))
      .orderBy(desc(campaigns.createdAt));
    return Promise.all(linhas.map((l) => this.getOwned(auth, l.id)));
  }

  async getOwned(auth: AuthContext, campaignId: string): Promise<OwnedCampaign> {
    const campanha = await this.loadOwned(auth, campaignId);
    const detalhe = await this.toDetail(campanha);
    const [ultimaModeracao] = await this.db
      .select({ reason: campaignStatusHistory.reason })
      .from(campaignStatusHistory)
      .where(and(eq(campaignStatusHistory.campaignId, campaignId), eq(campaignStatusHistory.actorRole, 'moderator')))
      .orderBy(desc(campaignStatusHistory.occurredAt))
      .limit(1);
    const imagens = await this.db
      .select({ fileId: campaignImages.fileId })
      .from(campaignImages)
      .where(eq(campaignImages.campaignId, campaignId))
      .orderBy(asc(campaignImages.position));
    const urls = await this.storage.publicUrls(imagens.map((i) => i.fileId));
    return {
      ...detalhe,
      version: campanha.version,
      images: imagens.filter((i) => urls.has(i.fileId)).map((i) => ({ fileId: i.fileId, url: urls.get(i.fileId)! })),
      moderationNote: ultimaModeracao?.reason ?? null,
      allowedActions: allowedActions(campanha.status as CampaignStatus, 'organizer'),
    };
  }

  // --- Imagens ----------------------------------------------------------------

  async requestImageUpload(auth: AuthContext, campaignId: string, contentType: 'image/jpeg' | 'image/png' | 'image/webp', sizeBytes: number) {
    const campanha = await this.loadOwned(auth, campaignId);
    this.assertCanChangeMedia(campanha);
    return this.storage.createUploadTicket(auth.userId, 'campaign_image', contentType, sizeBytes);
  }

  async attachImage(auth: AuthContext, campaignId: string, fileId: string): Promise<OwnedCampaign> {
    const campanha = await this.loadOwned(auth, campaignId);
    this.assertCanChangeMedia(campanha);
    await this.storage.confirmUpload(fileId, auth.userId);
    await this.db.transaction(async (tx) => {
      const [contagem] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(campaignImages)
        .where(eq(campaignImages.campaignId, campaignId));
      const total = contagem?.total ?? 0;
      if (total >= 10) throw new DomainError('TOO_MANY_IMAGES', 'Limite de 10 imagens por campanha');
      await tx.insert(campaignImages).values({ campaignId, fileId, position: total }).onConflictDoNothing();
      if (!campanha.coverFileId) await tx.update(campaigns).set({ coverFileId: fileId }).where(eq(campaigns.id, campaignId));
    });
    return this.getOwned(auth, campaignId);
  }

  async removeImage(auth: AuthContext, campaignId: string, fileId: string): Promise<OwnedCampaign> {
    const campanha = await this.loadOwned(auth, campaignId);
    this.assertCanChangeMedia(campanha);
    await this.db.transaction(async (tx) => {
      await tx.delete(campaignImages).where(and(eq(campaignImages.campaignId, campaignId), eq(campaignImages.fileId, fileId)));
      if (campanha.coverFileId === fileId) {
        const [proxima] = await tx.select({ fileId: campaignImages.fileId }).from(campaignImages).where(eq(campaignImages.campaignId, campaignId)).orderBy(asc(campaignImages.position)).limit(1);
        await tx.update(campaigns).set({ coverFileId: proxima?.fileId ?? null }).where(eq(campaigns.id, campaignId));
      }
    });
    return this.getOwned(auth, campaignId);
  }

  // --- Atualizações públicas ---------------------------------------------------

  async addUpdate(auth: AuthContext, campaignId: string, input: { title: string; body: string }) {
    const campanha = await this.loadOwned(auth, campaignId);
    if (!PUBLIC_STATUSES.includes(campanha.status as CampaignStatus)) {
      throw new DomainError('NOT_PUBLIC', 'Atualizações só podem ser publicadas em campanhas visíveis ao público', HttpStatus.CONFLICT);
    }
    const id = newId();
    await this.db.transaction(async (tx) => {
      await tx.insert(campaignUpdates).values({ id, campaignId, authorId: auth.userId, title: input.title, body: input.body });
      await this.outbox.add(tx, { type: CAMPAIGN_EVENTS.updatePosted, aggregateType: 'campaign', aggregateId: campaignId, payload: { campaignId, updateId: id } });
    });
    return { id, ...input, createdAt: new Date().toISOString() };
  }

  async listUpdates(slug: string) {
    const campanha = await this.loadPublicBySlug(slug);
    const linhas = await this.db
      .select({ id: campaignUpdates.id, title: campaignUpdates.title, body: campaignUpdates.body, createdAt: campaignUpdates.createdAt })
      .from(campaignUpdates)
      .where(eq(campaignUpdates.campaignId, campanha.id))
      .orderBy(desc(campaignUpdates.createdAt))
      .limit(50);
    return linhas.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() }));
  }

  // --- Público -------------------------------------------------------------------

  async listPublic(query: ListCampaignsQuery): Promise<CampaignList> {
    const filtros: SQL[] = [eq(campaigns.status, 'ACTIVE'), isNull(campaigns.deletedAt)];
    if (query.category) filtros.push(eq(campaigns.category, query.category));
    if (query.region) filtros.push(ilike(campaigns.region, `%${escapeLike(query.region)}%`));
    if (query.q) {
      const termo = `%${escapeLike(query.q)}%`;
      filtros.push(or(ilike(campaigns.title, termo), ilike(campaigns.summary, termo))!);
    }
    const ordem =
      query.sort === 'mais_arrecadadas'
        ? [desc(campaignStats.confirmedCents), desc(campaigns.publishedAt)]
        : query.sort === 'terminando'
          ? [asc(campaigns.endsAt)]
          : [desc(campaigns.publishedAt)];

    const where = and(...filtros);
    const [linhas, [contagem]] = await Promise.all([
      this.db
        .select({ campaign: campaigns, stats: campaignStats })
        .from(campaigns)
        .leftJoin(campaignStats, eq(campaignStats.campaignId, campaigns.id))
        .where(where)
        .orderBy(...ordem)
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ total: sql<number>`count(*)::int` }).from(campaigns).where(where),
    ]);

    const capas = await this.storage.publicUrls(linhas.map((l) => l.campaign.coverFileId).filter((id): id is string => !!id));
    return {
      items: linhas.map((l) => this.toCard(l.campaign, l.stats, capas)),
      page: query.page,
      pageSize: query.pageSize,
      total: contagem?.total ?? 0,
    };
  }

  async getPublicBySlug(slug: string): Promise<CampaignDetail> {
    return this.toDetail(await this.loadPublicBySlug(slug));
  }

  // --- Fachada para outros módulos -------------------------------------------

  async getDonationTarget(campaignId: string, executor: Executor = this.db): Promise<DonationTarget | null> {
    const [c] = await executor.select().from(campaigns).where(and(eq(campaigns.id, campaignId), isNull(campaigns.deletedAt))).limit(1);
    if (!c) return null;
    return { id: c.id, slug: c.slug, title: c.title, organizerId: c.organizerId, acceptsDonations: acceptsDonations(c.status as CampaignStatus, c.endsAt) };
  }

  async summariesByIds(ids: string[]): Promise<Map<string, { title: string; slug: string }>> {
    if (ids.length === 0) return new Map();
    const linhas = await this.db.select({ id: campaigns.id, title: campaigns.title, slug: campaigns.slug }).from(campaigns).where(inArray(campaigns.id, ids));
    return new Map(linhas.map((l) => [l.id, { title: l.title, slug: l.slug }]));
  }

  /** Visão interna (moderação): qualquer status, sem checar propriedade. */
  async getForModeration(campaignId: string): Promise<CampaignDetail & { version: number }> {
    const [c] = await this.db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
    if (!c) throw notFound('Campanha');
    return { ...(await this.toDetail(c)), version: c.version };
  }

  async listByStatus(statuses: CampaignStatus[]): Promise<CampaignRow[]> {
    return this.db.select().from(campaigns).where(and(inArray(campaigns.status, statuses), isNull(campaigns.deletedAt))).orderBy(asc(campaigns.updatedAt));
  }

  /**
   * Aplica uma transição da máquina de estados. Usada pelo organizador, pela
   * moderação e pelo sistema (prazo). Grava histórico, auditoria e evento.
   */
  async changeStatus(tx: Executor, campaignId: string, cmd: StatusChangeCommand): Promise<CampaignStatus> {
    const [campanha] = await tx.select().from(campaigns).where(eq(campaigns.id, campaignId)).for('update').limit(1);
    if (!campanha) throw notFound('Campanha');
    if (cmd.expectedVersion !== undefined && campanha.version !== cmd.expectedVersion) throw versionConflict();

    let previousStatus: CampaignStatus | null = null;
    if (cmd.action === 'clear_investigation') {
      const [entrada] = await tx
        .select({ from: campaignStatusHistory.fromStatus })
        .from(campaignStatusHistory)
        .where(and(eq(campaignStatusHistory.campaignId, campaignId), eq(campaignStatusHistory.toStatus, 'UNDER_INVESTIGATION')))
        .orderBy(desc(campaignStatusHistory.occurredAt))
        .limit(1);
      previousStatus = (entrada?.from as CampaignStatus | undefined) ?? null;
    }

    const resultado = transition({ action: cmd.action, from: campanha.status as CampaignStatus, actor: cmd.actor, reason: cmd.reason, previousStatus });
    if (!resultado.ok) throw TRANSITION_ERRORS[resultado.error]();

    const agora = new Date();
    await tx
      .update(campaigns)
      .set({
        status: resultado.to,
        version: sql`${campaigns.version} + 1`,
        updatedAt: agora,
        publishedAt: resultado.to === 'ACTIVE' && !campanha.publishedAt ? agora : undefined,
        closedAt: resultado.to === 'ENDED' || resultado.to === 'CANCELLED' ? agora : undefined,
      })
      .where(eq(campaigns.id, campaignId));
    await tx.insert(campaignStatusHistory).values({
      id: newId(),
      campaignId,
      fromStatus: campanha.status,
      toStatus: resultado.to,
      action: cmd.action,
      actorUserId: cmd.actorUserId,
      actorRole: cmd.actor,
      reason: cmd.reason?.trim() || null,
    });
    await this.audit.record(
      {
        actorUserId: cmd.actorUserId,
        action: `campaign.${cmd.action}`,
        targetType: 'campaign',
        targetId: campaignId,
        metadata: { from: campanha.status, to: resultado.to },
      },
      tx,
    );
    await this.outbox.add(tx, {
      type: CAMPAIGN_EVENTS.statusChanged,
      aggregateType: 'campaign',
      aggregateId: campaignId,
      payload: {
        campaignId,
        from: campanha.status,
        to: resultado.to,
        action: cmd.action,
        organizerId: campanha.organizerId,
        reason: cmd.reason?.trim() || null,
      },
    });
    return resultado.to;
  }

  /** Encerra campanhas cujo prazo passou (tarefa periódica do worker). */
  async expireDue(now = new Date()): Promise<number> {
    const vencidas = await this.db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(and(inArray(campaigns.status, ['ACTIVE', 'PAUSED']), lte(campaigns.endsAt, now)));
    for (const { id } of vencidas) {
      await this.db.transaction((tx) => this.changeStatus(tx, id, { action: 'expire', actor: 'system', actorUserId: null }));
    }
    return vencidas.length;
  }

  /** Recalcula a projeção pública a partir do ledger (idempotente e indiferente à ordem dos eventos). */
  async refreshStats(campaignId: string): Promise<void> {
    const resumo = await this.ledger.campaignSummary(campaignId);
    await this.db
      .insert(campaignStats)
      .values({ campaignId, ...this.statsFrom(resumo), updatedAt: new Date() })
      .onConflictDoUpdate({ target: campaignStats.campaignId, set: { ...this.statsFrom(resumo), updatedAt: new Date() } });
  }

  // --- Internos ------------------------------------------------------------------

  private statsFrom(r: Awaited<ReturnType<LedgerService['campaignSummary']>>) {
    return { confirmedCents: r.confirmedCents, feesCents: r.feesCents, refundsCents: r.refundsCents, donationsCount: r.donationsCount };
  }

  private async loadOwned(auth: AuthContext, campaignId: string): Promise<CampaignRow> {
    const [c] = await this.db.select().from(campaigns).where(and(eq(campaigns.id, campaignId), isNull(campaigns.deletedAt))).limit(1);
    // Mesma resposta para "não existe" e "não é seu": não revela campanhas alheias.
    if (!c || c.organizerId !== auth.userId) throw notFound('Campanha');
    return c;
  }

  private async loadPublicBySlug(slug: string): Promise<CampaignRow> {
    const [c] = await this.db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.slug, slug), inArray(campaigns.status, [...PUBLIC_STATUSES]), isNull(campaigns.deletedAt)))
      .limit(1);
    if (!c) throw notFound('Campanha');
    return c;
  }

  private async toDetail(c: CampaignRow): Promise<CampaignDetail> {
    const [budget, imagens, [stats], nomes] = await Promise.all([
      this.db.select().from(campaignBudgetItems).where(eq(campaignBudgetItems.campaignId, c.id)).orderBy(asc(campaignBudgetItems.position)),
      this.db.select({ fileId: campaignImages.fileId }).from(campaignImages).where(eq(campaignImages.campaignId, c.id)).orderBy(asc(campaignImages.position)),
      this.db.select().from(campaignStats).where(eq(campaignStats.campaignId, c.id)).limit(1),
      this.identity.displayNames([c.organizerId]),
    ]);
    const urls = await this.storage.publicUrls(imagens.map((i) => i.fileId));
    return {
      ...this.toCard(c, stats ?? null, urls),
      description: c.description,
      organizer: { id: c.organizerId, name: nomes.get(c.organizerId) ?? 'Organizador' },
      budget: budget.map((b) => ({ id: b.id, category: b.category as CampaignDetail['budget'][number]['category'], description: b.description, plannedCents: b.plannedCents })),
      imageUrls: imagens.map((i) => urls.get(i.fileId)).filter((u): u is string => !!u),
      publishedAt: c.publishedAt?.toISOString() ?? null,
      acceptsDonations: acceptsDonations(c.status as CampaignStatus, c.endsAt),
    };
  }

  private toCard(c: CampaignRow, stats: typeof campaignStats.$inferSelect | null, urls: Map<string, string>): CampaignCard {
    return {
      id: c.id,
      slug: c.slug,
      title: c.title,
      summary: c.summary,
      category: c.category as CampaignCard['category'],
      status: c.status as CampaignStatus,
      goalCents: c.goalCents,
      confirmedCents: stats?.confirmedCents ?? 0,
      donationsCount: stats?.donationsCount ?? 0,
      region: c.region,
      coverUrl: c.coverFileId ? (urls.get(c.coverFileId) ?? null) : null,
      endsAt: c.endsAt.toISOString(),
    };
  }

  private async replaceBudget(tx: Executor, campaignId: string, budget: CreateCampaignInput['budget']): Promise<void> {
    await tx.delete(campaignBudgetItems).where(eq(campaignBudgetItems.campaignId, campaignId));
    await tx.insert(campaignBudgetItems).values(
      budget.map((item, position) => ({ id: newId(), campaignId, category: item.category, description: item.description, plannedCents: item.plannedCents, position })),
    );
  }

  private async assertReadyForReview(c: CampaignRow): Promise<void> {
    const itens = await this.db.select({ plannedCents: campaignBudgetItems.plannedCents }).from(campaignBudgetItems).where(eq(campaignBudgetItems.campaignId, c.id));
    const problema = validateBudget(c.goalCents, itens);
    if (problema === 'EMPTY') throw new DomainError('BUDGET_REQUIRED', 'Inclua o orçamento planejado antes de enviar para análise');
    if (problema === 'TOTAL_DIFFERS_FROM_GOAL') {
      throw new DomainError('BUDGET_MISMATCH', 'A soma do orçamento precisa ser igual à meta da campanha');
    }
    this.assertEndsAtInFuture(c.endsAt.toISOString());
  }

  private assertEndsAtInFuture(endsAt: string): void {
    if (new Date(endsAt).getTime() < Date.now() + 24 * 3600 * 1000) {
      throw new DomainError('INVALID_DEADLINE', 'O prazo precisa terminar pelo menos 24 horas no futuro');
    }
  }

  private assertCanChangeMedia(c: CampaignRow): void {
    if (!EDITABLE_STATUSES.includes(c.status as CampaignStatus)) {
      throw new DomainError('NOT_EDITABLE', 'Imagens só podem ser alteradas em campanhas em rascunho', HttpStatus.CONFLICT);
    }
  }
}

/** Escapa curingas do LIKE vindos do usuário. */
function escapeLike(texto: string): string {
  return texto.replace(/[\\%_]/g, (c) => `\\${c}`);
}

