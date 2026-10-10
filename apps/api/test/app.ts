import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { AppModule } from '../src/app.module';
import { configureHttpApp } from '../src/bootstrap';
import { DB, type Database } from '../src/infra/db/db';
import { IdentityService } from '../src/modules/identity';

export const ORIGIN = 'http://localhost:3000';

export interface TestApp {
  app: INestApplication;
  db: Database;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureHttpApp(app);
  await app.init();
  return { app, db: app.get<Database>(DB), close: () => app.close() };
}

/**
 * Cliente HTTP que guarda o cookie de sessão e manda `Origin` em toda
 * requisição (como o navegador faz).
 */
export function agent(app: INestApplication): TestAgent {
  return request.agent(app.getHttpServer()).set('Origin', ORIGIN);
}

export const uniqueEmail = (prefix = 'pessoa') => `${prefix}-${randomUUID().slice(0, 8)}@teste.com`;
export const PASSWORD = 'senha-de-teste-123';

/** Cadastra um usuário novo e devolve o agente já logado. */
export async function registeredUser(app: INestApplication, name = 'Pessoa Teste') {
  const http = agent(app);
  const email = uniqueEmail();
  await http.post('/api/auth/register').send({ name, email, password: PASSWORD }).expect(201);
  const me = await http.get('/api/auth/me').expect(200);
  return { http, email, id: (me.body as { id: string }).id };
}

/**
 * Usuário com papel elevado e MFA verificado na sessão (o que os papéis
 * elevados exigem). Configura o TOTP de verdade e usa um código gerado.
 */
export async function userWithRole(app: INestApplication, role: 'moderator' | 'admin' | 'auditor', name = `Pessoa ${role}`) {
  const user = await registeredUser(app, name);
  await app.get(IdentityService).grantRole(user.id, role, null);

  const setup = await user.http.post('/api/auth/mfa/setup').expect(201);
  const { secret } = setup.body as { secret: string };
  const { generateTotp } = await import('../src/modules/identity');
  await user.http.post('/api/auth/mfa/enable').send({ code: generateTotp(secret) }).expect(200);
  return { ...user, secret };
}
