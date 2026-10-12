import type { CampaignTransparency, OwnedExpense, PublicExpense } from '@soscomida/contracts';
import { accessKeyCheckDigit } from '@soscomida/shared';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import sharp from 'sharp';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestApp, agent, createTestApp, registeredUser, userWithRole } from './app';
import { accessKey, assinarNfe, nfeXml } from './fiscal-fixtures';
import { activeCampaign, campaignInput, drainOutbox } from './fixtures';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

/** PDF mínimo com conteúdo único (o mesmo arquivo em duas despesas gera alerta de duplicidade). */
const pdf = () => Buffer.from(['%PDF-1.4', `% ${randomUUID()}`, '1 0 obj<<>>endobj', 'trailer<<>>', '%%EOF', ''].join('\n'));

const despesaInput = (over: Record<string, unknown> = {}) => ({
  budgetCategory: 'ALIMENTOS',
  description: 'Compra de arroz e feijão para as cestas',
  supplierName: 'Supermercado Exemplo',
  supplierDocument: '11.222.333/0001-81',
  amountCents: 3_489,
  spentOn: new Date().toISOString().slice(0, 10),
  ...over,
});

async function enviar(http: TestAgent, expenseId: string, conteudo: Buffer, contentType: string): Promise<string> {
  const ticket = (await http.post(`/api/me/expenses/${expenseId}/documents/upload-url`).send({ contentType, sizeBytes: conteudo.length }).expect(201)).body as {
    fileId: string;
    uploadUrl: string;
    headers: Record<string, string>;
  };
  const put = await fetch(ticket.uploadUrl, { method: 'PUT', body: new Uint8Array(conteudo), headers: ticket.headers });
  expect(put.status).toBe(200);
  return ticket.fileId;
}

async function anexar(
  http: TestAgent,
  expenseId: string,
  conteudo: Buffer,
  contentType: string,
  kind: string,
  extra: Record<string, unknown> = {},
  status = 200,
) {
  const fileId = await enviar(http, expenseId, conteudo, contentType);
  return http.post(`/api/me/expenses/${expenseId}/documents`).send({ fileId, kind, ...extra }).expect(status);
}

async function novaDespesa(http: TestAgent, campaignId: string, over: Record<string, unknown> = {}) {
  return (await http.post(`/api/me/campaigns/${campaignId}/expenses`).send(despesaInput(over)).expect(201)).body as OwnedExpense;
}

async function enviarParaRevisao(http: TestAgent, e: OwnedExpense) {
  const atual = (await http.get(`/api/me/expenses/${e.id}`).expect(200)).body as OwnedExpense;
  return (await http.post(`/api/me/expenses/${e.id}/actions/submit`).send({ version: atual.version }).expect(200)).body as OwnedExpense;
}

const simularFisco = (key: string, status: string) => agent(t.app).post(`/api/dev/fiscal/${key}/simulate`).send({ status }).expect(200);

