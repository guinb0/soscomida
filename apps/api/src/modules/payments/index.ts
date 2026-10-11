import { Inject, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import IORedis from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../../infra/config/config';
import { JobRegistry } from '../../infra/queue/job-registry';
import { QUEUES } from '../../infra/queue/queue';
import { EventHandlerRegistry } from '../outbox';
import { PAYMENT_EVENTS, PaymentsService } from './application/payments.service';
import { SettlementRegistry } from './application/settlement';
import { PAYMENT_PROVIDER, type PaymentProvider } from './domain/payment-provider';
import { DevPaymentsController, PaymentWebhooksController } from './http/webhooks.controller';
import { AsaasPaymentProvider } from './infra/asaas.provider';
import { DevPaymentProvider } from './infra/dev.provider';

export { PaymentsService, type IntentView, PAYMENT_EVENTS } from './application/payments.service';
export { SettlementRegistry, type SettlementHandler, type SettledIntent } from './application/settlement';
export { PAYMENT_PROVIDER, type PaymentProvider, type ChargeSnapshot } from './domain/payment-provider';
export type { IntentStatus } from './domain/intent-status';
export { DevPaymentProvider } from './infra/dev.provider';

function createProvider(config: AppConfig): PaymentProvider {
  if (config.PAYMENTS_PROVIDER === 'asaas') {
    // A validação de configuração já garantiu as credenciais e ASAAS_ADAPTER_VERIFIED.
    return new AsaasPaymentProvider({
      baseUrl: config.ASAAS_BASE_URL!,
      apiKey: config.ASAAS_API_KEY!,
      webhookToken: config.ASAAS_WEBHOOK_TOKEN!,
    });
  }
  return new DevPaymentProvider(new IORedis(config.REDIS_URL, { maxRetriesPerRequest: 3 }));
}

@Module({
  controllers: [PaymentWebhooksController, DevPaymentsController],
  providers: [
    PaymentsService,
    SettlementRegistry,
    { provide: PAYMENT_PROVIDER, inject: [APP_CONFIG], useFactory: createProvider },
  ],
  exports: [PaymentsService, SettlementRegistry, PAYMENT_PROVIDER],
})
export class PaymentsModule implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly payments: PaymentsService,
    private readonly events: EventHandlerRegistry,
    private readonly jobs: JobRegistry,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  onModuleInit(): void {
    this.events.on(PAYMENT_EVENTS.eventReceived, async (evento) => {
      await this.payments.processEvent(String(evento.payload.paymentEventId));
    });
    this.jobs.handle(QUEUES.maintenance, 'payments.reconcile', () => this.payments.reconcilePending());
    this.jobs.schedule({ queue: QUEUES.maintenance, name: 'payments.reconcile', everyMs: 5 * 60_000 });
  }

  onModuleDestroy(): void {
    if (this.provider instanceof DevPaymentProvider) this.provider.close();
  }
}
