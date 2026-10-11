import { Body, Controller, Headers, HttpCode, Inject, NotFoundException, Param, Post, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../../../infra/config/config';
import { Public, SkipOriginCheck } from '../../../infra/http/decorators';
import { ZodPipe } from '../../../infra/http/zod';
import { PaymentsService } from '../application/payments.service';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../domain/payment-provider';
import { DevPaymentProvider } from '../infra/dev.provider';

@ApiTags('pagamentos')
@Controller('payments')
export class PaymentWebhooksController {
  constructor(private readonly payments: PaymentsService) {}

  /**
   * Recebe webhooks do provedor. Grava e responde 200 rápido; o processamento
   * é assíncrono (docs/PAYMENTS.md). Evento repetido também recebe 200.
   */
  @Public()
  @SkipOriginCheck()
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @Post('webhooks/:provider')
  @HttpCode(200)
  async webhook(
    @Param('provider') provider: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: unknown,
  ): Promise<{ received: true }> {
    const evento = this.payments.verifyAndParseWebhook(provider, headers, body);
    if (!evento) throw new UnauthorizedException();
    await this.payments.ingestEvent(evento);
    return { received: true };
  }
}

const simulateSchema = z.object({ outcome: z.enum(['CONFIRMED', 'REFUNDED', 'EXPIRED', 'FAILED']) });

/**
 * SÓ DESENVOLVIMENTO: simula o provedor reportando uma mudança e injeta o
 * evento no mesmo caminho de um webhook real (ingestão → fila → consulta ao
 * provedor → ledger). Responde 404 fora de development/test ou com provedor real.
 */
@ApiTags('pagamentos')
@Controller('dev/payments')
export class DevPaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @ApiExcludeEndpoint()
  @Post(':providerPaymentId/simulate')
  @HttpCode(200)
  async simulate(@Param('providerPaymentId') providerPaymentId: string, @Body(new ZodPipe(simulateSchema)) input: z.infer<typeof simulateSchema>) {
    if (this.config.isProduction || !(this.provider instanceof DevPaymentProvider)) throw new NotFoundException();
    await this.provider.simulate(providerPaymentId, input.outcome);
    await this.payments.ingestEvent({
      providerEventId: `dev_evt_${randomUUID()}`,
      eventType: `DEV_${input.outcome}`,
      providerPaymentId,
      storedPayload: { simulated: true, outcome: input.outcome },
    });
    return { ok: true, note: 'Simulação de desenvolvimento: nenhum dinheiro real foi movimentado.' };
  }
}
