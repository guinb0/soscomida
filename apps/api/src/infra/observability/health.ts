import { Controller, Get, HttpStatus, Inject, Module, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import type { Response } from 'express';
import { DB, type Database } from '../db/db';
import { Public } from '../http/decorators';
import { QueueRegistry } from '../queue/queue';

@ApiTags('saúde')
@Controller('health')
class HealthController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly queues: QueueRegistry,
  ) {}

  /** Processo de pé (liveness). Não toca dependências. */
  @Public()
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /** Pronto para tráfego (readiness): banco e Redis respondem. */
  @Public()
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const [db, redis] = await Promise.all([
      this.check(async () => {
        await this.db.execute(sql`select 1`);
      }),
      this.check(() => this.queues.ping()),
    ]);
    const ok = db && redis;
    if (!ok) res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { status: ok ? 'ok' : 'degraded', checks: { database: db, redis } };
  }

  private async check(fn: () => Promise<void>): Promise<boolean> {
    try {
      await Promise.race([fn(), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2_000))]);
      return true;
    } catch {
      return false;
    }
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
