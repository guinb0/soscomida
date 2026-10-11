import { Body, Controller, HttpCode, Inject, Module, NotFoundException, type OnModuleDestroy, type OnModuleInit, Param, Post } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import IORedis from 'ioredis';
import { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../../infra/config/config';
import { Public } from '../../infra/http/decorators';
import { ZodPipe } from '../../infra/http/zod';
import { EventHandlerRegistry } from '../outbox';
import { StorageModule } from '../storage';
import { FISCAL_VERIFICATION_PROVIDERS, type FiscalVerificationProvider } from './domain/verification';
import { FISCAL_EVENTS, FiscalService } from './fiscal.service';
import { DevFiscalVerificationProvider, NoIntegrationFiscalProvider } from './infra/providers';

export { FiscalService, FISCAL_EVENTS, type Extraction, type FiscalDocumentView } from './fiscal.service';
export type { FiscalVerificationProvider, FiscalVerificationResult, FiscalDocumentRef } from './domain/verification';

function createProviders(config: AppConfig): FiscalVerificationProvider[] {
  if (config.FISCAL_VERIFICATION_PROVIDER === 'dev') return [new DevFiscalVerificationProvider(new IORedis(config.REDIS_URL, { maxRetriesPerRequest: 3 }))];
  return [new NoIntegrationFiscalProvider()];
}

const simulateSchema = z.object({ status: z.enum(['AUTHORIZED', 'CANCELLED', 'NOT_FOUND', 'DIVERGENT']) });

/** SÓ DESENVOLVIMENTO: combina o resultado da "consulta ao fisco" de uma chave. */
@Controller('dev/fiscal')
class DevFiscalController {
  constructor(
    @Inject(FISCAL_VERIFICATION_PROVIDERS) private readonly providers: FiscalVerificationProvider[],
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @ApiExcludeEndpoint()
  @Post(':accessKey/simulate')
  @HttpCode(200)
  async simulate(@Param('accessKey') accessKey: string, @Body(new ZodPipe(simulateSchema)) input: z.infer<typeof simulateSchema>) {
    const dev = this.providers.find((p): p is DevFiscalVerificationProvider => p instanceof DevFiscalVerificationProvider);
    if (this.config.isProduction || !dev || !/^\d{44}$/.test(accessKey)) throw new NotFoundException();
    await dev.simulate(accessKey, input.status);
    return { ok: true, note: 'Simulação de desenvolvimento: nenhuma consulta real ao fisco.' };
  }
}

@Module({
  imports: [StorageModule],
  controllers: [DevFiscalController],
  providers: [FiscalService, { provide: FISCAL_VERIFICATION_PROVIDERS, inject: [APP_CONFIG], useFactory: createProviders }],
  exports: [FiscalService],
})
export class FiscalModule implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly fiscal: FiscalService,
    private readonly events: EventHandlerRegistry,
    @Inject(FISCAL_VERIFICATION_PROVIDERS) private readonly providers: FiscalVerificationProvider[],
  ) {}

  onModuleInit(): void {
    this.events.on(FISCAL_EVENTS.registered, async (e) => {
      await this.fiscal.verify(String(e.payload.documentId));
    });
  }

  onModuleDestroy(): void {
    for (const p of this.providers) if (p instanceof DevFiscalVerificationProvider) p.close();
  }
}
