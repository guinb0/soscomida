import type { APIRequestContext, BrowserContext } from '@playwright/test';
import { accessKeyCheckDigit } from '@soscomida/shared';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Secret, TOTP } from 'otpauth';

export const RAIZ = path.resolve(import.meta.dirname, '../..');
export const BASE = 'http://localhost:3000';
export const MAILPIT = 'http://127.0.0.1:8025';
export const SENHA = 'senha-de-teste-e2e-123';

export const sufixo = () => randomUUID().slice(0, 8);

export const codigoTotp = (secret: string) => new TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(secret) }).generate();

export function concederPapel(email: string, papel: 'moderator'): void {
  // O e-mail é gerado pelo próprio teste (sem caracteres de shell).
  execSync(`pnpm --filter @soscomida/api grant-role ${email} ${papel}`, { cwd: RAIZ, stdio: 'ignore' });
}

/** Chamadas à API como o navegador faria (cookie do contexto + Origin). */
export function apiDo(ctx: BrowserContext) {
  const r: APIRequestContext = ctx.request;
  const enviar = async <T>(metodo: 'get' | 'post', caminho: string, data?: unknown): Promise<T> => {
    const resp = await r[metodo](`${BASE}/api${caminho}`, { data, headers: { Origin: BASE } });
    if (!resp.ok()) throw new Error(`${metodo.toUpperCase()} ${caminho}: ${resp.status()} ${await resp.text()}`);
    return (await resp.json()) as T;
  };
  return { get: <T>(c: string) => enviar<T>('get', c), post: <T>(c: string, d?: unknown) => enviar<T>('post', c, d ?? {}) };
}

export async function cadastrarViaApi(ctx: BrowserContext, nome: string): Promise<string> {
  const email = `e2e-${sufixo()}@exemplo.com`;
  await apiDo(ctx).post('/auth/register', { name: nome, email, password: SENHA });
  return email;
}

/** Moderadora com MFA ativo na sessão do contexto. */
export async function moderadoraViaApi(ctx: BrowserContext): Promise<string> {
  const email = await cadastrarViaApi(ctx, 'Moderadora E2E');
  concederPapel(email, 'moderator');
  const api = apiDo(ctx);
  const { secret } = await api.post<{ secret: string }>('/auth/mfa/setup');
  await api.post('/auth/mfa/enable', { code: codigoTotp(secret) });
  return email;
}

/** Campanha publicada (criada, analisada e aprovada pela API). */
export async function campanhaAtivaViaApi(org: BrowserContext, mod: BrowserContext, titulo: string) {
  const a = apiDo(org);
  const m = apiDo(mod);
  let c = await a.post<{ id: string; slug: string; version: number }>('/me/campaigns', {
    title: titulo,
    summary: 'Comprar cestas básicas para famílias cadastradas no CRAS da região.',
    description: 'Descrição completa da campanha de teste ponta a ponta. '.repeat(5),
    category: 'ALIMENTACAO',
    goalCents: 150_000,
    region: 'Ceilândia - DF',
    endsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    budget: [{ category: 'ALIMENTOS', description: 'Itens das cestas', plannedCents: 150_000 }],
  });
  c = await a.post(`/me/campaigns/${c.id}/actions/submit`, { version: c.version });
  await m.post(`/moderation/campaigns/${c.id}/claim`, { version: c.version });
  const emAnalise = await m.get<{ version: number }>(`/moderation/campaigns/${c.id}`);
  await m.post(`/moderation/campaigns/${c.id}/decision`, { decision: 'APPROVE', reason: 'Aprovada no e2e.', version: emAnalise.version });
  const aprovada = await a.get<{ version: number }>(`/me/campaigns/${c.id}`);
  return a.post<{ id: string; slug: string }>(`/me/campaigns/${c.id}/actions/publish`, { version: aprovada.version });
}

/** XML de NFC-e FICTÍCIO (chave com DV correto, sem assinatura). */
export function nfceXml(itens: { descricao: string; centavos: number }[]): { xml: string; chave: string } {
  const hoje = new Date().toISOString().slice(0, 10);
  const numero = String(Math.floor(Math.random() * 900_000_000) + 1).padStart(9, '0');
  const base = `53${hoje.slice(2, 4)}${hoje.slice(5, 7)}1122233300018165001${numero}112345678`;
  const chave = base + String(accessKeyCheckDigit(base));
  const dec = (c: number) => `${Math.trunc(c / 100)}.${String(c % 100).padStart(2, '0')}`;
  const total = itens.reduce((t, i) => t + i.centavos, 0);
  const det = itens
    .map((i, n) => `<det nItem="${n + 1}"><prod><xProd>${i.descricao}</xProd><NCM>10063021</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>1.0000</qCom><vProd>${dec(i.centavos)}</vProd></prod></det>`)
    .join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${chave}" versao="4.00"><ide><cUF>53</cUF><mod>65</mod><serie>1</serie><nNF>${Number(numero)}</nNF><dhEmi>${hoje}T10:00:00-03:00</dhEmi><tpAmb>1</tpAmb></ide><emit><CNPJ>11222333000181</CNPJ><xNome>SUPERMERCADO EXEMPLO LTDA</xNome></emit>${det}<total><ICMSTot><vProd>${dec(total)}</vProd><vNF>${dec(total)}</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>${chave}</chNFe><cStat>100</cStat><nProt>1</nProt></infProt></protNFe></nfeProc>`;
  return { xml, chave };
}

/** Envia um arquivo como o navegador faria (URL pré-assinada) e anexa à despesa. */
export async function anexarViaApi(ctx: BrowserContext, despesaId: string, conteudo: Buffer, contentType: string, kind: string) {
  const a = apiDo(ctx);
  const ticket = await a.post<{ fileId: string; uploadUrl: string; headers: Record<string, string> }>(`/me/expenses/${despesaId}/documents/upload-url`, {
    contentType,
    sizeBytes: conteudo.length,
  });
  const put = await fetch(ticket.uploadUrl, { method: 'PUT', body: new Uint8Array(conteudo), headers: ticket.headers });
  if (!put.ok) throw new Error(`Upload falhou: ${put.status}`);
  return a.post<{ id: string; version: number }>(`/me/expenses/${despesaId}/documents`, { fileId: ticket.fileId, kind });
}

/** Despesa com a nota (XML) e enviada para revisão, toda pela API. */
export async function despesaEnviadaViaApi(ctx: BrowserContext, campanhaId: string, descricao: string, itens: { descricao: string; centavos: number }[]) {
  const a = apiDo(ctx);
  const total = itens.reduce((t, i) => t + i.centavos, 0);
  const d = await a.post<{ id: string }>(`/me/campaigns/${campanhaId}/expenses`, {
    budgetCategory: 'ALIMENTOS',
    description: descricao,
    supplierName: 'Supermercado Exemplo',
    supplierDocument: '11222333000181',
    amountCents: total,
    spentOn: new Date().toISOString().slice(0, 10),
  });
  await anexarViaApi(ctx, d.id, Buffer.from(nfceXml(itens).xml), 'application/xml', 'FISCAL');
  const atual = await a.get<{ version: number }>(`/me/expenses/${d.id}`);
  await a.post(`/me/expenses/${d.id}/actions/submit`, { version: atual.version });
  return d.id;
}
