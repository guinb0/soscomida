import type { OwnedCampaign } from '@soscomida/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestApp, agent, createTestApp, registeredUser, userWithRole } from './app';
import { activeCampaign, campaignInput } from './fixtures';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('ciclo de vida da campanha', () => {
  it('rascunho → análise → aprovada → ativa → aparece no catálogo público', async () => {
    const { campaign } = await activeCampaign(t.app);
    expect(campaign.status).toBe('ACTIVE');
    expect(campaign.publishedAt).not.toBeNull();

    const publica = await agent(t.app).get(`/api/campaigns/${campaign.slug}`).expect(200);
    expect(publica.body).toMatchObject({ status: 'ACTIVE', acceptsDonations: true, confirmedCents: 0 });
    expect(publica.body.budget).toHaveLength(3);

    const lista = await agent(t.app).get('/api/campaigns').query({ q: campaign.title.slice(-6) }).expect(200);
    expect(lista.body.items.map((c: { id: string }) => c.id)).toContain(campaign.id);
  });

  it('rascunho não aparece publicamente', async () => {
    const { http } = await registeredUser(t.app);
    const c = (await http.post('/api/me/campaigns').send(campaignInput()).expect(201)).body as OwnedCampaign;
    await agent(t.app).get(`/api/campaigns/${c.slug}`).expect(404);
  });

  it('não envia para análise se o orçamento não fecha com a meta', async () => {
    const { http } = await registeredUser(t.app);
    const c = (await http.post('/api/me/campaigns').send(campaignInput({ goalCents: 2_000_000 })).expect(201)).body as OwnedCampaign;
    const res = await http.post(`/api/me/campaigns/${c.id}/actions/submit`).send({ version: c.version }).expect(422);
    expect(res.body.code).toBe('BUDGET_MISMATCH');
  });

  it('recusa transição inválida (publicar sem aprovação)', async () => {
    const { http } = await registeredUser(t.app);
    const c = (await http.post('/api/me/campaigns').send(campaignInput()).expect(201)).body as OwnedCampaign;
    const res = await http.post(`/api/me/campaigns/${c.id}/actions/publish`).send({ version: c.version }).expect(409);
    expect(res.body.code).toBe('INVALID_TRANSITION');
  });

  it('edição concorrente: a segunda gravação com versão antiga é recusada', async () => {
    const { http } = await registeredUser(t.app);
    const c = (await http.post('/api/me/campaigns').send(campaignInput()).expect(201)).body as OwnedCampaign;
    await http.patch(`/api/me/campaigns/${c.id}`).send({ version: c.version, title: 'Título alterado na primeira aba' }).expect(200);
    const res = await http.patch(`/api/me/campaigns/${c.id}`).send({ version: c.version, title: 'Título alterado na segunda aba' }).expect(409);
    expect(res.body.code).toBe('VERSION_CONFLICT');
  });

  it('guarda o histórico de status, que o banco não deixa alterar', async () => {
    const { campaign } = await activeCampaign(t.app);
    const historico = await t.db.execute<{ to_status: string }>(
      sql`select to_status from campaign_status_history where campaign_id = ${campaign.id} order by occurred_at`,
    );
    expect(historico.rows.map((r) => r.to_status)).toEqual(['DRAFT', 'PENDING_REVIEW', 'IN_REVIEW', 'APPROVED', 'ACTIVE']);
    await expect(t.db.execute(sql`update campaign_status_history set reason = 'x' where campaign_id = ${campaign.id}`)).rejects.toBeTruthy();
  });

  it('pedido de ajustes volta para rascunho com a nota da moderação', async () => {
    const organizador = await registeredUser(t.app);
    const moderador = await userWithRole(t.app, 'moderator');
    let c = (await organizador.http.post('/api/me/campaigns').send(campaignInput()).expect(201)).body as OwnedCampaign;
    c = (await organizador.http.post(`/api/me/campaigns/${c.id}/actions/submit`).send({ version: c.version }).expect(200)).body;
    await moderador.http.post(`/api/moderation/campaigns/${c.id}/claim`).send({ version: c.version }).expect(200);
    await moderador.http
      .post(`/api/moderation/campaigns/${c.id}/decision`)
      .send({ decision: 'REQUEST_CHANGES', reason: 'Inclua a lista das famílias atendidas.', version: c.version + 1 })
      .expect(200);

    const depois = (await organizador.http.get(`/api/me/campaigns/${c.id}`).expect(200)).body as OwnedCampaign;
    expect(depois.status).toBe('DRAFT');
    expect(depois.moderationNote).toBe('Inclua a lista das famílias atendidas.');
  });
});

