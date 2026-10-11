import type { DonationCheckout } from '@soscomida/contracts';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DevPaymentProvider, PAYMENT_PROVIDER, PaymentsService } from '../src/modules/payments';
import { type TestApp, agent, createTestApp, registeredUser } from './app';
import { PAYER, activeCampaign, drainOutbox } from './fixtures';

let t: TestApp;
let dev: DevPaymentProvider;
let payments: PaymentsService;

beforeAll(async () => {
  t = await createTestApp();
  dev = t.app.get(PAYMENT_PROVIDER);
  payments = t.app.get(PaymentsService);
});
afterAll(async () => {
  await t.close();
});

async function doar(slugOuId: { id: string }, amountCents = 5_000, http = agent(t.app), key: string = randomUUID()) {
  const res = await http
    .post('/api/donations')
    .set('Idempotency-Key', key)
    .send({ campaignId: slugOuId.id, amountCents, displayName: 'Maria', anonymous: false, payer: PAYER })
    .expect(201);
  return res.body as DonationCheckout;
}

async function providerPaymentId(donationId: string): Promise<string> {
  const r = await t.db.execute<{ provider_payment_id: string }>(
    sql`select provider_payment_id from payment_intents where reference_type = 'donation' and reference_id = ${donationId}`,
  );
  return r.rows[0]!.provider_payment_id;
}

/** O provedor muda o estado e avisa por "webhook"; o worker processa. */
async function provedorReporta(ppid: string, outcome: 'CONFIRMED' | 'REFUNDED' | 'EXPIRED', eventId = `evt_${randomUUID()}`) {
  await dev.simulate(ppid, outcome);
  await payments.ingestEvent({ providerEventId: eventId, eventType: `DEV_${outcome}`, providerPaymentId: ppid, storedPayload: {} });
  await drainOutbox(t.app);
}

const ledgerDaDoacao = async (donationId: string) =>
  (
    await t.db.execute<{ kind: string }>(sql`select kind from ledger_transactions where reference_type = 'donation' and reference_id = ${donationId} order by occurred_at`)
  ).rows.map((r) => r.kind);

