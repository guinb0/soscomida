import { accessKeyCheckDigit } from '@soscomida/shared';

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
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${key}" versao="4.00"><ide><cUF>53</cUF><natOp>VENDA</natOp><mod>${key.slice(20, 22)}</mod><serie>${Number(key.slice(22, 25))}</serie><nNF>${numero}</nNF><dhEmi>${o.dhEmi ?? `${hoje()}T10:00:00-03:00`}</dhEmi><tpAmb>${o.tpAmb ?? 1}</tpAmb></ide><emit><CNPJ>${o.emitCnpj ?? key.slice(6, 20)}</CNPJ><xNome>SUPERMERCADO EXEMPLO LTDA</xNome></emit><dest><CPF>52998224725</CPF><xNome>CONSUMIDOR</xNome></dest>${det}<total><ICMSTot><vProd>${dec(somaItens)}</vProd><vDesc>0.00</vDesc><vNF>${dec(total)}</vNF></ICMSTot></total></infNFe><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"/></NFe>${prot}</nfeProc>`;
  return { xml, key };
}
