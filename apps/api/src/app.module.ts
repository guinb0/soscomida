import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { APP_CONFIG, type AppConfig } from './infra/config/config';
import { ConfigModule } from './infra/config/config.module';
import { DbModule } from './infra/db/db';
import { ApiExceptionFilter } from './infra/http/exception.filter';
import { OriginGuard } from './infra/http/origin.guard';
import { HealthModule } from './infra/observability/health';
import { loggerParams } from './infra/observability/logger';
import { MetricsModule } from './infra/observability/metrics';
import { JobRegistryModule } from './infra/queue/job-registry';
import { QueueModule } from './infra/queue/queue';
import { DOMAIN_MODULES } from './modules';
import { RolesGuard, SessionGuard } from './modules/identity';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({ inject: [APP_CONFIG], useFactory: (config: AppConfig) => loggerParams(config, 'api') }),
    // Limite geral generoso; rotas de credencial têm limite próprio (@Throttle).
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
    DbModule,
    QueueModule,
    JobRegistryModule,
    MetricsModule,
    HealthModule,
    ...DOMAIN_MODULES,
  ],
  providers: [
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    // Ordem de execução: limite de taxa → origem (CSRF) → sessão → papel.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
