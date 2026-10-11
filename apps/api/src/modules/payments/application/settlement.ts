import { Injectable } from '@nestjs/common';
import type { Executor } from '../../../infra/db/db';
import type { ChargeSnapshot, ProviderName } from '../domain/payment-provider';

/** O que o dono da cobrança (ex.: doações) recebe quando o dinheiro muda de estado. */
export interface SettledIntent {
  intentId: string;
  referenceId: string;
  provider: ProviderName;
  amountCents: number;
  feeCents: number;
}

/**
 * Porta implementada por quem cria cobranças (hoje, o módulo de doações).
 * Chamada **dentro** da transação que muda a cobrança: a doação, o ledger e
 * a cobrança mudam juntos ou não mudam.
 *
 * Inversão de dependência: pagamentos não conhece doações; doações registra
 * seu handler aqui.
 */
export interface SettlementHandler {
  onConfirmed(tx: Executor, intent: SettledIntent, snapshot: ChargeSnapshot): Promise<void>;
  onRefunded(tx: Executor, intent: SettledIntent, snapshot: ChargeSnapshot): Promise<void>;
  onExpired(tx: Executor, intent: SettledIntent): Promise<void>;
  onFailed(tx: Executor, intent: SettledIntent, reason: string): Promise<void>;
}

@Injectable()
export class SettlementRegistry {
  private readonly handlers = new Map<string, SettlementHandler>();

  register(referenceType: string, handler: SettlementHandler): void {
    this.handlers.set(referenceType, handler);
  }

  for(referenceType: string): SettlementHandler {
    const handler = this.handlers.get(referenceType);
    if (!handler) throw new Error(`Nenhum SettlementHandler para "${referenceType}"`);
    return handler;
  }
}
