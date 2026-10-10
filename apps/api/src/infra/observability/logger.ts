import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { AppConfig } from '../config/config';

/** Campos que nunca podem aparecer em log (LGPD e segredos). */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["asaas-access-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.senha',
  '*.cpf',
  '*.cnpj',
  '*.token',
  '*.secret',
  '*.code',
];

export function loggerParams(config: AppConfig, serviceName: string): Params {
  return {
    pinoHttp: {
      level: config.LOG_LEVEL,
      base: { service: serviceName, env: config.NODE_ENV },
      redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
      // Correlation id: reaproveita o do proxy (Traefik) ou cria um.
      genReqId: (req: IncomingMessage) => {
        const header = req.headers['x-request-id'];
        return typeof header === 'string' && /^[\w-]{8,64}$/.test(header) ? header : randomUUID();
      },
      customProps: (req: IncomingMessage) => ({ requestId: (req as IncomingMessage & { id?: string }).id }),
      serializers: {
        // Só método, rota e id: corpo e query podem conter dados pessoais.
        req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url.split('?')[0] }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      autoLogging: { ignore: (req: IncomingMessage) => req.url?.startsWith('/api/health') === true },
    },
  };
}
