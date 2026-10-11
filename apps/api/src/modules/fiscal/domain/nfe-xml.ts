import { type FiscalModel, decimalToCents, onlyDigits, parseAccessKey } from '@soscomida/shared';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

/**
 * Leitura do XML de NF-e (55) e NFC-e (65), no formato distribuído ao
 * comprador (`nfeProc` = nota + protocolo de autorização) ou só a `NFe`.
 *
 * O que este leitor afirma: a estrutura é de uma NF-e, a chave é válida e
 * coerente com os campos da nota, e o XML **declara** um protocolo. Ele NÃO
 * afirma que a nota é autêntica: a assinatura digital não é verificada aqui e
 * um XML pode ser editado. Autenticidade só vem de consulta oficial
 * (FiscalVerificationProvider).
 */
export interface ParsedNfeItem {
  position: number;
  description: string;
  ncm: string | null;
  cfop: string | null;
  unit: string | null;
  /** Decimal como veio no XML (até 4 casas); não é dinheiro. */
  quantity: string | null;
  totalCents: number;
}

export interface ParsedNfe {
  accessKey: string;
  model: FiscalModel;
  uf: string;
  series: number;
  number: number;
  issuedAt: string | null;
  /** 1 = produção; 2 = homologação (sem valor fiscal). */
  environment: 1 | 2 | null;
  issuer: { document: string; name: string | null };
  totalCents: number;
  items: ParsedNfeItem[];
  protocol: { status: number; message: string | null; number: string | null; receivedAt: string | null } | null;
  /** Incoerências internas encontradas (vão para a revisão humana). */
  warnings: string[];
}

export type NfeXmlError = 'XML_INVALIDO' | 'XML_PROIBIDO' | 'NAO_E_NFE' | 'CHAVE_INVALIDA' | 'GRANDE_DEMAIS';

export type NfeXmlResult = { ok: true; value: ParsedNfe } | { ok: false; error: NfeXmlError };

const MAX_XML_BYTES = 5 * 1024 * 1024;

type Node = Record<string, unknown>;
const no = (v: unknown): Node | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Node) : null);
const texto = (v: unknown): string | null => {
  if (typeof v === 'string') return v.trim() || null;
  const n = no(v);
  return n && typeof n['#text'] === 'string' ? n['#text'].trim() || null : null;
};
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  // Tudo como texto: valores fiscais nunca passam por número de ponto flutuante.
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: false,
  htmlEntities: false,
});

const centavos = (v: unknown): number | null => {
  const t = texto(v);
  if (!t) return null;
  try {
    return decimalToCents(t);
  } catch {
    return null;
  }
};

export function parseNfeXml(conteudo: Buffer | string): NfeXmlResult {
  const bruto = typeof conteudo === 'string' ? conteudo : conteudo.toString('utf8');
  if (Buffer.byteLength(bruto) > MAX_XML_BYTES) return { ok: false, error: 'GRANDE_DEMAIS' };
  // Sem DTD e sem entidades: fecha a porta para XXE e "billion laughs".
  if (/<!DOCTYPE|<!ENTITY/i.test(bruto)) return { ok: false, error: 'XML_PROIBIDO' };

  if (XMLValidator.validate(bruto) !== true) return { ok: false, error: 'XML_INVALIDO' };

  let raiz: Node;
  try {
    raiz = parser.parse(bruto) as Node;
  } catch {
    return { ok: false, error: 'XML_INVALIDO' };
  }

  const proc = no(raiz.nfeProc);
  const nfe = no(proc?.NFe ?? raiz.NFe);
  const inf = no(nfe?.infNFe);
  if (!inf) return { ok: false, error: 'NAO_E_NFE' };

  const id = typeof inf['@_Id'] === 'string' ? inf['@_Id'] : '';
  const chave = parseAccessKey(id.replace(/^NFe/, ''));
  if (!chave.ok) return { ok: false, error: 'CHAVE_INVALIDA' };
  const k = chave.value;

  const ide = no(inf.ide) ?? {};
  const emit = no(inf.emit) ?? {};
  const icmsTot = no(no(inf.total)?.ICMSTot) ?? {};
  const avisos: string[] = [];

  const modelo = texto(ide.mod);
  const serie = texto(ide.serie);
  const numero = texto(ide.nNF);
  const emitente = onlyDigits(texto(emit.CNPJ) ?? texto(emit.CPF) ?? '');
  const emitidaEm = texto(ide.dhEmi) ?? texto(ide.dEmi);
  const amb = texto(ide.tpAmb);

  // A chave repete campos da nota; divergência indica XML montado ou editado.
  if (texto(ide.cUF) !== k.ufCode) avisos.push('UF da nota diferente da chave de acesso');
  if (modelo !== (k.model === 'NFE_55' ? '55' : '65')) avisos.push('Modelo da nota diferente da chave de acesso');
  if (serie === null || Number(serie) !== k.series) avisos.push('Série da nota diferente da chave de acesso');
  if (numero === null || Number(numero) !== k.number) avisos.push('Número da nota diferente da chave de acesso');
  if (emitente !== k.issuerDocument) avisos.push('Emitente da nota diferente da chave de acesso');
  if (emitidaEm) {
    const m = /^(\d{4})-(\d{2})/.exec(emitidaEm);
    if (!m || Number(m[1]) !== k.issueYear || Number(m[2]) !== k.issueMonth) avisos.push('Data de emissão diferente do ano/mês da chave de acesso');
  }

  const itens: ParsedNfeItem[] = lista(inf.det).map((d, i) => {
    const prod = no(no(d)?.prod) ?? {};
    const valor = centavos(prod.vProd);
    if (valor === null) avisos.push(`Item ${i + 1} sem valor legível`);
    return {
      position: i + 1,
      description: texto(prod.xProd) ?? '(sem descrição)',
      ncm: texto(prod.NCM),
      cfop: texto(prod.CFOP),
      unit: texto(prod.uCom),
      quantity: texto(prod.qCom),
      totalCents: valor ?? 0,
    };
  });

  const total = centavos(icmsTot.vNF);
  if (total === null) return { ok: false, error: 'NAO_E_NFE' };
  const somaProdutos = centavos(icmsTot.vProd);
  if (somaProdutos !== null && itens.reduce((t, i) => t + i.totalCents, 0) !== somaProdutos) {
    avisos.push('Soma dos itens diferente do total de produtos da nota');
  }

  const infProt = no(no(proc?.protNFe)?.infProt);
  let protocolo: ParsedNfe['protocol'] = null;
  if (infProt) {
    const chaveProt = texto(infProt.chNFe);
    if (chaveProt && chaveProt !== k.key) avisos.push('Protocolo de autorização é de outra chave de acesso');
    const status = Number(texto(infProt.cStat));
    protocolo = {
      status: Number.isFinite(status) ? status : 0,
      message: texto(infProt.xMotivo),
      number: texto(infProt.nProt),
      receivedAt: texto(infProt.dhRecbto),
    };
  }

  return {
    ok: true,
    value: {
      accessKey: k.key,
      model: k.model,
      uf: k.uf,
      series: k.series,
      number: k.number,
      issuedAt: emitidaEm,
      environment: amb === '1' ? 1 : amb === '2' ? 2 : null,
      issuer: { document: k.issuerDocument, name: texto(emit.xNome) },
      totalCents: total,
      items: itens,
      protocol: protocolo,
      warnings: avisos,
    },
  };
}