describe('prestação de contas: fluxo completo', () => {
  it('XML da nota + comprovante → revisão aprova → público vê a despesa e os números', async () => {
    const { campaign, organizador, moderador } = await activeCampaign(t.app);
    const { xml, key } = nfeXml({ items: [{ description: 'ARROZ 5KG', totalCents: 2_590 }, { description: 'FEIJAO 1KG', totalCents: 899 }] });
    await simularFisco(key, 'AUTHORIZED');

    const e = await novaDespesa(organizador.http, campaign.id);
    let r = await anexar(organizador.http, e.id, Buffer.from(assinarNfe(xml)), 'application/xml', 'FISCAL');
    expect(r.status).toBe(200);
    let d = r.body as OwnedExpense;
    expect(d.documents[0]).toMatchObject({ kind: 'FISCAL', allocatedCents: 3_489, extraction: { status: 'EXTRACTED' } });
    expect(d.documents[0]!.fiscalDocument).toMatchObject({ accessKey: key, effectiveTotalCents: 3_489, totalSource: 'DOCUMENT', source: 'XML' });
    expect(d.documents[0]!.fiscalDocument!.items.map((i) => i.description)).toEqual(['ARROZ 5KG', 'FEIJAO 1KG']);
    expect(d.documents[0]!.fiscalDocument!.signature).toMatchObject({ status: 'VALID', problems: [] });

    r = await anexar(organizador.http, e.id, pdf(), 'application/pdf', 'PAYMENT_PROOF');
    d = r.body as OwnedExpense;
    expect(d.paymentProof).toBe('ATTACHED');

    d = await enviarParaRevisao(organizador.http, d);
    expect(d.status).toBe('SUBMITTED');
    expect(d.flags).toEqual([]);

    // Worker: verifica a nota no "fisco" (simulado).
    await drainOutbox(t.app);
    d = (await organizador.http.get(`/api/me/expenses/${e.id}`).expect(200)).body as OwnedExpense;
    expect(d.fiscalCheck).toBe('AUTHORIZED');

    const fila = (await moderador.http.get('/api/moderation/expenses').expect(200)).body as { id: string }[];
    expect(fila.some((x) => x.id === e.id)).toBe(true);
    await moderador.http.post(`/api/moderation/expenses/${e.id}/claim`).send({ version: d.version }).expect(200);
    const revisao = (await moderador.http.get(`/api/moderation/expenses/${e.id}`).expect(200)).body as OwnedExpense & { version: number };
    await moderador.http
      .post(`/api/moderation/expenses/${e.id}/decision`)
      .send({ version: revisao.version, decision: 'APPROVE', reason: 'Nota autenticada e comprovante conferido.', paymentProof: 'ACCEPTED' })
      .expect(200);

    const publicas = (await agent(t.app).get(`/api/campaigns/${campaign.slug}/expenses`).expect(200)).body as PublicExpense[];
    expect(publicas).toHaveLength(1);
    expect(publicas[0]).toMatchObject({ status: 'APPROVED', fiscalCheck: 'AUTHORIZED', paymentProof: 'ACCEPTED', supplierDocument: '11.222.333/0001-81' });
    const texto = JSON.stringify(publicas);
    expect(texto).not.toContain(key); // chave de acesso não é publicada
    expect(texto).not.toContain('52998224725'); // CPF do comprador no XML
    expect(publicas[0]!.fiscalDocuments[0]!.signature).toEqual({ status: 'VALID', problems: [], certificateSubject: null });

    const transp = (await agent(t.app).get(`/api/campaigns/${campaign.slug}/transparency`).expect(200)).body as CampaignTransparency;
    expect(transp.expenses).toMatchObject({ available: true, approvedCents: 3_489, inReviewCents: 0, fiscallyAuthenticatedCents: 3_489 });
    expect(transp.expenses.byCategory.find((c) => c.category === 'ALIMENTOS')).toMatchObject({ plannedCents: 1_200_000, approvedCents: 3_489 });
  });

  it('foto do cupom com QR (offline traz o total; online pede o total)', async () => {
    const { campaign, organizador } = await activeCampaign(t.app);
    const foto = async (texto: string) => {
      const qr = await QRCode.toBuffer(texto, { width: 320, margin: 2 });
      return sharp({ create: { width: 800, height: 1000, channels: 3, background: '#f6f3ec' } })
        .composite([{ input: qr, top: 400, left: 240 }])
        .jpeg()
        .toBuffer();
    };

    const k1 = accessKey();
    const e1 = await novaDespesa(organizador.http, campaign.id, { amountCents: 1_000 });
    const r1 = (await anexar(organizador.http, e1.id, await foto(`https://nfce.fazenda.df.gov.br/qr?p=${k1}|2|1|05|12.50|abc|1|HASH`), 'image/jpeg', 'FISCAL', {}, 200))
      .body as OwnedExpense;
    expect(r1.documents[0]).toMatchObject({ allocatedCents: 1_000, extraction: { status: 'EXTRACTED' } });
    expect(r1.documents[0]!.fiscalDocument).toMatchObject({ accessKey: k1, source: 'QR_CODE', effectiveTotalCents: 1_250 });

    const k2 = accessKey();
    const e2 = await novaDespesa(organizador.http, campaign.id, { amountCents: 2_000 });
    const r2 = (await anexar(organizador.http, e2.id, await foto(`https://nfce.fazenda.df.gov.br/qr?p=${k2}|2|1|1|HASH`), 'image/jpeg', 'FISCAL', {}, 200))
      .body as OwnedExpense;
    const doc = r2.documents[0]!;
    expect(doc.extraction.status).toBe('NEEDS_TOTAL');
    // Submeter antes de informar o total é recusado.
    await organizador.http.post(`/api/me/expenses/${e2.id}/actions/submit`).send({ version: r2.version }).expect(422);
    await organizador.http.post(`/api/me/expenses/${e2.id}/documents/${doc.id}/fiscal-key`).send({ accessKey: accessKey(), declaredTotalCents: 2_000 }).expect(422);
    const ok = (await organizador.http.post(`/api/me/expenses/${e2.id}/documents/${doc.id}/fiscal-key`).send({ accessKey: k2, declaredTotalCents: 2_000 }).expect(200))
      .body as OwnedExpense;
    expect(ok.documents[0]).toMatchObject({ allocatedCents: 2_000, extraction: { status: 'EXTRACTED' } });
    expect(ok.documents[0]!.fiscalDocument).toMatchObject({ totalSource: 'DECLARED' });
  });

  it('PDF do DANFE: pede a chave; chave inválida é recusada; total declarado vira alerta', async () => {
    const { campaign, organizador } = await activeCampaign(t.app);
    const e = await novaDespesa(organizador.http, campaign.id, { amountCents: 5_000 });
    const d = (await anexar(organizador.http, e.id, pdf(), 'application/pdf', 'FISCAL', {}, 200)).body as OwnedExpense;
    const doc = d.documents[0]!;
    expect(doc.extraction.status).toBe('NEEDS_ACCESS_KEY');

    const k = accessKey({ model: '55' });
    const dvErrado = k.slice(0, 43) + String((Number(k[43]) + 1) % 10);
    const ruim = await organizador.http.post(`/api/me/expenses/${e.id}/documents/${doc.id}/fiscal-key`).send({ accessKey: dvErrado, declaredTotalCents: 5_000 }).expect(422);
    expect(ruim.body.code).toBe('FISCAL_ACCESS_KEY_INVALID');
    await organizador.http.post(`/api/me/expenses/${e.id}/documents/${doc.id}/fiscal-key`).send({ accessKey: k, declaredTotalCents: 5_000 }).expect(200);
    const enviada = await enviarParaRevisao(organizador.http, e);
    expect(enviada.flags.sort()).toEqual(['FISCAL_TOTAL_DECLARED', 'NO_PAYMENT_PROOF']);
  });
});

