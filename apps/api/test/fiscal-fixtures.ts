import { readFileSync } from 'node:fs';
import path from 'node:path';
import { accessKeyCheckDigit } from '@soscomida/shared';
import { SignedXml } from 'xml-crypto';

/**
 * XMLs de NF-e/NFC-e FICTÍCIOS para testes: estrutura real do leiaute 4.00,
 * chave com DV correto, mas sem assinatura e sem existência na SEFAZ.
 */
export const EMITENTE_CNPJ = '11222333000181';

let sequencia = 0;

const hoje = () => new Date().toISOString().slice(0, 10);
/** AAMM de hoje: a chave e a data de emissão precisam bater. */
const aammAtual = () => hoje().slice(2, 4) + hoje().slice(5, 7);

export function accessKey(opts: { model?: '55' | '65'; number?: number; cnpj?: string; aamm?: string } = {}): string {
  const numero = opts.number ?? 100_000 + ++sequencia + Math.floor(Math.random() * 800_000_000);
  const base =
    '53' + (opts.aamm ?? aammAtual()) + (opts.cnpj ?? EMITENTE_CNPJ) + (opts.model ?? '65') + '001' + String(numero).padStart(9, '0') + '1' + '12345678';
  return base + String(accessKeyCheckDigit(base));
}

export interface XmlOpts {
  key?: string;
  model?: '55' | '65';
  items?: { description: string; totalCents: number; ncm?: string }[];
  totalCents?: number;
  cStat?: number | null;
  tpAmb?: 1 | 2;
  dhEmi?: string;
  emitCnpj?: string;
  /** Altera um campo depois de montar a chave (simula XML editado). */
  overrideNumber?: number;
}

const dec = (c: number) => `${Math.trunc(c / 100)}.${String(c % 100).padStart(2, '0')}`;

export function nfeXml(o: XmlOpts = {}): { xml: string; key: string } {
  const key = o.key ?? accessKey({ model: o.model });
  const itens = o.items ?? [
    { description: 'ARROZ TIPO 1 5KG', totalCents: 2_590, ncm: '10063021' },
    { description: 'FEIJAO CARIOCA 1KG', totalCents: 899, ncm: '07133319' },
  ];
  const somaItens = itens.reduce((t, i) => t + i.totalCents, 0);
  const total = o.totalCents ?? somaItens;
  const numero = o.overrideNumber ?? Number(key.slice(25, 34));
  const det = itens
    .map(
      (i, n) =>
        `<det nItem="${n + 1}"><prod><cProd>${n + 1}</cProd><xProd>${i.description}</xProd><NCM>${i.ncm ?? '00000000'}</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>1.0000</qCom><vUnCom>${dec(i.totalCents)}</vUnCom><vProd>${dec(i.totalCents)}</vProd></prod><imposto/></det>`,
    )
    .join('');
  const prot =
    o.cStat === null
      ? ''
      : `<protNFe versao="4.00"><infProt><tpAmb>${o.tpAmb ?? 1}</tpAmb><chNFe>${key}</chNFe><dhRecbto>2026-10-05T10:00:05-03:00</dhRecbto><nProt>353260000000001</nProt><digVal>abc=</digVal><cStat>${o.cStat ?? 100}</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${key}" versao="4.00"><ide><cUF>53</cUF><natOp>VENDA</natOp><mod>${key.slice(20, 22)}</mod><serie>${Number(key.slice(22, 25))}</serie><nNF>${numero}</nNF><dhEmi>${o.dhEmi ?? `${hoje()}T10:00:00-03:00`}</dhEmi><tpAmb>${o.tpAmb ?? 1}</tpAmb></ide><emit><CNPJ>${o.emitCnpj ?? key.slice(6, 20)}</CNPJ><xNome>SUPERMERCADO EXEMPLO LTDA</xNome></emit><dest><CPF>52998224725</CPF><xNome>CONSUMIDOR</xNome></dest>${det}<total><ICMSTot><vProd>${dec(somaItens)}</vProd><vDesc>0.00</vDesc><vNF>${dec(total)}</vNF></ICMSTot></total></infNFe></NFe>${prot}</nfeProc>`;
  return { xml, key };
}

const CERTS = path.join(__dirname, 'fixtures', 'certificados');

/**
 * Assina o infNFe como um emissor faria (XMLDSig enveloped, C14N, RSA-SHA1),
 * com certificado FICTÍCIO: "emitente" é emitido por uma AC de teste;
 * "autoassinado" não tem AC.
 */
export function assinarNfe(xml: string, certificado: 'emitente' | 'autoassinado' = 'emitente'): string {
  const c14n = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
  const sig = new SignedXml({
    privateKey: readFileSync(path.join(CERTS, `${certificado}.key`)),
    publicCert: readFileSync(path.join(CERTS, `${certificado}.pem`)),
    canonicalizationAlgorithm: c14n,
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
  });
  sig.addReference({
    xpath: "//*[local-name(.)='infNFe']",
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', c14n],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
  });
  sig.computeSignature(xml, { location: { reference: "//*[local-name(.)='infNFe']", action: 'after' } });
  return sig.getSignedXml();
}

/** PDF mínimo com camada de texto (Helvetica), como um DANFE gerado pelo emissor. Só ASCII. */
export function pdfComTexto(linhas: string[]): Buffer {
  const escapar = (l: string) => l.replace(/[()\\]/g, (m) => `\\${m}`);
  const conteudo = `BT /F1 10 Tf 40 800 Td 14 TL ${linhas.map((l) => `(${escapar(l)}) Tj T*`).join(' ')} ET`;
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(conteudo)} >>\nstream\n${conteudo}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const posicoes: number[] = [];
  objetos.forEach((o, i) => {
    posicoes.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n${posicoes.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/** Chave no formato impresso no DANFE: 11 grupos de 4 dígitos. */
export const chaveImpressa = (k: string) => k.replace(/(\d{4})(?=\d)/g, '$1 ');