describe('fluxo de doação Pix', () => {
  it('cria a cobrança e só conta no total depois da confirmação do provedor', async () => {
    const { campaign } = await activeCampaign(t.app);
    const checkout = await doar(campaign, 10_000);
    expect(checkout).toMatchObject({ status: 'PENDING', amountCents: 10_000, developmentOnly: true });
    expect(checkout.pix?.copyPaste).toContain('DESENVOLVIMENTO-NAO-PAGAVEL');

    const antes = await agent(t.app).get(`/api/campaigns/${campaign.slug}/transparency`).expect(200);
    expect(antes.body.confirmedCents).toBe(0);

    await provedorReporta(await providerPaymentId(checkout.donationId), 'CONFIRMED');

    const depois = await agent(t.app).get(`/api/donations/${checkout.donationId}`).expect(200);
    expect(depois.body).toMatchObject({ status: 'CONFIRMED', pix: null });

    const painel = await agent(t.app).get(`/api/campaigns/${campaign.slug}/transparency`).expect(200);
    expect(painel.body).toMatchObject({ confirmedCents: 10_000, feesCents: 99, refundsCents: 0, netEstimateCents: 9_901, donationsCount: 1 });
    expect(painel.body.recentSupporters[0]).toMatchObject({ displayName: 'Maria', amountCents: 10_000 });

    // A projeção usada no catálogo também foi atualizada pelo evento DonationConfirmed.
    const card = await agent(t.app).get(`/api/campaigns/${campaign.slug}`).expect(200);
    expect(card.body).toMatchObject({ confirmedCents: 10_000, donationsCount: 1 });
  });

  it('a mesma Idempotency-Key devolve a mesma doação (duplo clique não cobra duas vezes)', async () => {
    const { campaign } = await activeCampaign(t.app);
    const chave = randomUUID();
    const [a, b] = await Promise.all([doar(campaign, 5_000, agent(t.app), chave), doar(campaign, 5_000, agent(t.app), chave)]);
    expect(a.donationId).toBe(b.donationId);

    const total = await t.db.execute<{ n: number }>(sql`select count(*)::int as n from donations where idempotency_key = ${chave}`);
    expect(total.rows[0]!.n).toBe(1);
  });

  it('reusar a chave para outro valor é recusado', async () => {
    const { campaign } = await activeCampaign(t.app);
    const chave = randomUUID();
    await doar(campaign, 5_000, agent(t.app), chave);
    const res = await agent(t.app)
      .post('/api/donations')
      .set('Idempotency-Key', chave)
      .send({ campaignId: campaign.id, amountCents: 9_000, anonymous: true, payer: PAYER })
      .expect(409);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('exige a Idempotency-Key e recusa CPF inválido', async () => {
    const { campaign } = await activeCampaign(t.app);
    await agent(t.app).post('/api/donations').send({ campaignId: campaign.id, amountCents: 5_000, anonymous: true, payer: PAYER }).expect(400);
    const cpf = await agent(t.app)
      .post('/api/donations')
      .set('Idempotency-Key', randomUUID())
      .send({ campaignId: campaign.id, amountCents: 5_000, anonymous: true, payer: { ...PAYER, cpf: '111.111.111-11' } })
      .expect(400);
    expect(cpf.body.message).toBe('CPF inválido');
  });

  it('campanha que não está ativa não recebe doação', async () => {
    const { http } = await registeredUser(t.app);
    const { campaignInput } = await import('./fixtures');
    const rascunho = (await http.post('/api/me/campaigns').send(campaignInput()).expect(201)).body;
    const res = await agent(t.app)
      .post('/api/donations')
      .set('Idempotency-Key', randomUUID())
      .send({ campaignId: rascunho.id, amountCents: 5_000, anonymous: true, payer: PAYER })
      .expect(409);
    expect(res.body.code).toBe('CAMPAIGN_NOT_ACCEPTING_DONATIONS');
  });

  it('doação feita logado aparece em "minhas doações"', async () => {
    const { campaign } = await activeCampaign(t.app);
    const doador = await registeredUser(t.app);
    const checkout = await doar(campaign, 7_500, doador.http);
    const minhas = await doador.http.get('/api/me/donations').expect(200);
    expect(minhas.body[0]).toMatchObject({ id: checkout.donationId, amountCents: 7_500, status: 'PENDING', campaignSlug: campaign.slug });
  });
});

describe('webhooks: repetição, ordem e falsificação', () => {
  it('o mesmo webhook entregue 5 vezes vira um evento e uma confirmação', async () => {
    const { campaign } = await activeCampaign(t.app);
    const checkout = await doar(campaign);
    const ppid = await providerPaymentId(checkout.donationId);
    await dev.simulate(ppid, 'CONFIRMED');

    const evento = { providerEventId: `evt_${randomUUID()}`, eventType: 'DEV_CONFIRMED', providerPaymentId: ppid, storedPayload: {} };
    const resultados = await Promise.all([1, 2, 3, 4, 5].map(() => payments.ingestEvent(evento)));
    expect(resultados.filter((r) => !r.duplicate)).toHaveLength(1);
    await drainOutbox(t.app);

    expect(await ledgerDaDoacao(checkout.donationId)).toEqual(['donation_confirmed']);
  });

  it('eventos diferentes para a mesma confirmação não lançam duas vezes', async () => {
    const { campaign } = await activeCampaign(t.app);
    const checkout = await doar(campaign);
    const ppid = await providerPaymentId(checkout.donationId);
    await provedorReporta(ppid, 'CONFIRMED');
    await provedorReporta(ppid, 'CONFIRMED');
    expect(await ledgerDaDoacao(checkout.donationId)).toEqual(['donation_confirmed']);
  });

  it('estorno visto antes da confirmação: aplica confirmação e estorno, em ordem', async () => {
    const { campaign } = await activeCampaign(t.app);
    const checkout = await doar(campaign, 20_000);
    await provedorReporta(await providerPaymentId(checkout.donationId), 'REFUNDED');

    expect(await ledgerDaDoacao(checkout.donationId)).toEqual(['donation_confirmed', 'donation_refunded']);
    const painel = await agent(t.app).get(`/api/campaigns/${campaign.slug}/transparency`).expect(200);
    expect(painel.body).toMatchObject({ confirmedCents: 20_000, refundsCents: 20_000, donationsCount: 0 });
  });

  it('confirmação atrasada depois de "pago" não regride; estorno posterior é aplicado', async () => {
    const { campaign } = await activeCampaign(t.app);
    const checkout = await doar(campaign);
    const ppid = await providerPaymentId(checkout.donationId);
    await provedorReporta(ppid, 'CONFIRMED');
    await provedorReporta(ppid, 'REFUNDED');
    // Webhook antigo de "confirmado" chegando por último: o provedor diz REFUNDED, nada muda.
    await payments.ingestEvent({ providerEventId: `evt_${randomUUID()}`, eventType: 'DEV_CONFIRMED', providerPaymentId: ppid, storedPayload: {} });
    await drainOutbox(t.app);

    const doacao = await agent(t.app).get(`/api/donations/${checkout.donationId}`).expect(200);
    expect(doacao.body.status).toBe('REFUNDED');
    expect(await ledgerDaDoacao(checkout.donationId)).toEqual(['donation_confirmed', 'donation_refunded']);
  });

  it('pagamento depois da expiração local é contabilizado', async () => {
    const { campaign } = await activeCampaign(t.app);
    const checkout = await doar(campaign);
    const ppid = await providerPaymentId(checkout.donationId);
    await t.db.execute(sql`update payment_intents set expires_at = now() - interval '1 minute', created_at = now() - interval '1 hour' where provider_payment_id = ${ppid}`);
    await payments.reconcilePending();
    expect((await agent(t.app).get(`/api/donations/${checkout.donationId}`)).body.status).toBe('EXPIRED');

    await provedorReporta(ppid, 'CONFIRMED');
    expect((await agent(t.app).get(`/api/donations/${checkout.donationId}`)).body.status).toBe('CONFIRMED');
    expect(await ledgerDaDoacao(checkout.donationId)).toEqual(['donation_confirmed']);
  });

  it('conciliação confirma pagamento cujo webhook se perdeu', async () => {
    const { campaign } = await activeCampaign(t.app);
    const checkout = await doar(campaign);
    const ppid = await providerPaymentId(checkout.donationId);
    await dev.simulate(ppid, 'CONFIRMED');
    await t.db.execute(sql`update payment_intents set created_at = now() - interval '10 minutes' where provider_payment_id = ${ppid}`);

    await payments.reconcilePending();
    await drainOutbox(t.app);
    expect((await agent(t.app).get(`/api/donations/${checkout.donationId}`)).body.status).toBe('CONFIRMED');
  });

  it('valor reportado diferente do cobrado não confirma e fica auditado', async () => {
    const { campaign } = await activeCampaign(t.app);
    const checkout = await doar(campaign, 5_000);
    const ppid = await providerPaymentId(checkout.donationId);
    await dev.overrideGross(ppid, 50);
    await provedorReporta(ppid, 'CONFIRMED');

    expect((await agent(t.app).get(`/api/donations/${checkout.donationId}`)).body.status).toBe('PENDING');
    expect(await ledgerDaDoacao(checkout.donationId)).toEqual([]);
    const auditoria = await t.db.execute<{ n: number }>(sql`select count(*)::int as n from audit_events where action = 'payment.amount_mismatch'`);
    expect(auditoria.rows[0]!.n).toBeGreaterThan(0);
  });

  it('webhook sem token válido é recusado e não grava nada', async () => {
    const antes = await t.db.execute<{ n: number }>(sql`select count(*)::int as n from payment_events`);
    await agent(t.app)
      .post('/api/payments/webhooks/asaas')
      .set('asaas-access-token', 'forjado')
      .send({ id: 'evt_forjado', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_x' } })
      .expect(401);
    await agent(t.app).post('/api/payments/webhooks/dev').send({}).expect(401);
    const depois = await t.db.execute<{ n: number }>(sql`select count(*)::int as n from payment_events`);
    expect(depois.rows[0]!.n).toBe(antes.rows[0]!.n);
  });

  it('dois workers sincronizando a mesma cobrança ao mesmo tempo lançam uma vez só', async () => {
    const { campaign } = await activeCampaign(t.app);
    const checkout = await doar(campaign);
    const ppid = await providerPaymentId(checkout.donationId);
    await dev.simulate(ppid, 'CONFIRMED');

    const resultados = await Promise.all([1, 2, 3, 4].map(() => payments.syncWithProvider(ppid, 'teste-concorrencia')));
    expect(resultados.filter((r) => r === 'APPLIED')).toHaveLength(1);
    expect(await ledgerDaDoacao(checkout.donationId)).toEqual(['donation_confirmed']);
  });
});

describe('garantias do ledger no banco', () => {
  it('o banco recusa transação desbalanceada no commit', async () => {
    const id = randomUUID();
    const conta = await t.db.execute<{ id: string }>(sql`select id from ledger_accounts limit 1`);
    await expect(
      t.db.transaction(async (tx) => {
        await tx.execute(sql`insert into ledger_transactions (id, kind, idempotency_key, reference_type, reference_id, description)
          values (${id}, 'teste', ${`teste:${id}`}, 'teste', 'x', 'desbalanceada')`);
        await tx.execute(sql`insert into ledger_entries (id, transaction_id, account_id, direction, amount_cents)
          values (${randomUUID()}, ${id}, ${conta.rows[0]!.id}, 'DEBIT', 100)`);
      }),
    ).rejects.toSatisfy((e: unknown) => /desbalanceada/.test(String((e as { cause?: Error }).cause?.message ?? e)));
  });

  it('lançamentos não podem ser alterados nem apagados', async () => {
    await expect(t.db.execute(sql`update ledger_entries set amount_cents = amount_cents + 1`)).rejects.toBeTruthy();
    await expect(t.db.execute(sql`delete from ledger_transactions`)).rejects.toBeTruthy();
  });

  it('Σ débitos = Σ créditos em todo o ledger depois de todos os testes acima', async () => {
    const r = await t.db.execute<{ debitos: string; creditos: string }>(sql`
      select coalesce(sum(case when direction = 'DEBIT' then amount_cents end), 0) as debitos,
             coalesce(sum(case when direction = 'CREDIT' then amount_cents end), 0) as creditos
      from ledger_entries`);
    expect(r.rows[0]!.debitos).toBe(r.rows[0]!.creditos);
  });
});