describe('prestação de contas: rateio e antiduplicidade', () => {
  it('a mesma nota em duas despesas exige justificativa e respeita o total', async () => {
    const { campaign, organizador } = await activeCampaign(t.app);
    const { xml } = nfeXml({ items: [{ description: 'CESTA', totalCents: 10_000 }] });
    const a = await novaDespesa(organizador.http, campaign.id, { amountCents: 6_000 });
    await anexar(organizador.http, a.id, Buffer.from(xml), 'application/xml', 'FISCAL', {}, 200);

    const b = await novaDespesa(organizador.http, campaign.id, { amountCents: 6_000 });
    const sem = await anexar(organizador.http, b.id, Buffer.from(xml), 'application/xml', 'FISCAL', {}, 409);
    expect(sem.body).toMatchObject({ code: 'SHARING_JUSTIFICATION_REQUIRED', details: { totalCents: 10_000, allocatedElsewhereCents: 6_000 } });

    const justificativa = 'Nota única dividida entre duas entregas da campanha.';
    const demais = await anexar(organizador.http, b.id, Buffer.from(xml), 'application/xml', 'FISCAL', { sharingJustification: justificativa, allocatedCents: 5_000 }, 422);
    expect(demais.body).toMatchObject({ code: 'ALLOCATION_EXCEEDS_DOCUMENT', details: { availableCents: 4_000 } });

    const ok = (await anexar(organizador.http, b.id, Buffer.from(xml), 'application/xml', 'FISCAL', { sharingJustification: justificativa }, 200)).body as OwnedExpense;
    expect(ok.documents[0]).toMatchObject({ allocatedCents: 4_000, sharingJustification: justificativa });

    const c = await novaDespesa(organizador.http, campaign.id, { amountCents: 1_000 });
    const cheia = await anexar(organizador.http, c.id, Buffer.from(xml), 'application/xml', 'FISCAL', { sharingJustification: justificativa }, 409);
    expect(cheia.body.code).toBe('FISCAL_DOCUMENT_FULLY_ALLOCATED');

    const enviada = await enviarParaRevisao(organizador.http, b);
    expect(enviada.flags).toEqual(expect.arrayContaining(['SHARED_FISCAL_DOCUMENT', 'DUPLICATE_FILE', 'AMOUNT_EXCEEDS_FISCAL']));
  });

  it('concorrência: duas despesas disputando o total da mesma nota — só uma leva', async () => {
    const { campaign, organizador } = await activeCampaign(t.app);
    const { xml } = nfeXml({ items: [{ description: 'LEITE', totalCents: 8_000 }] });
    const [a, b] = [await novaDespesa(organizador.http, campaign.id, { amountCents: 8_000 }), await novaDespesa(organizador.http, campaign.id, { amountCents: 8_000 })];
    const [fa, fb] = [await enviar(organizador.http, a.id, Buffer.from(xml), 'application/xml'), await enviar(organizador.http, b.id, Buffer.from(xml), 'application/xml')];
    const just = { sharingJustification: 'Tentativa simultânea de usar a nota inteira.' };
    const [ra, rb] = await Promise.all([
      organizador.http.post(`/api/me/expenses/${a.id}/documents`).send({ fileId: fa, kind: 'FISCAL', ...just }),
      organizador.http.post(`/api/me/expenses/${b.id}/documents`).send({ fileId: fb, kind: 'FISCAL', ...just }),
    ]);
    expect([ra.status, rb.status].sort()).toEqual([200, 409]);
    const r = await t.db.execute<{ total: string }>(
      sql`select sum(allocated_cents)::text as total from expense_documents where expense_id in (${a.id}, ${b.id})`,
    );
    expect(Number(r.rows[0]!.total)).toBe(8_000);
  });

  it('rede de segurança no banco: alocação acima do total é recusada no commit', async () => {
    const { campaign, organizador } = await activeCampaign(t.app);
    const { xml } = nfeXml({ items: [{ description: 'OLEO', totalCents: 1_000 }] });
    const e = await novaDespesa(organizador.http, campaign.id, { amountCents: 1_000 });
    const d = (await anexar(organizador.http, e.id, Buffer.from(xml), 'application/xml', 'FISCAL', {}, 200)).body as OwnedExpense;
    await expect(t.db.execute(sql`update expense_documents set allocated_cents = 1001 where id = ${d.documents[0]!.id}`)).rejects.toThrow();
  });

  it('XML com DTD/entidades é recusado', async () => {
    const { campaign, organizador } = await activeCampaign(t.app);
    const e = await novaDespesa(organizador.http, campaign.id);
    const xxe = Buffer.from('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><nfeProc>&e;</nfeProc>');
    const r = await anexar(organizador.http, e.id, xxe, 'application/xml', 'FISCAL', {}, 422);
    expect(r.body.code).toBe('FISCAL_XML_PROIBIDO');
  });
});

