import type { DonationCheckout, OwnedCampaign } from '@soscomida/contracts';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EMAIL_SENDER, type LogEmailSender } from '../src/modules/notifications';
import { emailNotifications } from '../src/modules/notifications/infra/notifications.schema';
import { EventHandlerRegistry, type PublishedEvent } from '../src/modules/outbox';
import { outboxEvents } from '../src/modules/outbox/infra/outbox.schema';
import { DevPaymentProvider, PAYMENT_PROVIDER, PaymentsService } from '../src/modules/payments';
import { type TestApp, agent, createTestApp, registeredUser, userWithRole } from './app';
import { PAYER, activeCampaign, campaignInput, drainOutbox } from './fixtures';

let t: TestApp;
let emails: LogEmailSender;

beforeAll(async () => {
  t = await createTestApp();
  emails = t.app.get(EMAIL_SENDER);
});
afterAll(async () => {
  await t.close();
});

const paraOEmail = (email: string) => emails.sent.filter((m) => m.to === email);

async function doacaoConfirmada(campaignId: string, http = agent(t.app)) {
  const checkout = (
    await http
      .post('/api/donations')
      .set('Idempotency-Key', randomUUID())
      .send({ campaignId, amountCents: 7_500, anonymous: false, displayName: 'Doadora', payer: PAYER })
      .expect(201)
  ).body as DonationCheckout;
  const r = await t.db.execute<{ provider_payment_id: string }>(
    sql`select provider_payment_id from payment_intents where reference_type = 'donation' and reference_id = ${checkout.donationId}`,
  );
  const ppid = r.rows[0]!.provider_payment_id;
  await t.app.get<DevPaymentProvider>(PAYMENT_PROVIDER).simulate(ppid, 'CONFIRMED');
  await t.app.get(PaymentsService).ingestEvent({ providerEventId: `evt_${randomUUID()}`, eventType: 'DEV_CONFIRMED', providerPaymentId: ppid, storedPayload: {} });
  await drainOutbox(t.app);
  return checkout.donationId;
}

async function reentregar(tipo: string, aggregateId: string) {
  const [e] = await t.db.select().from(outboxEvents).where(sql`${outboxEvents.type} = ${tipo} and ${outboxEvents.aggregateId} = ${aggregateId}`);
  const evento: PublishedEvent = { id: e!.id, type: e!.type, aggregateType: e!.aggregateType, aggregateId: e!.aggregateId, payload: e!.payload, occurredAt: e!.createdAt.toISOString() };
  await t.app.get(EventHandlerRegistry).dispatch(evento);
}

describe('notificações por e-mail', () => {
  it('avisa quem doou logado quando o provedor confirma, uma única vez', async () => {
    const { campaign } = await activeCampaign(t.app);
    const doador = await registeredUser(t.app, 'Doadora Logada');
    const donationId = await doacaoConfirmada(campaign.id, doador.http);

    expect(paraOEmail(doador.email)).toHaveLength(1);
    expect(paraOEmail(doador.email)[0]!.subject).toContain(campaign.title);
    expect(paraOEmail(doador.email)[0]!.text).toContain('75,00');
    expect(paraOEmail(doador.email)[0]!.text).not.toContain('529'); // CPF nunca vai no e-mail

    await reentregar('DonationConfirmed', donationId);
    await reentregar('DonationConfirmed', donationId);
    expect(paraOEmail(doador.email)).toHaveLength(1);
  });

  it('doação de convidado não gera e-mail (não guardamos o endereço)', async () => {
    const { campaign } = await activeCampaign(t.app);
    const antes = emails.sent.length;
    const donationId = await doacaoConfirmada(campaign.id);
    const [linha] = await t.db.select().from(emailNotifications).where(eq(emailNotifications.dedupeKey, `donation_confirmed:${donationId}`));
    expect(linha).toBeUndefined();
    expect(emails.sent.slice(antes).some((m) => m.subject.includes(campaign.title) && m.subject.includes('doação'))).toBe(false);
  });

  it('organizador recebe o pedido de ajustes com a justificativa', async () => {
    const organizador = await registeredUser(t.app, 'Organizadora');
    const moderador = await userWithRole(t.app, 'moderator');
    let c = (await organizador.http.post('/api/me/campaigns').send(campaignInput()).expect(201)).body as OwnedCampaign;
    c = (await organizador.http.post(`/api/me/campaigns/${c.id}/actions/submit`).send({ version: c.version }).expect(200)).body as OwnedCampaign;
    await moderador.http.post(`/api/moderation/campaigns/${c.id}/claim`).send({ version: c.version }).expect(200);
    await moderador.http
      .post(`/api/moderation/campaigns/${c.id}/decision`)
      .send({ decision: 'REQUEST_CHANGES', reason: 'Inclua a lista das famílias atendidas.', version: c.version + 1 })
      .expect(200);
    await drainOutbox(t.app);

    const recebidos = paraOEmail(organizador.email);
    expect(recebidos).toHaveLength(1); // submit e claim não geram e-mail
    expect(recebidos[0]!.subject).toContain('Ajustes');
    expect(recebidos[0]!.text).toContain('Inclua a lista das famílias atendidas.');
    expect(recebidos[0]!.text).toContain(`/painel/campanhas/${c.id}`);
  });

  it('falha no SMTP: registra a tentativa, propaga para a fila e envia na próxima entrega', async () => {
    const { campaign } = await activeCampaign(t.app);
    const doador = await registeredUser(t.app, 'Doadora SMTP');
    await drainOutbox(t.app); // o aviso de aprovação sai antes da falha simulada
    const espiao = vi.spyOn(emails, 'send').mockRejectedValueOnce(new Error('SMTP fora do ar'));

    await expect(doacaoConfirmada(campaign.id, doador.http)).rejects.toThrow('SMTP fora do ar');
    const [linha] = await t.db.select().from(emailNotifications).where(sql`${emailNotifications.userId} = ${doador.id}`);
    expect(linha).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'SMTP fora do ar' });

    await drainOutbox(t.app);
    espiao.mockRestore();
    const [depois] = await t.db.select().from(emailNotifications).where(sql`${emailNotifications.userId} = ${doador.id}`);
    expect(depois).toMatchObject({ status: 'SENT', attempts: 2 });
    expect(paraOEmail(doador.email)).toHaveLength(1);
  });
});
