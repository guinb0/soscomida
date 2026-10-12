import { X509Certificate } from 'node:crypto';
import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import type { TrustStore } from './icp-chain';
import { parseNfeXml } from './nfe-xml';

/**
 * Assinatura digital (XMLDSig) do emitente no XML da NF-e/NFC-e.
 *
 * O que VALID afirma: o trecho `infNFe` não foi alterado depois de assinado
 * pela chave do certificado embutido, e esse trecho é o mesmo que a plataforma
 * leu (chave, emitente, total e itens). O certificado é conferido à parte:
 * cadeia até uma raiz ICP-Brasil (icp-chain.ts, sem consulta de revogação),
 * CNPJ do certificado × emitente e validade na data de emissão. Mesmo tudo
 * certo, isso prova quem assinou o arquivo — não que a nota está autorizada
 * no fisco: autenticidade fiscal continua dependendo da consulta oficial.
 */
export type SignatureStatus = 'VALID' | 'MISSING' | 'INVALID';

export interface SignatureCertificate {
  subject: string;
  issuer: string;
  /** CNPJ no CN do e-CNPJ ICP-Brasil ("RAZAO SOCIAL:CNPJ"), se houver. */
  cnpj: string | null;
  validFrom: string;
  validTo: string;
  selfSigned: boolean;
  /** Mesma raiz de CNPJ (8 dígitos) do emitente da nota. */
  matchesIssuer: boolean;
  /** Certificado válido na data de emissão da nota (null sem data). */
  validAtIssue: boolean | null;
  /** Cadeia até uma raiz do repositório de confiança (ICP-Brasil). */
  icpBrasil: boolean;
  chain: string[];
  chainProblem: string | null;
}

export type SignatureCheck =
  | { status: 'VALID'; certificate: SignatureCertificate }
  | { status: 'MISSING' }
  | { status: 'INVALID'; reason: SignatureFailure; detail?: string };

export type SignatureFailure =
  | 'MALFORMED'
  | 'MULTIPLE_SIGNATURES'
  | 'DUPLICATE_ID'
  | 'NO_CERTIFICATE'
  | 'BAD_CERTIFICATE'
  | 'WRONG_REFERENCE'
  | 'CONTENT_ALTERED'
  | 'SIGNED_CONTENT_DIFFERS';

export const SIGNATURE_FAILURE_LABELS: Record<SignatureFailure, string> = {
  MALFORMED: 'XML malformado',
  MULTIPLE_SIGNATURES: 'Mais de uma assinatura do emitente',
  DUPLICATE_ID: 'Identificador da nota repetido (possível ataque de embrulho)',
  NO_CERTIFICATE: 'Assinatura sem certificado',
  BAD_CERTIFICATE: 'Certificado ilegível',
  WRONG_REFERENCE: 'A assinatura não cobre a nota',
  CONTENT_ALTERED: 'O conteúdo foi alterado depois de assinado',
  SIGNED_CONTENT_DIFFERS: 'O trecho assinado é diferente do lido',
};

const DSIG = 'http://www.w3.org/2000/09/xmldsig#';

const elementos = (raiz: Element | Document, nome: string): Element[] => {
  const lista = raiz.getElementsByTagName('*');
  const r: Element[] = [];
  for (let i = 0; i < lista.length; i++) {
    const e = lista.item(i) as Element;
    if (e.localName === nome) r.push(e);
  }
  return r;
};

function lerCertificado(base64: string, emitente: string, emitidaEm: string | null, confianca: TrustStore): SignatureCertificate {
  const der = Buffer.from(base64.replace(/\s+/g, ''), 'base64');
  const c = new X509Certificate(der);
  const cn = /(?:^|\n)CN=([^\n]+)/.exec(c.subject)?.[1] ?? '';
  const cnpj = /:(\d{14})$/.exec(cn.trim())?.[1] ?? null;
  const inicio = new Date(c.validFrom);
  const fim = new Date(c.validTo);
  const emissao = emitidaEm ? new Date(emitidaEm) : null;
  const dataValida = emissao && !Number.isNaN(emissao.getTime()) ? emissao : null;
  const cadeia = confianca.chainFor(c, dataValida);
  return {
    subject: c.subject.replace(/\n/g, ', '),
    issuer: c.issuer.replace(/\n/g, ', '),
    cnpj,
    validFrom: inicio.toISOString(),
    validTo: fim.toISOString(),
    selfSigned: c.subject === c.issuer && c.verify(c.publicKey),
    matchesIssuer: cnpj !== null && cnpj.slice(0, 8) === emitente.slice(0, 8),
    validAtIssue: dataValida ? dataValida >= inicio && dataValida <= fim : null,
    icpBrasil: cadeia.trusted,
    chain: cadeia.chain,
    chainProblem: cadeia.problem,
  };
}

