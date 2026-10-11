import type { FiscalModel } from '@soscomida/shared';

/** O que se sabe do documento na hora de consultar o fisco. */
export interface FiscalDocumentRef {
  accessKey: string;
  model: FiscalModel;
  uf: string;
  issuerDocument: string;
  totalCents: number | null;
}

export type UnverifiableReason = 'REQUIRES_CERTIFICATE' | 'REQUIRES_CAPTCHA' | 'NO_INTEGRATION' | 'SOURCE_UNAVAILABLE' | 'HOMOLOGATION_DOCUMENT';

export interface Evidence {
  /** Como a consulta foi feita (ex.: webservice NFeConsultaProtocolo 4.00). */
  method: string;
  observedAt: string;
  /** Campos relevantes da resposta oficial (sem dados pessoais). */
  summary: Record<string, unknown>;
  /** SHA-256 da resposta completa, guardada fora do banco se necessário. */
  rawSha256?: string;
}

export type FiscalVerificationResult =
  | { status: 'AUTHORIZED'; evidence: Evidence }
  | { status: 'CANCELLED' | 'NOT_FOUND' | 'DIVERGENT'; evidence: Evidence; details: string }
  | { status: 'UNVERIFIABLE'; reason: UnverifiableReason; details: string };

/**
 * Consulta de autenticidade junto a uma fonte oficial. Cada integração
 * (webservice da SEFAZ com certificado, ambiente nacional da NFS-e, agregador
 * contratado) é um provedor. Regras: sem contorno de CAPTCHA e sem raspagem de
 * portal que a proíbe — nesses casos o resultado é UNVERIFIABLE.
 */
export interface FiscalVerificationProvider {
  readonly name: string;
  supports(doc: FiscalDocumentRef): boolean;
  verify(doc: FiscalDocumentRef): Promise<FiscalVerificationResult>;
}

export const FISCAL_VERIFICATION_PROVIDERS = Symbol('FISCAL_VERIFICATION_PROVIDERS');
