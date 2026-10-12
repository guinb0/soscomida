import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { type NfceQrData, parseAccessKey, parseNfceQrCode } from '@soscomida/shared';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { DB, type Database, type Executor } from '../../infra/db/db';
import { DomainError, notFound } from '../../infra/http/errors';
import { newId } from '../../infra/ids';
import { OutboxService } from '../outbox';
import { StorageService } from '../storage';
import { type ParsedNfe, parseNfeXml } from './domain/nfe-xml';
import { type SignatureCheck, type SignatureDetails, signatureDetails, verifyNfeSignature } from './domain/xml-signature';
import { FISCAL_VERIFICATION_PROVIDERS, type FiscalVerificationProvider, type FiscalVerificationResult } from './domain/verification';
import { fiscalDocumentItems, fiscalDocuments, fiscalVerifications } from './infra/fiscal.schema';
import { findAccessKeys, pdfText } from './infra/pdf-text';
import { readQrCode } from './infra/qr-reader';

export const FISCAL_EVENTS = {
  registered: 'FiscalDocumentRegistered',
  verified: 'FiscalDocumentVerified',
} as const;

const XML_ERRORS: Record<string, string> = {
  XML_INVALIDO: 'O XML está corrompido ou incompleto.',
  XML_PROIBIDO: 'O XML tem construções não permitidas (DTD/entidades).',
  NAO_E_NFE: 'O XML não é de uma NF-e ou NFC-e.',
  CHAVE_INVALIDA: 'A chave de acesso do XML é inválida.',
  GRANDE_DEMAIS: 'O XML é grande demais.',
};

/** Resultado da leitura automática de um arquivo. */
export type Extraction =
  | { kind: 'NFE_XML'; parsed: ParsedNfe; signature: SignatureCheck }
  | { kind: 'NFCE_QR'; qr: NfceQrData }
  /** Chave achada no texto do PDF (DANFE); o total vem do organizador. */
  | { kind: 'PDF_KEY'; accessKey: string }
  | { kind: 'NONE'; reason: string };

export interface FiscalDocumentView {
  id: string;
  accessKey: string;
  model: 'NFE_55' | 'NFCE_65';
  uf: string;
  series: number;
  number: number;
  issuedAt: string | null;
  environment: number | null;
  issuerDocument: string;
  issuerName: string | null;
  totalCents: number | null;
  declaredTotalCents: number | null;
  /** Total usado como limite do rateio: o lido do documento, senão o declarado. */
  effectiveTotalCents: number | null;
  source: 'XML' | 'QR_CODE' | 'ACCESS_KEY';
  protocolStatus: number | null;
  warnings: string[];
  signatureStatus: 'VALID' | 'MISSING' | 'INVALID' | null;
  signatureDetails: SignatureDetails | null;
  verificationStatus: string;
  verificationReason: string | null;
  verifiedAt: string | null;
  items: { position: number; description: string; ncm: string | null; quantity: string | null; unit: string | null; totalCents: number }[];
}

type NormalizedItem = { position: number; description: string; ncm: string | null; cfop: string | null; unit: string | null; quantity: string | null; totalCents: number };

const PRIORIDADE = { ACCESS_KEY: 0, QR_CODE: 1, XML: 2 } as const;

const dataValida = (v: string | null): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

