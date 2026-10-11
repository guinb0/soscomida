import type { ProviderChargeStatus } from './intent-status';

export type ProviderName = 'asaas' | 'dev';

export interface CreatePixChargeInput {
  intentId: string;
  amountCents: number;
  description: string;
  expiresAt: Date;
  payer: { name: string; cpf: string; email?: string };
}

export interface PixCharge {
  providerPaymentId: string;
  /** Código "copia e cola" (o QR Code é gerado a partir dele no front). */
  copyPaste: string;
  expiresAt: Date;
}

/** Estado de uma cobrança segundo o provedor — a fonte da verdade financeira. */
export interface ChargeSnapshot {
  providerPaymentId: string;
  status: ProviderChargeStatus;
  grossCents: number;
  /** Líquido após a tarifa do provedor, quando ele informa. */
  netCents: number | null;
}

export interface ParsedWebhook {
  providerEventId: string;
  eventType: string;
  providerPaymentId: string | null;
  /** Payload reduzido ao necessário (sem dados pessoais) para guardar como evidência. */
  storedPayload: Record<string, unknown>;
}

export interface PaymentProvider {
  readonly name: ProviderName;
  /** Cobranças deste provedor podem ser pagas de verdade? (o de desenvolvimento não). */
  readonly realMoney: boolean;
  createPixCharge(input: CreatePixChargeInput): Promise<PixCharge>;
  getCharge(providerPaymentId: string): Promise<ChargeSnapshot>;
  verifyWebhook(headers: Record<string, string | string[] | undefined>): boolean;
  parseWebhook(body: unknown): ParsedWebhook | null;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

/** Falha de comunicação com o provedor (rede, timeout, 5xx): pode tentar de novo. */
export class ProviderUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ProviderUnavailableError';
  }
}

/** O provedor recusou a operação (dados inválidos, 4xx): tentar de novo não resolve. */
export class ProviderRejectedError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ProviderRejectedError';
  }
}
