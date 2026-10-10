import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateTotp } from '../src/modules/identity';
import { ORIGIN, PASSWORD, type TestApp, agent, createTestApp, registeredUser, uniqueEmail, userWithRole } from './app';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('cadastro, login e sessão', () => {
  it('cadastra, normaliza o e-mail e abre sessão por cookie HttpOnly', async () => {
    const http = agent(t.app);
    const email = uniqueEmail().toUpperCase();
    const res = await http.post('/api/auth/register').send({ name: 'Maria', email, password: PASSWORD }).expect(201);

    const cookie = res.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toMatch(/^sc_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const me = await http.get('/api/auth/me').expect(200);
    expect(me.body).toMatchObject({ name: 'Maria', email: email.toLowerCase(), roles: [], mfaEnabled: false });
  });

  it('recusa e-mail duplicado', async () => {
    const { email } = await registeredUser(t.app);
    const res = await agent(t.app).post('/api/auth/register').send({ name: 'Outra', email, password: PASSWORD }).expect(409);
    expect(res.body.code).toBe('EMAIL_IN_USE');
  });

  it('valida a entrada com o contrato compartilhado', async () => {
    const res = await agent(t.app).post('/api/auth/register').send({ name: 'X', email: 'nao-e-email', password: '123' }).expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('dá a mesma resposta para e-mail inexistente e senha errada', async () => {
    const { email } = await registeredUser(t.app);
    const senhaErrada = await agent(t.app).post('/api/auth/login').send({ email, password: 'errada-errada' }).expect(401);
    const inexistente = await agent(t.app).post('/api/auth/login').send({ email: uniqueEmail(), password: 'errada-errada' }).expect(401);
    expect(senhaErrada.body.code).toBe('INVALID_CREDENTIALS');
    expect(inexistente.body).toMatchObject({ code: senhaErrada.body.code, message: senhaErrada.body.message });
  });

  it('bloqueia o e-mail após 10 falhas em 15 minutos', async () => {
    const { email } = await registeredUser(t.app);
    for (let i = 0; i < 10; i++) {
      await agent(t.app).post('/api/auth/login').send({ email, password: `errada-${i}-xx` }).expect(401);
    }
    const res = await agent(t.app).post('/api/auth/login').send({ email, password: PASSWORD }).expect(429);
    expect(res.body.code).toBe('TOO_MANY_ATTEMPTS');
  });

  it('logout revoga a sessão no servidor (o cookie antigo deixa de valer)', async () => {
    const { http } = await registeredUser(t.app);
    const cookieAntigo = (await http.get('/api/auth/me')).request.cookies;
    await http.post('/api/auth/logout').expect(200);

    const res = await request(t.app.getHttpServer()).get('/api/auth/me').set('Cookie', cookieAntigo).expect(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('"sair de todos os dispositivos" derruba as outras sessões', async () => {
    const { http, email } = await registeredUser(t.app);
    const outroDispositivo = agent(t.app);
    await outroDispositivo.post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    await outroDispositivo.get('/api/auth/me').expect(200);

    await http.post('/api/auth/logout-all').expect(200);
    await outroDispositivo.get('/api/auth/me').expect(401);
  });
});

describe('CSRF por origem', () => {
  it('recusa requisição com sessão vinda de outra origem', async () => {
    const { http } = await registeredUser(t.app);
    const res = await http.post('/api/auth/logout').set('Origin', 'https://site-malicioso.example').expect(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('aceita a origem do front', async () => {
    const { http } = await registeredUser(t.app);
    await http.post('/api/auth/logout').set('Origin', ORIGIN).expect(200);
  });
});

describe('papéis e MFA', () => {
  it('doador não acessa rota de administrador', async () => {
    const { http, id } = await registeredUser(t.app);
    await http.post(`/api/admin/users/${id}/roles`).send({ role: 'admin' }).expect(403);
  });

  it('administrador sem MFA configurado recebe MFA_SETUP_REQUIRED', async () => {
    const { http, id } = await registeredUser(t.app);
    const { IdentityService } = await import('../src/modules/identity');
    await t.app.get(IdentityService).grantRole(id, 'admin', null);

    const res = await http.post(`/api/admin/users/${id}/roles`).send({ role: 'auditor' }).expect(403);
    expect(res.body.code).toBe('MFA_SETUP_REQUIRED');
  });

  it('nova sessão de admin exige o código; depois de verificar, o token muda e o acesso libera', async () => {
    const admin = await userWithRole(t.app, 'admin');
    const alvo = await registeredUser(t.app);

    const http = agent(t.app);
    await http.post('/api/auth/login').send({ email: admin.email, password: PASSWORD }).expect(200);
    const bloqueado = await http.post(`/api/admin/users/${alvo.id}/roles`).send({ role: 'moderator' }).expect(403);
    expect(bloqueado.body.code).toBe('MFA_REQUIRED');

    await http.post('/api/auth/mfa/verify').send({ code: '000000' }).expect(422);
    const verificado = await http.post('/api/auth/mfa/verify').send({ code: generateTotp(admin.secret) }).expect(200);
    expect(verificado.headers['set-cookie']?.[0]).toMatch(/^sc_session=/);

    await http.post(`/api/admin/users/${alvo.id}/roles`).send({ role: 'moderator' }).expect(200);
    const meAlvo = await alvo.http.get('/api/auth/me').expect(200);
    expect(meAlvo.body.roles).toEqual(['moderator']);
  });

  it('não deixa o admin remover o próprio papel', async () => {
    const admin = await userWithRole(t.app, 'admin');
    const res = await admin.http.delete(`/api/admin/users/${admin.id}/roles/admin`).expect(409);
    expect(res.body.code).toBe('CANNOT_REVOKE_OWN_ADMIN');
  });
});
