import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { APP_CONFIG, type AppConfig } from '../infra/config/config';
import { ConfigModule } from '../infra/config/config.module';
import { DbModule } from '../infra/db/db';
import { loggerParams } from '../infra/observability/logger';
import { JobRegistryModule } from '../infra/queue/job-registry';
import { QueueModule } from '../infra/queue/queue';
import { DOMAIN_MODULES } from '../modules';
import { WorkerRuntime } from './worker.runtime';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({ inject: [APP_CONFIG], useFactory: (config: AppConfig) => loggerParams(config, 'worker') }),
    DbModule,
    QueueModule,
    JobRegistryModule,
    ...DOMAIN_MODULES,
  ],
  providers: [WorkerRuntime],
})
export class WorkerModule {}
