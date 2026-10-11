import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { DB, type Database, type Executor } from '../../../infra/db/db';
import { DomainError } from '../../../infra/http/errors';
import { newId } from '../../../infra/ids';
import { metrics } from '../../../infra/observability/metrics';
import { AuditService } from '../../audit';
import { OutboxService } from '../../outbox';
import { type IntentStatus, planTransitions } from '../domain/intent-status';
import {
  type ChargeSnapshot,
  type CreatePixChargeInput,
  PAYMENT_PROVIDER,
  type ParsedWebhook,
  type PaymentProvider,
  ProviderRejectedError,
} from '../domain/payment-provider';
import { paymentEvents, paymentIntents } from '../infra/payments.schema';
import { type SettledIntent, SettlementRegistry } from './settlement';

type IntentRow = typeof paymentIntents.$inferSelect;

export const PAYMENT_EVENTS = {
  eventReceived: 'PaymentEventReceived',
} as const;

export interface IntentView {
  id: string;
  status: IntentStatus;
  amountCents: number;
  pixCopyPaste: string | null;
  expiresAt: Date | null;
  provider: string;
  realMoney: boolean;
}

/** Por que um evento foi ignorado — fica gravado para auditoria e alerta. */
type EventOutcome = 'APPLIED' | 'NO_CHANGE' | 'UNKNOWN_PAYMENT' | 'AMOUNT_MISMATCH';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly settlements: SettlementRegistry,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  get providerName(): string {
    return this.provider.name;
  }

  /** Cria a cobrança local (estado CREATED) na transação do chamador. */
  async createIntent(tx: Executor, input: { referenceType: string; referenceId: string; amountCents: number }): Promise<string> {
    const id = newId();
    await tx.insert(paymentIntents).values({
      id,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      provider: this.provider.name,
      amountCents: input.amountCents,
    });
    return id;
  }

  /**
   * Pede a cobrança Pix ao provedor (fora de transação: é chamada de rede).
   * Sucesso → AWAITING_PAYMENT. Recusa do provedor → FAILED. Indisponibilidade
   * → mantém CREATED e propaga o erro para o chamador decidir.
   */
  async requestPixCharge(intentId: string, input: Omit<CreatePixChargeInput, 'intentId' | 'amountCents'>): Promise<IntentView> {
    const intent = await this.load(intentId);
    if (intent.status !== 'CREATED') return this.toView(intent);

    try {
      const cobranca = await this.provider.createPixCharge({ ...input, intentId, amountCents: intent.amountCents });
      await this.db
        .update(paymentIntents)
        .set({
          status: 'AWAITING_PAYMENT',
          providerPaymentId: cobranca.providerPaymentId,
          pixCopyPaste: cobranca.copyPaste,
          expiresAt: cobranca.expiresAt,
          version: sql`${paymentIntents.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(paymentIntents.id, intentId), eq(paymentIntents.status, 'CREATED')));
    } catch (error) {
      if (error instanceof ProviderRejectedError) {
        await this.db.transaction(async (tx) => {
          await this.applyStatus(tx, intent, 'FAILED', null, error.message);
        });
        throw new DomainError('PAYMENT_REJECTED', 'O provedor de pagamento recusou a cobrança. Confira os dados do pagador.');
      }
      throw new DomainError('PAYMENT_PROVIDER_UNAVAILABLE', 'Pagamento indisponível no momento. Tente de novo em instantes.', 503);
    }
    return this.toView(await this.load(intentId));
  }

  async getByReference(referenceType: string, referenceId: string): Promise<IntentView | null> {
    const [intent] = await this.db
      .select()
      .from(paymentIntents)
      .where(and(eq(paymentIntents.referenceType, referenceType), eq(paymentIntents.referenceId, referenceId)))
      .limit(1);
    return intent ? this.toView(intent) : null;
  }

  // --- Webhooks ------------------------------------------------------------------

  verifyAndParseWebhook(provider: string, headers: Record<string, string | string[] | undefined>, body: unknown): ParsedWebhook | null {
    if (provider !== this.provider.name || !this.provider.verifyWebhook(headers)) {
      metrics.paymentWebhooks.inc({ provider, result: 'unauthorized' });
      return null;
    }
    return this.provider.parseWebhook(body);
  }

  /**
   * Grava o evento e agenda o processamento na mesma transação. Repetição do
   * mesmo evento é absorvida pelo UNIQUE (nada é gravado de novo).
   */
  async ingestEvent(event: ParsedWebhook): Promise<{ duplicate: boolean }> {
    const resultado = await this.db.transaction(async (tx) => {
      const id = newId();
      const inserido = await tx
        .insert(paymentEvents)
        .values({
          id,
          provider: this.provider.name,
          providerEventId: event.providerEventId,
          eventType: event.eventType,
          providerPaymentId: event.providerPaymentId,
          payload: event.storedPayload,
        })
        .onConflictDoNothing({ target: [paymentEvents.provider, paymentEvents.providerEventId] })
        .returning({ id: paymentEvents.id });
      if (inserido.length === 0) return { duplicate: true };

      await this.outbox.add(tx, {
        type: PAYMENT_EVENTS.eventReceived,
        aggregateType: 'payment_event',
        aggregateId: id,
        payload: { paymentEventId: id },
      });
      return { duplicate: false };
    });
    metrics.paymentWebhooks.inc({ provider: this.provider.name, result: resultado.duplicate ? 'duplicate' : 'accepted' });
    return resultado;
  }

  /**
   * Processa um evento recebido. O corpo do webhook só diz "algo mudou na
   * cobrança X"; o estado verdadeiro vem da consulta ao provedor. Isso protege
   * contra webhook forjado e contra eventos fora de ordem.
   */
  async processEvent(paymentEventId: string): Promise<EventOutcome | 'ALREADY_DONE'> {
    const [evento] = await this.db.select().from(paymentEvents).where(eq(paymentEvents.id, paymentEventId)).limit(1);
    if (!evento) return 'ALREADY_DONE';
    if (evento.status === 'PROCESSED' || evento.status === 'IGNORED') return 'ALREADY_DONE';

    await this.db.update(paymentEvents).set({ attempts: sql`${paymentEvents.attempts} + 1` }).where(eq(paymentEvents.id, paymentEventId));

    if (!evento.providerPaymentId) {
      await this.finishEvent(paymentEventId, 'IGNORED', 'evento sem cobrança associada');
      return 'NO_CHANGE';
    }
    const resultado = await this.syncWithProvider(evento.providerPaymentId, `webhook:${evento.providerEventId}`);
    await this.finishEvent(paymentEventId, resultado === 'APPLIED' || resultado === 'NO_CHANGE' ? 'PROCESSED' : 'IGNORED', resultado);
    return resultado;
  }

  /**
   * Busca o estado da cobrança no provedor e aplica as transições necessárias
   * numa única transação (cobrança + doação + ledger + eventos).
   */
  async syncWithProvider(providerPaymentId: string, source: string): Promise<EventOutcome> {
    const [local] = await this.db
      .select()
      .from(paymentIntents)
      .where(and(eq(paymentIntents.provider, this.provider.name), eq(paymentIntents.providerPaymentId, providerPaymentId)))
      .limit(1);
    if (!local) {
      this.logger.warn({ providerPaymentId, source }, 'Evento de pagamento para cobrança desconhecida');
      return 'UNKNOWN_PAYMENT';
    }

    const snapshot = await this.provider.getCharge(providerPaymentId);

    return this.db.transaction(async (tx) => {
      // Lock da cobrança: dois workers processando eventos da mesma cobrança se enfileiram aqui.
      const [intent] = await tx.select().from(paymentIntents).where(eq(paymentIntents.id, local.id)).for('update');
      if (!intent) return 'UNKNOWN_PAYMENT';

      const plano = planTransitions(intent.status as IntentStatus, snapshot.status);
      if (plano.length === 0) {
        metrics.paymentTransitions.inc({ provider: intent.provider, to: snapshot.status, result: 'no_change' });
        return 'NO_CHANGE';
      }
      if (snapshot.grossCents !== intent.amountCents) {
        // Valor diferente do cobrado: não confirma automaticamente. Precisa de gente olhando.
        await this.audit.record(
          {
            actorUserId: null,
            action: 'payment.amount_mismatch',
            targetType: 'payment_intent',
            targetId: intent.id,
            metadata: { expected: intent.amountCents, reported: snapshot.grossCents, source },
          },
          tx,
        );
        metrics.paymentTransitions.inc({ provider: intent.provider, to: snapshot.status, result: 'amount_mismatch' });
        this.logger.error({ intentId: intent.id, expected: intent.amountCents, reported: snapshot.grossCents }, 'Valor divergente na cobrança');
        return 'AMOUNT_MISMATCH';
      }

      let atual: IntentRow = intent;
      for (const proximo of plano) {
        atual = await this.applyStatus(tx, atual, proximo, snapshot, null);
      }
      return 'APPLIED';
    });
  }

  /** Conciliação periódica: pega webhooks perdidos e expira cobranças vencidas. */
  async reconcilePending(now = new Date()): Promise<{ checked: number; expired: number }> {
    const pendentes = await this.db
      .select()
      .from(paymentIntents)
      .where(and(eq(paymentIntents.status, 'AWAITING_PAYMENT'), lt(paymentIntents.createdAt, new Date(now.getTime() - 2 * 60_000))))
      .limit(200);

    let expiradas = 0;
    for (const intent of pendentes) {
      try {
        await this.syncWithProvider(intent.providerPaymentId!, 'reconciliation');
        const [depois] = await this.db.select().from(paymentIntents).where(eq(paymentIntents.id, intent.id));
        if (depois?.status === 'AWAITING_PAYMENT' && depois.expiresAt && depois.expiresAt < now) {
          await this.db.transaction(async (tx) => {
            const [travada] = await tx.select().from(paymentIntents).where(eq(paymentIntents.id, intent.id)).for('update');
            if (travada?.status === 'AWAITING_PAYMENT') {
              await this.applyStatus(tx, travada, 'EXPIRED', null, null);
              expiradas++;
            }
          });
        }
      } catch (error) {
        this.logger.warn({ intentId: intent.id, err: (error as Error).message }, 'Falha ao conciliar cobrança');
      }
    }
    return { checked: pendentes.length, expired: expiradas };
  }

  /** Eventos que falharam ou ficaram sem processar (para reprocessamento administrativo). */
  async pendingEvents(limit = 100) {
    return this.db
      .select({ id: paymentEvents.id, status: paymentEvents.status, attempts: paymentEvents.attempts, receivedAt: paymentEvents.receivedAt })
      .from(paymentEvents)
      .where(inArray(paymentEvents.status, ['RECEIVED', 'FAILED']))
      .limit(limit);
  }

  // --- Internos ------------------------------------------------------------------

  private async applyStatus(tx: Executor, intent: IntentRow, to: IntentStatus, snapshot: ChargeSnapshot | null, failureReason: string | null): Promise<IntentRow> {
    const agora = new Date();
    const fee = snapshot?.netCents !== null && snapshot?.netCents !== undefined ? snapshot.grossCents - snapshot.netCents : (intent.feeCents ?? 0);
    const [atualizada] = await tx
      .update(paymentIntents)
      .set({
        status: to,
        feeCents: to === 'CONFIRMED' ? fee : undefined,
        netCents: to === 'CONFIRMED' ? intent.amountCents - fee : undefined,
        confirmedAt: to === 'CONFIRMED' ? agora : undefined,
        refundedAt: to === 'REFUNDED' ? agora : undefined,
        failureReason: failureReason ?? undefined,
        version: sql`${paymentIntents.version} + 1`,
        updatedAt: agora,
      })
      .where(and(eq(paymentIntents.id, intent.id), eq(paymentIntents.version, intent.version)))
      .returning();
    if (!atualizada) throw new Error(`Conflito de versão na cobrança ${intent.id}; o job será repetido`);

    const settled: SettledIntent = {
      intentId: intent.id,
      referenceId: intent.referenceId,
      provider: intent.provider as SettledIntent['provider'],
      amountCents: intent.amountCents,
      feeCents: atualizada.feeCents ?? 0,
    };
    const handler = this.settlements.for(intent.referenceType);
    if (to === 'CONFIRMED') await handler.onConfirmed(tx, settled, snapshot!);
    else if (to === 'REFUNDED') await handler.onRefunded(tx, settled, snapshot!);
    else if (to === 'EXPIRED') await handler.onExpired(tx, settled);
    else if (to === 'FAILED') await handler.onFailed(tx, settled, failureReason ?? 'falha');

    await this.audit.record(
      { actorUserId: null, action: `payment.${to.toLowerCase()}`, targetType: 'payment_intent', targetId: intent.id, metadata: { from: intent.status, to } },
      tx,
    );
    metrics.paymentTransitions.inc({ provider: intent.provider, to, result: 'applied' });
    return atualizada;
  }

  private async finishEvent(id: string, status: 'PROCESSED' | 'IGNORED', result: string): Promise<void> {
    await this.db.update(paymentEvents).set({ status, result, processedAt: new Date() }).where(eq(paymentEvents.id, id));
  }

  private async load(intentId: string): Promise<IntentRow> {
    const [intent] = await this.db.select().from(paymentIntents).where(eq(paymentIntents.id, intentId)).limit(1);
    if (!intent) throw new Error(`Cobrança ${intentId} não encontrada`);
    return intent;
  }

  private toView(intent: IntentRow): IntentView {
    return {
      id: intent.id,
      status: intent.status as IntentStatus,
      amountCents: intent.amountCents,
      pixCopyPaste: intent.pixCopyPaste,
      expiresAt: intent.expiresAt,
      provider: intent.provider,
      realMoney: this.provider.realMoney,
    };
  }
}
