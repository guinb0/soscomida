import { randomUUID } from 'node:crypto';
import type IORedis from 'ioredis';
import type { ProviderChargeStatus } from '../domain/intent-status';
import type { ChargeSnapshot, CreatePixChargeInput, ParsedWebhook, PaymentProvider, PixCharge } from '../domain/payment-provider';

/** Tarifa fictícia do ambiente de desenvolvimento, só para o ledger ter o que mostrar. */
const DEV_FEE_CENTS = 99;
const PREFIX = 'devpay:';

interface DevCharge {
  status: ProviderChargeStatus;
  grossCents: number;
}

/**
 * Provedor de DESENVOLVIMENTO. As cobranças não são pagáveis: o "copia e
 * cola" é texto marcado e o pagamento é simulado por um endpoint que só existe
 * fora de produção. A configuração recusa este provedor em produção.
 *
 * O estado fica no Redis para ser visto tanto pela API quanto pelo worker.
 */
export class DevPaymentProvider implements PaymentProvider {
  readonly name = 'dev' as const;
  readonly realMoney = false;

  constructor(private readonly redis: IORedis) {}

  async createPixCharge(input: CreatePixChargeInput): Promise<PixCharge> {
    const id = `dev_${randomUUID()}`;
    await this.save(id, { status: 'PENDING', grossCents: input.amountCents });
    return {
      providerPaymentId: id,
      copyPaste: `DESENVOLVIMENTO-NAO-PAGAVEL|${id}|${input.amountCents}`,
      expiresAt: input.expiresAt,
    };
  }

  async getCharge(providerPaymentId: string): Promise<ChargeSnapshot> {
    const bruto = await this.redis.get(PREFIX + providerPaymentId);
    if (!bruto) throw new Error(`Cobrança de desenvolvimento desconhecida: ${providerPaymentId}`);
    const cobranca = JSON.parse(bruto) as DevCharge;
    const fee = Math.min(DEV_FEE_CENTS, cobranca.grossCents);
    return {
      providerPaymentId,
      status: cobranca.status,
      grossCents: cobranca.grossCents,
      netCents: cobranca.status === 'PENDING' ? null : cobranca.grossCents - fee,
    };
  }

  /** O endpoint de simulação chama a ingestão diretamente; não há webhook HTTP externo. */
  verifyWebhook(): boolean {
    return false;
  }

  parseWebhook(): ParsedWebhook | null {
    return null;
  }

  /** Simula o que aconteceria no provedor (pago, estornado, vencido). */
  async simulate(providerPaymentId: string, status: ProviderChargeStatus): Promise<void> {
    const atual = await this.getCharge(providerPaymentId);
    await this.save(providerPaymentId, { status, grossCents: atual.grossCents });
  }

  /** Testes: altera o valor reportado (simula divergência de valor). */
  async overrideGross(providerPaymentId: string, grossCents: number): Promise<void> {
    const atual = await this.getCharge(providerPaymentId);
    await this.save(providerPaymentId, { status: atual.status, grossCents });
  }

  close(): void {
    this.redis.disconnect();
  }

  private async save(id: string, charge: DevCharge): Promise<void> {
    await this.redis.set(PREFIX + id, JSON.stringify(charge), 'EX', 30 * 24 * 3600);
  }
}
