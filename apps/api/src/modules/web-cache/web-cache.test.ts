import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../infra/config/config';
import { WebCacheService } from './index';

const SEGREDO = 'x'.repeat(40);
let servidor: Server;
let url: string;
const recebidos: { auth: string | undefined; body: string }[] = [];
let status = 200;

beforeAll(async () => {
  servidor = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      recebidos.push({ auth: req.headers.authorization, body });
      res.writeHead(status).end();
    });
  });
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/interno/revalidar`;
});
afterAll(() => new Promise<void>((r) => servidor.close(() => r())));

const servico = (cfg: Partial<AppConfig>) => new WebCacheService(cfg as AppConfig);

describe('WebCacheService', () => {
  it('envia as etiquetas com o segredo', async () => {
    status = 200;
    await expect(servico({ WEB_REVALIDATE_URL: url, WEB_REVALIDATE_SECRET: SEGREDO }).revalidate(['campaigns', 'campaign:abc'])).resolves.toBe(true);
    expect(recebidos.at(-1)).toEqual({ auth: `Bearer ${SEGREDO}`, body: JSON.stringify({ tags: ['campaigns', 'campaign:abc'] }) });
  });

  it('site recusando ou fora do ar não lança erro (o TTL cobre)', async () => {
    status = 500;
    await expect(servico({ WEB_REVALIDATE_URL: url, WEB_REVALIDATE_SECRET: SEGREDO }).revalidate(['campaigns'])).resolves.toBe(false);
    await expect(servico({ WEB_REVALIDATE_URL: 'http://127.0.0.1:1/x', WEB_REVALIDATE_SECRET: SEGREDO }).revalidate(['campaigns'])).resolves.toBe(false);
  });

  it('desligado sem URL', async () => {
    const s = servico({});
    expect(s.enabled).toBe(false);
    await expect(s.revalidate(['campaigns'])).resolves.toBe(false);
  });
});
