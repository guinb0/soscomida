import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkerModule } from '../src/worker/worker.module';
import { type TestApp, agent, createTestApp } from './app';
import { PAYER, activeCampaign } from './fixtures';

/**
 * Caminho completo, sem atalhos: API recebe a simulação de pagamento →
 * outbox → relay do worker → BullMQ (Redis) → consumidor → consulta ao
 * provedor → ledger → evento DonationConfirmed → projeção pública.
 */
let t: TestApp;
let worker: INestApplicationContext;

beforeAll(async () => {
  t = await createTestApp();
  worker = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
  await worker.init();
});
afterAll(async () => {
  await worker.close();
  await t.close();
});

async function esperar<T>(fn: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 20_000): Promise<T> {
  const inicio = Date.now();
  for (;;) {
    const valor = await fn();
    if (ok(valor)) return valor;
    if (Date.now() - inicio > timeoutMs) throw new Error(`Condição não atingida em ${timeoutMs}ms: ${JSON.stringify(valor)}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

describe('worker', () => {
  it('confirma uma doação pelo caminho real da fila', async () => {
    const { campaign } = await activeCampaign(t.app);
    const checkout = (
      await agent(t.app)
        .post('/api/donations')
        .set('Idempotency-Key', randomUUID())
        .send({ campaignId: campaign.id, amountCents: 12_345, anonymous: true, payer: PAYER })
        .expect(201)
    ).body as { donationId: string };

    const intent = await t.db.execute<{ provider_payment_id: string }>(
      sql`select provider_payment_id from payment_intents where reference_id = ${checkout.donationId}`,
    );
    await agent(t.app).post(`/api/dev/payments/${intent.rows[0]!.provider_payment_id}/simulate`).send({ outcome: 'CONFIRMED' }).expect(200);

    const doacao = await esperar(
      async () => (await agent(t.app).get(`/api/donations/${checkout.donationId}`)).body as { status: string },
      (d) => d.status === 'CONFIRMED',
    );
    expect(doacao.status).toBe('CONFIRMED');

    const card = await esperar(
      async () => (await agent(t.app).get(`/api/campaigns/${campaign.slug}`)).body as { confirmedCents: number },
      (c) => c.confirmedCents === 12_345,
    );
    expect(card.confirmedCents).toBe(12_345);
  });
});
