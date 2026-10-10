import {
  type CallHandler,
  Controller,
  type ExecutionContext,
  Get,
  Global,
  Header,
  Headers,
  Inject,
  Injectable,
  Module,
  type NestInterceptor,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { type Observable, tap } from 'rxjs';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { forbidden } from '../http/errors';
import { Public } from '../http/decorators';

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

const httpDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duração das requisições HTTP',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

/** Métricas de negócio usadas por mais de um módulo. */
export const metrics = {
  paymentWebhooks: new Counter({
    name: 'payment_webhooks_total',
    help: 'Webhooks de pagamento recebidos',
    labelNames: ['provider', 'result'],
    registers: [registry],
  }),
  paymentTransitions: new Counter({
    name: 'payment_transitions_total',
    help: 'Transições de cobrança aplicadas ou ignoradas',
    labelNames: ['provider', 'to', 'result'],
    registers: [registry],
  }),
  jobs: new Counter({
    name: 'jobs_total',
    help: 'Jobs processados pelo worker',
    labelNames: ['queue', 'result'],
    registers: [registry],
  }),
  outboxPublished: new Counter({
    name: 'outbox_published_total',
    help: 'Eventos do outbox publicados na fila',
    labelNames: ['type'],
    registers: [registry],
  }),
};

@Injectable()
class HttpMetricsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const fim = httpDuration.startTimer();
    const registrar = () => {
      const route = (request.route as { path?: string } | undefined)?.path ?? 'desconhecida';
      fim({ method: request.method, route, status: http.getResponse<Response>().statusCode });
    };
    return next.handle().pipe(tap({ next: registrar, error: registrar }));
  }
}

@ApiExcludeController()
@Controller('metrics')
class MetricsController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  @Public()
  @Get()
  @Header('Content-Type', registry.contentType)
  async metrics(@Headers('authorization') authorization?: string): Promise<string> {
    if (this.config.METRICS_TOKEN && authorization !== `Bearer ${this.config.METRICS_TOKEN}`) {
      throw forbidden();
    }
    return registry.metrics();
  }
}

@Global()
@Module({
  controllers: [MetricsController],
  providers: [{ provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor }],
})
export class MetricsModule {}