@Injectable()
export class FiscalService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(FISCAL_VERIFICATION_PROVIDERS) private readonly providers: FiscalVerificationProvider[],
    private readonly storage: StorageService,
    private readonly outbox: OutboxService,
  ) {}

  /** Lê o que der do arquivo: XML de NF-e, QR Code de NFC-e na foto, ou nada (PDF/imagem sem QR). */
  async extractFromFile(fileId: string): Promise<Extraction> {
    const info = (await this.storage.filesInfo([fileId])).get(fileId);
    if (!info) throw notFound('Arquivo');
    const conteudo = await this.storage.readValidated(fileId);

    if (info.mimeType === 'application/xml') {
      const r = parseNfeXml(conteudo);
      if (!r.ok) throw new DomainError(`FISCAL_${r.error}`, XML_ERRORS[r.error] ?? 'XML não reconhecido');
      return { kind: 'NFE_XML', parsed: r.value, signature: verifyNfeSignature(conteudo.toString('utf8')) };
    }
    if (info.mimeType.startsWith('image/')) {
      const texto = await readQrCode(conteudo);
      if (!texto) return { kind: 'NONE', reason: 'Nenhum QR Code encontrado na imagem. Informe a chave de acesso impressa no cupom.' };
      const qr = parseNfceQrCode(texto);
      if (!qr.ok) return { kind: 'NONE', reason: 'O QR Code encontrado não é de uma NFC-e válida. Informe a chave de acesso.' };
      return { kind: 'NFCE_QR', qr: qr.value };
    }
    const texto = await pdfText(conteudo).catch(() => '');
    const achado = findAccessKeys(texto);
    if (achado.kind === 'FOUND') return { kind: 'PDF_KEY', accessKey: achado.accessKey };
    if (achado.kind === 'AMBIGUOUS') return { kind: 'NONE', reason: `O PDF tem ${achado.count} chaves de acesso diferentes. Informe a chave desta nota.` };
    return {
      kind: 'NONE',
      reason: texto.trim()
        ? 'Não achei a chave de acesso no texto do PDF. Informe a chave (44 dígitos) impressa no DANFE.'
        : 'O PDF não tem texto (parece escaneado). Informe a chave de acesso (44 dígitos) impressa no DANFE.',
    };
  }

  /**
   * Registra (ou reaproveita) o documento pela chave de acesso. Se a chave já
   * existe com dados menos confiáveis (ex.: veio do QR e agora chegou o XML),
   * os dados são completados. Roda na transação do chamador.
   */
  async register(
    tx: Executor,
    input: { extraction: Exclude<Extraction, { kind: 'NONE' }> } | { accessKey: string; declaredTotalCents: number },
    ctx: { fileId: string | null; userId: string },
  ): Promise<{ documentId: string; created: boolean }> {
    const dados = this.normalize(input);
    // ON CONFLICT: duas despesas registrando a mesma nota ao mesmo tempo não
    // geram erro; a segunda espera o commit da primeira e segue com o registro dela.
    const id = newId();
    const inseridos = await tx
      .insert(fiscalDocuments)
      .values({ id, ...dados.doc, sourceFileId: ctx.fileId, createdBy: ctx.userId })
      .onConflictDoNothing({ target: fiscalDocuments.accessKey })
      .returning({ id: fiscalDocuments.id });
    if (inseridos.length) {
      if (dados.items.length) await tx.insert(fiscalDocumentItems).values(dados.items.map((i) => ({ id: newId(), documentId: id, ...i })));
      await this.outbox.add(tx, { type: FISCAL_EVENTS.registered, aggregateType: 'fiscal_document', aggregateId: id, payload: { documentId: id } });
      return { documentId: id, created: true };
    }
    const [existente] = await tx.select().from(fiscalDocuments).where(eq(fiscalDocuments.accessKey, dados.accessKey)).for('update');
    if (!existente) throw new Error('Documento fiscal sumiu entre o conflito e a leitura');

    const melhora = PRIORIDADE[dados.doc.source] > PRIORIDADE[existente.source as keyof typeof PRIORIDADE];
    if (melhora) {
      await tx
        .update(fiscalDocuments)
        .set({ ...dados.doc, declaredTotalCents: existente.declaredTotalCents, sourceFileId: ctx.fileId, updatedAt: new Date() })
        .where(eq(fiscalDocuments.id, existente.id));
      if (dados.items.length) {
        await tx.delete(fiscalDocumentItems).where(eq(fiscalDocumentItems.documentId, existente.id));
        await tx.insert(fiscalDocumentItems).values(dados.items.map((i) => ({ id: newId(), documentId: existente.id, ...i })));
      }
    } else if (existente.totalCents === null && existente.declaredTotalCents === null && dados.doc.declaredTotalCents) {
      await tx.update(fiscalDocuments).set({ declaredTotalCents: dados.doc.declaredTotalCents, updatedAt: new Date() }).where(eq(fiscalDocuments.id, existente.id));
    }
    return { documentId: existente.id, created: false };
  }

  /** Trava o documento para rateio e devolve o total que limita as alocações. */
  async lockForAllocation(tx: Executor, documentId: string): Promise<{ effectiveTotalCents: number | null }> {
    const [d] = await tx
      .select({ totalCents: fiscalDocuments.totalCents, declared: fiscalDocuments.declaredTotalCents })
      .from(fiscalDocuments)
      .where(eq(fiscalDocuments.id, documentId))
      .for('update');
    if (!d) throw notFound('Documento fiscal');
    return { effectiveTotalCents: d.totalCents ?? d.declared };
  }

  async views(ids: string[]): Promise<Map<string, FiscalDocumentView>> {
    if (ids.length === 0) return new Map();
    const [docs, itens] = await Promise.all([
      this.db.select().from(fiscalDocuments).where(inArray(fiscalDocuments.id, ids)),
      this.db.select().from(fiscalDocumentItems).where(inArray(fiscalDocumentItems.documentId, ids)).orderBy(asc(fiscalDocumentItems.position)),
    ]);
    return new Map(
      docs.map((d) => [
        d.id,
        {
          id: d.id,
          accessKey: d.accessKey,
          model: d.model as FiscalDocumentView['model'],
          uf: d.uf,
          series: d.series,
          number: d.number,
          issuedAt: d.issuedAt?.toISOString() ?? null,
          environment: d.environment,
          issuerDocument: d.issuerDocument,
          issuerName: d.issuerName,
          totalCents: d.totalCents,
          declaredTotalCents: d.declaredTotalCents,
          effectiveTotalCents: d.totalCents ?? d.declaredTotalCents,
          source: d.source as FiscalDocumentView['source'],
          protocolStatus: d.protocolStatus,
          warnings: d.warnings,
          signatureStatus: d.signatureStatus as FiscalDocumentView['signatureStatus'],
          signatureDetails: d.signatureDetails ?? null,
          verificationStatus: d.verificationStatus,
          verificationReason: d.verificationReason,
          verifiedAt: d.verifiedAt?.toISOString() ?? null,
          items: itens
            .filter((i) => i.documentId === d.id)
            .map((i) => ({ position: i.position, description: i.description, ncm: i.ncm, quantity: i.quantity, unit: i.unit, totalCents: i.totalCents })),
        },
      ]),
    );
  }

  async verificationHistory(documentId: string) {
    return this.db.select().from(fiscalVerifications).where(eq(fiscalVerifications.documentId, documentId)).orderBy(desc(fiscalVerifications.createdAt));
  }

  /**
   * Consulta o primeiro provedor que atende o documento e grava a tentativa.
   * Falha de rede vira UNVERIFIABLE/SOURCE_UNAVAILABLE gravado, e a exceção
   * sobe para a fila tentar de novo.
   */
  async verify(documentId: string): Promise<FiscalVerificationResult> {
    const [d] = await this.db.select().from(fiscalDocuments).where(eq(fiscalDocuments.id, documentId));
    if (!d) throw notFound('Documento fiscal');

    let provedor = 'platform';
    let resultado: FiscalVerificationResult;
    let falha: unknown = null;
    if (d.environment === 2) {
      resultado = { status: 'UNVERIFIABLE', reason: 'HOMOLOGATION_DOCUMENT', details: 'Documento emitido em ambiente de homologação (teste): não tem valor fiscal.' };
    } else {
      const ref = { accessKey: d.accessKey, model: d.model as 'NFE_55' | 'NFCE_65', uf: d.uf, issuerDocument: d.issuerDocument, totalCents: d.totalCents };
      const p = this.providers.find((x) => x.supports(ref));
      provedor = p?.name ?? 'none';
      try {
        resultado = p ? await p.verify(ref) : { status: 'UNVERIFIABLE', reason: 'NO_INTEGRATION', details: 'Nenhum provedor configurado' };
      } catch (error) {
        falha = error;
        resultado = { status: 'UNVERIFIABLE', reason: 'SOURCE_UNAVAILABLE', details: error instanceof Error ? error.message.slice(0, 500) : 'Falha na consulta' };
      }
    }

    await this.db.transaction(async (tx) => {
      await tx.insert(fiscalVerifications).values({
        id: newId(),
        documentId,
        provider: provedor,
        status: resultado.status,
        reason: resultado.status === 'UNVERIFIABLE' ? resultado.reason : null,
        details: 'details' in resultado ? resultado.details : null,
        evidence: 'evidence' in resultado ? { ...resultado.evidence } : null,
      });
      await tx
        .update(fiscalDocuments)
        .set({
          verificationStatus: resultado.status,
          verificationReason: resultado.status === 'UNVERIFIABLE' ? resultado.reason : 'details' in resultado ? resultado.details : null,
          verifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(fiscalDocuments.id, documentId));
      await this.outbox.add(tx, { type: FISCAL_EVENTS.verified, aggregateType: 'fiscal_document', aggregateId: documentId, payload: { documentId, status: resultado.status } });
    });
    if (falha) throw falha instanceof Error ? falha : new Error('Falha na consulta fiscal');
    return resultado;
  }

  private normalize(input: { extraction: Exclude<Extraction, { kind: 'NONE' }> } | { accessKey: string; declaredTotalCents: number }) {
    if ('accessKey' in input) return this.keyOnly(input.accessKey, input.declaredTotalCents);
    const e = input.extraction;
    if (e.kind === 'PDF_KEY') return this.keyOnly(e.accessKey, null);
    if (e.kind === 'NFCE_QR') {
      const k = e.qr.accessKey;
      return {
        accessKey: k.key,
        doc: {
          accessKey: k.key,
          model: k.model,
          uf: k.uf,
          series: k.series,
          number: k.number,
          issuedAt: null,
          environment: e.qr.environment,
          issuerDocument: k.issuerDocument,
          issuerName: null,
          totalCents: e.qr.totalCents,
          declaredTotalCents: null,
          source: 'QR_CODE' as const,
          protocolStatus: null,
          protocolNumber: null,
          protocolMessage: null,
          warnings: [] as string[],
          signatureStatus: null,
          signatureDetails: null,
        },
        items: [] as NormalizedItem[],
      };
    }
    const p = e.parsed;
    return {
      accessKey: p.accessKey,
      doc: {
        accessKey: p.accessKey,
        model: p.model,
        uf: p.uf,
        series: p.series,
        number: p.number,
        issuedAt: dataValida(p.issuedAt),
        environment: p.environment,
        issuerDocument: p.issuer.document,
        issuerName: p.issuer.name,
        totalCents: p.totalCents,
        declaredTotalCents: null,
        source: 'XML' as const,
        protocolStatus: p.protocol?.status ?? null,
        protocolNumber: p.protocol?.number ?? null,
        protocolMessage: p.protocol?.message ?? null,
        warnings: p.warnings,
        signatureStatus: e.signature.status,
        signatureDetails: signatureDetails(e.signature) as SignatureDetails | null,
      },
      items: p.items.map((i): NormalizedItem => ({ position: i.position, description: i.description, ncm: i.ncm, cfop: i.cfop, unit: i.unit, quantity: i.quantity, totalCents: i.totalCents })),
    };
  }

  /** Só a chave (digitada ou lida do PDF): os campos vêm da própria chave. */
  private keyOnly(chave: string, declarado: number | null) {
    const k = parseAccessKey(chave);
    if (!k.ok) throw new DomainError('FISCAL_ACCESS_KEY_INVALID', 'Chave de acesso inválida: confira os 44 dígitos.', HttpStatus.UNPROCESSABLE_ENTITY, { error: k.error });
    return {
      accessKey: k.value.key,
      doc: {
        accessKey: k.value.key,
        model: k.value.model,
        uf: k.value.uf,
        series: k.value.series,
        number: k.value.number,
        issuedAt: null,
        environment: null,
        issuerDocument: k.value.issuerDocument,
        issuerName: null,
        totalCents: null,
        declaredTotalCents: declarado,
        source: 'ACCESS_KEY' as const,
        protocolStatus: null,
        protocolNumber: null,
        protocolMessage: null,
        warnings: [] as string[],
        signatureStatus: null,
        signatureDetails: null,
      },
      items: [] as NormalizedItem[],
    };
  }
}