describe('prestação de contas: permissões e estados', () => {
  it('só o organizador vê e altera; prestação só abre com a campanha publicada', async () => {
    const { campaign, organizador } = await activeCampaign(t.app);
    const e = await novaDespesa(organizador.http, campaign.id);
    const intruso = await registeredUser(t.app, 'Intrusa');
    await intruso.http.get(`/api/me/expenses/${e.id}`).expect(404);
    await intruso.http.post(`/api/me/campaigns/${campaign.id}/expenses`).send(despesaInput()).expect(404);
    await intruso.http.get(`/api/expenses/${e.id}/documents/${e.id}/url`).expect(404);
    await agent(t.app).get(`/api/me/expenses/${e.id}`).expect(401);

    const rascunho = (await organizador.http.post('/api/me/campaigns').send(campaignInput()).expect(201)).body as { id: string };
    const r = await organizador.http.post(`/api/me/campaigns/${rascunho.id}/expenses`).send(despesaInput()).expect(409);
    expect(r.body.code).toBe('CAMPAIGN_NOT_ACCOUNTABLE');
  });

  it('sem documento não envia; enviada não edita; revisão não revisa a própria campanha', async () => {
    const { campaign, organizador } = await activeCampaign(t.app);
    const e = await novaDespesa(organizador.http, campaign.id);
    const vazio = await organizador.http.post(`/api/me/expenses/${e.id}/actions/submit`).send({ version: e.version }).expect(422);
    expect(vazio.body.code).toBe('EXPENSE_WITHOUT_DOCUMENTS');

    await anexar(organizador.http, e.id, pdf(), 'application/pdf', 'RECEIPT', {}, 200);
    const enviada = await enviarParaRevisao(organizador.http, e);
    expect(enviada.flags).toEqual(expect.arrayContaining(['NO_FISCAL_DOCUMENT', 'NO_PAYMENT_PROOF']));
    const edicao = await organizador.http.patch(`/api/me/expenses/${e.id}`).send({ ...despesaInput(), version: enviada.version }).expect(409);
    expect(edicao.body.code).toBe('EXPENSE_NOT_DRAFT');

    // A organizadora vira moderadora: mesmo assim não revisa a própria campanha.
    const { IdentityService } = await import('../src/modules/identity');
    await t.app.get(IdentityService).grantRole(organizador.id, 'moderator', null);
    const doador = await registeredUser(t.app);
    await doador.http.get('/api/moderation/expenses').expect(403);
  });

  it('só quem assumiu decide; pedido de ajustes volta para rascunho e avisa por e-mail', async () => {
    const { campaign, organizador } = await activeCampaign(t.app);
    const [m1, m2] = [await userWithRole(t.app, 'moderator'), await userWithRole(t.app, 'moderator')];
    const e = await novaDespesa(organizador.http, campaign.id);
    await anexar(organizador.http, e.id, pdf(), 'application/pdf', 'RECEIPT', {}, 200);
    const enviada = await enviarParaRevisao(organizador.http, e);

    await m1.http.post(`/api/moderation/expenses/${e.id}/claim`).send({ version: enviada.version }).expect(200);
    await m2.http.post(`/api/moderation/expenses/${e.id}/claim`).send({ version: enviada.version + 1 }).expect(409);
    await m2.http
      .post(`/api/moderation/expenses/${e.id}/decision`)
      .send({ version: enviada.version + 1, decision: 'APPROVE', reason: 'Aprovando no lugar.' })
      .expect(403);
    const semComprovante = await m1.http
      .post(`/api/moderation/expenses/${e.id}/decision`)
      .send({ version: enviada.version + 1, decision: 'APPROVE', reason: 'Tudo conferido.', paymentProof: 'ACCEPTED' })
      .expect(422);
    expect(semComprovante.body.code).toBe('NOTHING_TO_ASSESS');
    await m1.http
      .post(`/api/moderation/expenses/${e.id}/decision`)
      .send({ version: enviada.version + 1, decision: 'REQUEST_CHANGES', reason: 'Anexe a nota fiscal da compra.' })
      .expect(200);

    const depois = (await organizador.http.get(`/api/me/expenses/${e.id}`).expect(200)).body as OwnedExpense;
    expect(depois).toMatchObject({ status: 'DRAFT', decisionReason: 'Anexe a nota fiscal da compra.' });
    const publicas = (await agent(t.app).get(`/api/campaigns/${campaign.slug}/expenses`).expect(200)).body as PublicExpense[];
    expect(publicas.find((p) => p.id === e.id)).toBeUndefined();

    await drainOutbox(t.app);
    const { EMAIL_SENDER } = await import('../src/modules/notifications');
    const emails = t.app.get<{ sent: { to: string; subject: string; text: string }[] }>(EMAIL_SENDER).sent.filter((m) => m.to === organizador.email);
    expect(emails.some((m) => m.subject.startsWith('Ajustes pedidos na despesa') && m.text.includes('Anexe a nota fiscal da compra.'))).toBe(true);
  });

  it('link do documento: o organizador baixa o arquivo; o link expira', async () => {
    const { campaign, organizador } = await activeCampaign(t.app);
    const e = await novaDespesa(organizador.http, campaign.id);
    const arquivo = pdf();
    const d = (await anexar(organizador.http, e.id, arquivo, 'application/pdf', 'RECEIPT', {}, 200)).body as OwnedExpense;
    const link = (await organizador.http.get(`/api/expenses/${e.id}/documents/${d.documents[0]!.id}/url`).expect(200)).body as { url: string; expiresAt: string };
    const r = await fetch(link.url);
    expect(r.status).toBe(200);
    expect(Buffer.from(await r.arrayBuffer()).equals(arquivo)).toBe(true);
    expect(new Date(link.expiresAt).getTime()).toBeLessThanOrEqual(Date.now() + 5 * 60_000 + 1_000);
  });
});