export function certificateProblems(c: SignatureCertificate): string[] {
  const p: string[] = [];
  if (!c.matchesIssuer) p.push(c.cnpj ? 'CNPJ do certificado diferente do emitente' : 'Certificado sem CNPJ de e-CNPJ ICP-Brasil');
  if (c.validAtIssue === false) p.push('Certificado fora da validade na data de emissão');
  if (c.selfSigned) p.push('Certificado autoassinado');
  else if (!c.icpBrasil) p.push(c.chainProblem ?? 'Certificado fora da cadeia ICP-Brasil');
  return p;
}

/** O que fica gravado no documento fiscal. */
export interface SignatureDetails {
  reason?: SignatureFailure;
  detail?: string;
  certificate?: SignatureCertificate;
  problems: string[];
}

export function signatureDetails(c: SignatureCheck): SignatureDetails {
  if (c.status === 'VALID') return { certificate: c.certificate, problems: certificateProblems(c.certificate) };
  if (c.status === 'MISSING') return { problems: ['XML sem assinatura digital do emitente'] };
  return { reason: c.reason, ...(c.detail ? { detail: c.detail } : {}), problems: [SIGNATURE_FAILURE_LABELS[c.reason]] };
}

/** Confere a assinatura do emitente. Chamar só com XML já aceito por parseNfeXml. */
export function verifyNfeSignature(xml: string, confianca: TrustStore): SignatureCheck {
  const lido = parseNfeXml(xml);
  if (!lido.ok) return { status: 'INVALID', reason: 'MALFORMED' };
  const nota = lido.value;

  const erros: string[] = [];
  const doc = new DOMParser({ errorHandler: { error: (m: unknown) => void erros.push(String(m)), fatalError: (m: unknown) => void erros.push(String(m)) } }).parseFromString(xml, 'text/xml');
  if (erros.length || !doc.documentElement) return { status: 'INVALID', reason: 'MALFORMED' };

  const infs = elementos(doc, 'infNFe');
  if (infs.length !== 1) return { status: 'INVALID', reason: 'MALFORMED' };
  const nfe = infs[0]!.parentNode as Element | null;
  const id = infs[0]!.getAttribute('Id') ?? '';

  // Só a assinatura do emitente (filha de NFe). A do protocolo é da SEFAZ.
  const assinaturas = elementos(doc, 'Signature').filter((s) => s.namespaceURI === DSIG && s.parentNode === nfe);
  if (assinaturas.length === 0) return { status: 'MISSING' };
  if (assinaturas.length > 1) return { status: 'INVALID', reason: 'MULTIPLE_SIGNATURES' };
  const assinatura = assinaturas[0]!;

  // Outro elemento com o mesmo Id permitiria assinar um trecho e exibir outro.
  const comMesmoId = doc.getElementsByTagName('*');
  let iguais = 0;
  for (let i = 0; i < comMesmoId.length; i++) {
    const e = comMesmoId.item(i) as Element;
    for (const a of ['Id', 'ID', 'id']) if (e.getAttribute(a) === id) iguais++;
  }
  if (iguais !== 1) return { status: 'INVALID', reason: 'DUPLICATE_ID' };

  const certNo = elementos(assinatura, 'X509Certificate')[0];
  const base64 = certNo?.textContent?.trim();
  if (!base64) return { status: 'INVALID', reason: 'NO_CERTIFICATE' };
  let certificado: SignatureCertificate;
  let pem: string;
  try {
    certificado = lerCertificado(base64, nota.issuer.document, nota.issuedAt, confianca);
    pem = `-----BEGIN CERTIFICATE-----\n${base64.replace(/\s+/g, '').replace(/.{64}/g, '$&\n')}\n-----END CERTIFICATE-----\n`;
  } catch {
    return { status: 'INVALID', reason: 'BAD_CERTIFICATE' };
  }

  const sig = new SignedXml({ publicCert: pem });
  let assinado: string[];
  try {
    sig.loadSignature(assinatura);
    if (!sig.checkSignature(xml)) return { status: 'INVALID', reason: 'CONTENT_ALTERED' };
    assinado = sig.getSignedReferences();
  } catch (error) {
    const detalhe = error instanceof Error ? error.message.slice(0, 300) : undefined;
    return { status: 'INVALID', reason: 'CONTENT_ALTERED', ...(detalhe ? { detail: detalhe } : {}) };
  }
  if (assinado.length !== 1) return { status: 'INVALID', reason: 'WRONG_REFERENCE' };

  // Usa só o trecho autenticado para conferir o que foi lido do arquivo.
  const trecho = parseNfeXml(`<NFe>${assinado[0]}</NFe>`);
  if (!trecho.ok) return { status: 'INVALID', reason: 'WRONG_REFERENCE' };
  const t = trecho.value;
  const mesmo =
    t.accessKey === nota.accessKey &&
    t.totalCents === nota.totalCents &&
    t.issuer.document === nota.issuer.document &&
    t.items.length === nota.items.length &&
    t.items.every((i, n) => i.totalCents === nota.items[n]!.totalCents && i.description === nota.items[n]!.description);
  if (!mesmo) return { status: 'INVALID', reason: 'SIGNED_CONTENT_DIFFERS' };

  return { status: 'VALID', certificate: certificado };
}
