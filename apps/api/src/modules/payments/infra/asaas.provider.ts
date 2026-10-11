import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { constantTimeEquals } from './timing-safe';
import type { ProviderChargeStatus } from '../domain/intent-status';
import {
  type ChargeSnapshot,
  type CreatePixChargeInput,
  type ParsedWebhook,
  type PaymentProvider,
  type PixCharge,
  ProviderRejectedError,
  ProviderUnavailableError,
} from '../domain/payment-provider';

export interface AsaasConfig {
  baseUrl: string;
  apiKey: string;
  webhookToken: string;
  /** Cabeçalho da chave de API. Não confirmado na documentação oficial: ver docs/PAYMENTS.md. */
  apiKeyHeader?: string;
  timeoutMs?: number;
}

/**
 * Status de cobrança do Asaas → estado normalizado. Os valores usados aqui
 * precisam ser conferidos contra o sandbox antes de ligar o adaptador
 * (ASAAS_ADAPTER_VERIFIED). Status desconhecido vira PENDING: na dúvida, não
 * confirmamos dinheiro.
 */
const STATUS_MAP: Record<string, ProviderChargeStatus> = {
  PENDING: 'PENDING',
  AWAITING_RISK_ANALYSIS: 'PENDING',
  RECEIVED: 'CONFIRMED',
  CONFIRMED: 'CONFIRMED',
  RECEIVED_IN_CASH: 'CONFIRMED',
  OVERDUE: 'EXPIRED',
  REFUNDED: 'REFUNDED',
  REFUND_REQUESTED: 'CONFIRMED',
  REFUND_IN_PROGRESS: 'CONFIRMED',
};

const chargeSchema = z.object({
  id: z.string(),
  status: z.string(),
  value: z.number(),
  netValue: z.number().nullable().optional(),
});

const webhookSchema = z.object({
  id: z.string(),
  event: z.string(),
  payment: z.object({ id: z.string(), status: z.string().optional(), value: z.number().optional(), netValue: z.number().optional() }).partial().optional(),
});

/** Converte reais (número com 2 casas, como a API usa) em centavos sem acumular erro. */
const toCents = (reais: number) => Math.round(reais * 100);
const toReais = (centavos: number) => Number((centavos / 100).toFixed(2));

/** Data de vencimento no fuso de Brasília (a API do Asaas usa YYYY-MM-DD). */
const dueDate = (date: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

export class AsaasPaymentProvider implements PaymentProvider {
  readonly name = 'asaas' as const;
  readonly realMoney = true;
  private readonly logger = new Logger(AsaasPaymentProvider.name);

  constructor(
    private readonly config: AsaasConfig,
    private readonly http: typeof fetch = fetch,
  ) {}

  async createPixCharge(input: CreatePixChargeInput): Promise<PixCharge> {
    const cliente = await this.request<{ id: string }>('POST', '/v3/customers', {
      name: input.payer.name,
      cpfCnpj: input.payer.cpf,
      email: input.payer.email,
      externalReference: input.intentId,
    });
    const cobranca = await this.request<{ id: string }>('POST', '/v3/payments', {
      customer: cliente.id,
      billingType: 'PIX',
      value: toReais(input.amountCents),
      dueDate: dueDate(input.expiresAt),
      description: input.description.slice(0, 500),
      externalReference: input.intentId,
    });
    const qr = await this.request<{ payload: string; expirationDate?: string }>('GET', `/v3/payments/${encodeURIComponent(cobranca.id)}/pixQrCode`);
    return {
      providerPaymentId: cobranca.id,
      copyPaste: qr.payload,
      expiresAt: qr.expirationDate ? new Date(qr.expirationDate) : input.expiresAt,
    };
  }

  async getCharge(providerPaymentId: string): Promise<ChargeSnapshot> {
    const bruto = await this.request<unknown>('GET', `/v3/payments/${encodeURIComponent(providerPaymentId)}`);
    const cobranca = chargeSchema.parse(bruto);
    const status = STATUS_MAP[cobranca.status];
    if (!status) this.logger.warn({ providerPaymentId, status: cobranca.status }, 'Status desconhecido do Asaas; tratado como PENDING');
    return {
      providerPaymentId: cobranca.id,
      status: status ?? 'PENDING',
      grossCents: toCents(cobranca.value),
      netCents: cobranca.netValue === undefined || cobranca.netValue === null ? null : toCents(cobranca.netValue),
    };
  }

  verifyWebhook(headers: Record<string, string | string[] | undefined>): boolean {
    const token = headers['asaas-access-token'];
    return typeof token === 'string' && constantTimeEquals(token, this.config.webhookToken);
  }

  parseWebhook(body: unknown): ParsedWebhook | null {
    const resultado = webhookSchema.safeParse(body);
    if (!resultado.success) return null;
    const { id, event, payment } = resultado.data;
    return {
      providerEventId: id,
      eventType: event,
      providerPaymentId: payment?.id ?? null,
      // Só o necessário como evidência; nada de dados do cliente.
      storedPayload: { event, payment: payment ? { id: payment.id, status: payment.status, value: payment.value, netValue: payment.netValue } : null },
    };
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let resposta: Response;
    try {
      resposta = await this.http(`${this.config.baseUrl.replace(/\/$/, '')}${path}`, {
        method,
        headers: {
          [this.config.apiKeyHeader ?? 'access_token']: this.config.apiKey,
          'Content-Type': 'application/json',
          'User-Agent': 'soscomida-api',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 10_000),
      });
    } catch (error) {
      throw new ProviderUnavailableError(`Asaas indisponível em ${method} ${path}`, { cause: error });
    }
    if (resposta.status >= 500 || resposta.status === 429) {
      throw new ProviderUnavailableError(`Asaas respondeu ${resposta.status} em ${method} ${path}`);
    }
    if (!resposta.ok) {
      // Corpo de erro pode ecoar dados enviados; não vai para o log inteiro.
      throw new ProviderRejectedError(`Asaas recusou ${method} ${path} (${resposta.status})`, resposta.status);
    }
    return (await resposta.json()) as T;
  }
}
