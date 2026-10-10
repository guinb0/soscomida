import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QUEUES, QueueRegistry } from '../src/infra/queue/queue';
import { AuditService } from '../src/modules/audit';
import { OutboxService } from '../src/modules/outbox';
import { type TestApp, agent, createTestApp } from './app';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('saúde e observabilidade', () => {
  it('readiness confere banco e Redis', async () => {
    const res = await agent(t.app).get('/api/health/ready').expect(200);
    expect(res.body).toEqual({ status: 'ok', checks: { database: true, redis: true } });
  });

  it('expõe métricas Prometheus', async () => {
    const res = await agent(t.app).get('/api/metrics').expect(200);
    expect(res.text).toContain('http_request_duration_seconds');
  });

  it('devolve correlation id nos erros', async () => {
    const res = await agent(t.app).get('/api/rota-inexistente').set('x-request-id', 'teste-correlacao-123').expect(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND', requestId: 'teste-correlacao-123' });
  });
});

describe('auditoria', () => {
  it('é só inserção: o banco recusa UPDATE e DELETE', async () => {
    await t.app.get(AuditService).record({ actorUserId: null, action: 'teste.imutavel', targetType: 'teste', targetId: 'x' });

    const erroDoBanco = (e: unknown) => /só-inserção/.test(String((e as { cause?: Error }).cause?.message));
    await expect(t.db.execute(sql`update audit_events set action = 'adulterado' where action = 'teste.imutavel'`)).rejects.toSatisfy(erroDoBanco);
    await expect(t.db.execute(sql`delete from audit_events where action = 'teste.imutavel'`)).rejects.toSatisfy(erroDoBanco);
  });
});

describe('outbox', () => {
  it('publica cada evento uma vez na fila, mesmo com publicações repetidas', async () => {
    const outbox = t.app.get(OutboxService);
    const id = await t.db.transaction((tx) =>
      outbox.add(tx, { type: 'TesteOutbox', aggregateType: 'teste', aggregateId: 'a1', payload: { valor: 1 } }),
    );

    // Duas rodadas do relay: a segunda não encontra nada pendente.
    expect(await outbox.publishBatch()).toBeGreaterThanOrEqual(1);
    await outbox.publishBatch();

    const job = await t.app.get(QueueRegistry).get(QUEUES.events).getJob(id);
    expect(job?.data).toMatchObject({ id, type: 'TesteOutbox', payload: { valor: 1 } });

    const pendentes = await t.db.execute<{ total: number }>(sql`select count(*)::int as total from outbox_events where id = ${id} and published_at is null`);
    expect(pendentes.rows[0]?.total).toBe(0);
  });

  it('evento de transação que deu rollback nunca é publicado', async () => {
    const outbox = t.app.get(OutboxService);
    let id = '';
    await expect(
      t.db.transaction(async (tx) => {
        id = await outbox.add(tx, { type: 'TesteRollback', aggregateType: 'teste', aggregateId: 'a2', payload: {} });
        throw new Error('falha no meio da transação');
      }),
    ).rejects.toThrow();

    const existe = await t.db.execute<{ total: number }>(sql`select count(*)::int as total from outbox_events where id = ${id}`);
    expect(existe.rows[0]?.total).toBe(0);
  });
});
