import type { INestApplication } from '@nestjs/common';
import type { CreateCampaignInput, OwnedCampaign } from '@soscomida/contracts';
import { asc, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DB, type Database } from '../src/infra/db/db';
import { EventHandlerRegistry, type PublishedEvent } from '../src/modules/outbox';
import { outboxEvents } from '../src/modules/outbox/infra/outbox.schema';
import { registeredUser, userWithRole } from './app';

export const campaignInput = (over: Partial<CreateCampaignInput> = {}): CreateCampaignInput => ({
  title: `Cestas básicas para Ceilândia ${randomUUID().slice(0, 6)}`,
  summary: 'Comprar 100 cestas básicas para famílias cadastradas no CRAS da região.',
  description: 'Descrição longa da campanha. '.repeat(10),
  category: 'ALIMENTACAO',
  goalCents: 1_500_000,
  region: 'Ceilândia - DF',
  endsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  budget: [
    { category: 'ALIMENTOS', description: 'Itens das cestas', plannedCents: 1_200_000 },
    { category: 'TRANSPORTE', description: 'Frete até o CRAS', plannedCents: 200_000 },
    { category: 'EMBALAGENS', description: 'Caixas e sacolas', plannedCents: 100_000 },
  ],
  ...over,
});

/**
 * Executa o que o worker faria: publica os eventos pendentes do outbox
 * despachando direto para os handlers (sem passar pelo Redis), até esgotar.
 */
export async function drainOutbox(app: INestApplication): Promise<number> {
  const db = app.get<Database>(DB);
  const registry = app.get(EventHandlerRegistry);
  let total = 0;
  for (let rodada = 0; rodada < 20; rodada++) {
    const pendentes = await db.select().from(outboxEvents).where(isNull(outboxEvents.publishedAt)).orderBy(asc(outboxEvents.createdAt));
    if (pendentes.length === 0) return total;
    for (const e of pendentes) {
      const evento: PublishedEvent = {
        id: e.id,
        type: e.type,
        aggregateType: e.aggregateType,
        aggregateId: e.aggregateId,
        payload: e.payload,
        occurredAt: e.createdAt.toISOString(),
      };
      await registry.dispatch(evento);
      await db.update(outboxEvents).set({ publishedAt: new Date() }).where(eq(outboxEvents.id, e.id));
      total++;
    }
  }
  throw new Error('O outbox não esvaziou em 20 rodadas');
}

/** Campanha que passou pelo fluxo completo: rascunho → análise → aprovada → ativa. */
export async function activeCampaign(app: INestApplication, over: Partial<CreateCampaignInput> = {}) {
  const organizador = await registeredUser(app, 'Organizadora');
  const moderador = await userWithRole(app, 'moderator');

  let c = (await organizador.http.post('/api/me/campaigns').send(campaignInput(over)).expect(201)).body as OwnedCampaign;
  c = (await organizador.http.post(`/api/me/campaigns/${c.id}/actions/submit`).send({ version: c.version }).expect(200)).body as OwnedCampaign;
  await moderador.http.post(`/api/moderation/campaigns/${c.id}/claim`).send({ version: c.version }).expect(200);
  const emAnalise = (await moderador.http.get(`/api/moderation/campaigns/${c.id}`).expect(200)).body as { version: number };
  await moderador.http
    .post(`/api/moderation/campaigns/${c.id}/decision`)
    .send({ decision: 'APPROVE', reason: 'Documentação e orçamento conferidos.', version: emAnalise.version })
    .expect(200);
  const aprovada = (await organizador.http.get(`/api/me/campaigns/${c.id}`).expect(200)).body as OwnedCampaign;
  const ativa = (await organizador.http.post(`/api/me/campaigns/${c.id}/actions/publish`).send({ version: aprovada.version }).expect(200)).body as OwnedCampaign;
  return { campaign: ativa, organizador, moderador };
}

export const PAYER = { name: 'Pagador de Teste', cpf: '529.982.247-25', email: 'pagador@teste.com' };