describe('verificação fiscal', () => {
  it('registra cada tentativa; sem combinação fica "não verificável"; cancelada aparece como cancelada', async () => {
    const { campaign, organizador } = await activeCampaign(t.app);
    const { xml, key } = nfeXml();
    const e = await novaDespesa(organizador.http, campaign.id);
    await anexar(organizador.http, e.id, Buffer.from(xml), 'application/xml', 'FISCAL', {}, 200);
    await drainOutbox(t.app);
    let d = (await organizador.http.get(`/api/me/expenses/${e.id}`).expect(200)).body as OwnedExpense;
    expect(d.fiscalCheck).toBe('UNVERIFIABLE');

    await simularFisco(key, 'CANCELLED');
    const { FiscalService } = await import('../src/modules/fiscal');
    await t.app.get(FiscalService).verify(d.documents[0]!.fiscalDocument!.id);
    d = (await organizador.http.get(`/api/me/expenses/${e.id}`).expect(200)).body as OwnedExpense;
    expect(d.fiscalCheck).toBe('CANCELLED');
    const tentativas = await t.db.execute<{ status: string }>(
      sql`select status from fiscal_verifications where document_id = ${d.documents[0]!.fiscalDocument!.id} order by created_at`,
    );
    expect(tentativas.rows.map((x) => x.status)).toEqual(['UNVERIFIABLE', 'CANCELLED']);
    await expect(t.db.execute(sql`delete from fiscal_verifications where document_id = ${d.documents[0]!.fiscalDocument!.id}`)).rejects.toThrow();
  });

  it('nota de homologação nunca é dada como autêntica', async () => {
    const { campaign, organizador } = await activeCampaign(t.app);
    const { xml, key } = nfeXml({ tpAmb: 2 });
    await simularFisco(key, 'AUTHORIZED');
    const e = await novaDespesa(organizador.http, campaign.id);
    await anexar(organizador.http, e.id, Buffer.from(xml), 'application/xml', 'FISCAL', {}, 200);
    await drainOutbox(t.app);
    const d = (await organizador.http.get(`/api/me/expenses/${e.id}`).expect(200)).body as OwnedExpense;
    expect(d.fiscalCheck).toBe('UNVERIFIABLE');
    expect(d.documents[0]!.fiscalDocument!.verificationReason).toBe('HOMOLOGATION_DOCUMENT');
  });

  it('a chave digitada é completada quando o XML da mesma nota chega (itens e total lidos)', async () => {
    const { campaign, organizador } = await activeCampaign(t.app);
    const { xml, key } = nfeXml({ items: [{ description: 'MACARRAO', totalCents: 1_000 }] });
    const e = await novaDespesa(organizador.http, campaign.id, { amountCents: 700 });
    const d = (await anexar(organizador.http, e.id, pdf(), 'application/pdf', 'FISCAL', {}, 200)).body as OwnedExpense;
    await organizador.http.post(`/api/me/expenses/${e.id}/documents/${d.documents[0]!.id}/fiscal-key`).send({ accessKey: key, declaredTotalCents: 1_000 }).expect(200);
    let atual = (await organizador.http.get(`/api/me/expenses/${e.id}`).expect(200)).body as OwnedExpense;
    expect(atual.documents[0]!.fiscalDocument).toMatchObject({ source: 'ACCESS_KEY', totalSource: 'DECLARED', items: [] });

    const e2 = await novaDespesa(organizador.http, campaign.id, { amountCents: 300 });
    const r = (await anexar(organizador.http, e2.id, Buffer.from(xml), 'application/xml', 'FISCAL', { sharingJustification: 'Mesma nota, resto do valor nesta despesa.' }, 200))
      .body as OwnedExpense;
    expect(r.documents[0]!.allocatedCents).toBe(300);
    atual = (await organizador.http.get(`/api/me/expenses/${e.id}`).expect(200)).body as OwnedExpense;
    expect(atual.documents[0]!.fiscalDocument).toMatchObject({ source: 'XML', totalSource: 'DOCUMENT', effectiveTotalCents: 1_000 });
    expect(atual.documents[0]!.fiscalDocument!.items.map((i) => i.description)).toEqual(['MACARRAO']);
  });
});

// Mantém o helper usado em outros arquivos de teste coerente com o DV.
it('fixture gera chave com DV correto', () => {
  const k = accessKey();
  expect(Number(k[43])).toBe(accessKeyCheckDigit(k.slice(0, 43)));
});