describe('permissões', () => {
  it('outra pessoa não vê nem edita campanha alheia (mesma resposta de inexistente)', async () => {
    const dono = await registeredUser(t.app);
    const intruso = await registeredUser(t.app);
    const c = (await dono.http.post('/api/me/campaigns').send(campaignInput()).expect(201)).body as OwnedCampaign;

    await intruso.http.get(`/api/me/campaigns/${c.id}`).expect(404);
    await intruso.http.patch(`/api/me/campaigns/${c.id}`).send({ version: c.version, title: 'Campanha sequestrada!!' }).expect(404);
    await intruso.http.post(`/api/me/campaigns/${c.id}/actions/submit`).send({ version: c.version }).expect(404);
  });

  it('doador não acessa a moderação', async () => {
    const { http } = await registeredUser(t.app);
    await http.get('/api/moderation/queue').expect(403);
  });

  it('dois moderadores não assumem a mesma análise', async () => {
    const organizador = await registeredUser(t.app);
    const [m1, m2] = await Promise.all([userWithRole(t.app, 'moderator'), userWithRole(t.app, 'moderator')]);
    let c = (await organizador.http.post('/api/me/campaigns').send(campaignInput()).expect(201)).body as OwnedCampaign;
    c = (await organizador.http.post(`/api/me/campaigns/${c.id}/actions/submit`).send({ version: c.version }).expect(200)).body;

    const [a, b] = await Promise.all([
      m1.http.post(`/api/moderation/campaigns/${c.id}/claim`).send({ version: c.version }),
      m2.http.post(`/api/moderation/campaigns/${c.id}/claim`).send({ version: c.version }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  it('só quem assumiu decide', async () => {
    const organizador = await registeredUser(t.app);
    const m1 = await userWithRole(t.app, 'moderator');
    const m2 = await userWithRole(t.app, 'moderator');
    let c = (await organizador.http.post('/api/me/campaigns').send(campaignInput()).expect(201)).body as OwnedCampaign;
    c = (await organizador.http.post(`/api/me/campaigns/${c.id}/actions/submit`).send({ version: c.version }).expect(200)).body;
    await m1.http.post(`/api/moderation/campaigns/${c.id}/claim`).send({ version: c.version }).expect(200);
    await m2.http
      .post(`/api/moderation/campaigns/${c.id}/decision`)
      .send({ decision: 'APPROVE', reason: 'Aprovando no lugar do colega.', version: c.version + 1 })
      .expect(403);
  });

  it('investigação tira a campanha do catálogo de doações e volta ao status anterior ao encerrar', async () => {
    const { campaign, moderador } = await activeCampaign(t.app);
    await moderador.http
      .post(`/api/moderation/campaigns/${campaign.id}/investigate`)
      .send({ reason: 'Denúncia de uso indevido recebida.', version: campaign.version })
      .expect(200);
    const sob = await agent(t.app).get(`/api/campaigns/${campaign.slug}`).expect(200);
    expect(sob.body).toMatchObject({ status: 'UNDER_INVESTIGATION', acceptsDonations: false });

    await moderador.http
      .post(`/api/moderation/campaigns/${campaign.id}/close-investigation`)
      .send({ reason: 'Denúncia improcedente.', version: campaign.version + 1, outcome: 'CLEARED' })
      .expect(200);
    const depois = await agent(t.app).get(`/api/campaigns/${campaign.slug}`).expect(200);
    expect(depois.body.status).toBe('ACTIVE');
  });
});

describe('imagens por upload assinado', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(56).fill(1)]);

  async function enviar(conteudo: Uint8Array, tipo: 'image/png') {
    const { http } = await registeredUser(t.app);
    const c = (await http.post('/api/me/campaigns').send(campaignInput()).expect(201)).body as OwnedCampaign;
    const ticket = (await http.post(`/api/me/campaigns/${c.id}/images/upload-url`).send({ contentType: tipo, sizeBytes: conteudo.length }).expect(201)).body;
    const put = await fetch(ticket.uploadUrl, { method: 'PUT', body: Buffer.from(conteudo), headers: ticket.headers });
    expect(put.status).toBe(200);
    return { http, campanha: c, fileId: ticket.fileId as string };
  }

  it('aceita uma imagem verdadeira e a define como capa', async () => {
    const { http, campanha, fileId } = await enviar(PNG, 'image/png');
    const res = await http.post(`/api/me/campaigns/${campanha.id}/images/${fileId}`).expect(200);
    expect(res.body.imageUrls).toHaveLength(1);
    expect(res.body.coverUrl).toMatch(/\.png$/);
  });

  it('recusa HTML enviado como se fosse imagem', async () => {
    const html = new TextEncoder().encode('<html><script>alert(document.cookie)</script></html>'.padEnd(64, ' '));
    const { http, campanha, fileId } = await enviar(html, 'image/png');
    const res = await http.post(`/api/me/campaigns/${campanha.id}/images/${fileId}`).expect(422);
    expect(res.body.code).toBe('FILE_REJECTED');
  });
});
