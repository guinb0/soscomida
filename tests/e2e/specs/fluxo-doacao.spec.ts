import { type Page, expect, test } from '@playwright/test';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Secret, TOTP } from 'otpauth';

const RAIZ = path.resolve(import.meta.dirname, '../../..');
const MAILPIT = 'http://127.0.0.1:8025';
const SENHA = 'senha-de-teste-e2e-123';

const sufixo = () => randomUUID().slice(0, 8);

async function cadastrar(page: Page, nome: string): Promise<string> {
  const email = `e2e-${sufixo()}@exemplo.com`;
  await page.goto('/cadastrar');
  await page.getByLabel('Nome').fill(nome);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(SENHA);
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await page.waitForURL('**/painel');
  return email;
}

function concederPapel(email: string, papel: 'moderator'): void {
  // O e-mail é gerado pelo próprio teste (sem caracteres de shell).
  execSync(`pnpm --filter @soscomida/api grant-role ${email} ${papel}`, { cwd: RAIZ, stdio: 'ignore' });
}

const codigoTotp = (secret: string) => new TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(secret) }).generate();

/** E-mails que chegaram ao Mailpit para o endereço (vazio se o Mailpit não estiver no ar). */
async function emailsPara(email: string): Promise<string[]> {
  const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`).catch(() => null);
  if (!r?.ok) return [];
  const corpo = (await r.json()) as { messages: { Subject: string }[] };
  return corpo.messages.map((m) => m.Subject);
}

test('organizador cria, moderação aprova, visitante doa por Pix e o valor aparece na transparência', async ({ browser, isMobile }) => {
  const titulo = `Cestas E2E ${sufixo()}${isMobile ? ' celular' : ''}`;

  // 1. Organizadora cria a campanha e envia para análise.
  const org = await (await browser.newContext()).newPage();
  const emailOrg = await cadastrar(org, 'Organizadora E2E');
  await org.goto('/painel/campanhas/nova');
  await org.getByLabel('Título').fill(titulo);
  await org.getByLabel('Resumo (aparece nos cards)').fill('Comprar cestas básicas para famílias cadastradas no CRAS da região.');
  await org.getByLabel('Descrição completa').fill('Descrição completa da campanha de teste ponta a ponta. '.repeat(5));
  await org.getByLabel('Meta (R$)').fill('1.500,00');
  const prazo = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  await org.getByLabel('Prazo').fill(prazo);
  await org.getByLabel('Descrição do item 1').fill('Itens das cestas');
  await org.getByLabel('Valor do item 1').fill('1.500,00');
  await expect(org.getByText('fecha com a meta')).toBeVisible();
  await org.getByRole('button', { name: 'Salvar rascunho' }).click();
  await org.waitForURL(/\/painel\/campanhas\/[0-9a-f-]{36}$/);
  await org.getByRole('button', { name: 'Enviar para análise' }).click();
  await expect(org.getByText('Aguardando verificação').first()).toBeVisible();

  // 2. Moderadora: papel concedido pela CLI, MFA configurado pela tela, aprova.
  const mod = await (await browser.newContext()).newPage();
  const emailMod = await cadastrar(mod, 'Moderadora E2E');
  concederPapel(emailMod, 'moderator');
  await mod.goto('/seguranca?next=/moderacao');
  await mod.getByRole('button', { name: 'Configurar agora' }).click();
  const secret = (await mod.locator('code').textContent())!.trim();
  await mod.getByLabel('Código do autenticador').fill(codigoTotp(secret));
  await mod.getByRole('button', { name: 'Ativar' }).click();
  await mod.waitForURL('**/moderacao');
  await mod.getByRole('link', { name: titulo }).click();
  await mod.getByRole('button', { name: 'Assumir análise' }).click();
  await mod.getByLabel(/Justificativa/).fill('Orçamento e descrição conferidos no teste ponta a ponta.');
  await mod.getByRole('button', { name: 'Aprovar' }).click();
  await expect(mod.getByText('Campanha aprovada.')).toBeVisible();

  // 3. Organizadora publica.
  await org.reload();
  await org.getByRole('button', { name: 'Publicar e começar a receber doações' }).click();
  await expect(org.getByText('Ativa', { exact: true }).first()).toBeVisible();

  // 4. Visitante sem conta acha a campanha no catálogo e doa R$ 50,00.
  const doador = await (await browser.newContext()).newPage();
  await doador.goto('/campanhas');
  await doador.getByRole('link', { name: titulo }).first().click();
  await doador.waitForURL(/\/campanhas\/[a-z0-9-]+$/);
  const urlCampanha = doador.url();
  await doador.getByLabel('Outro valor (R$)').fill('50,00');
  await doador.getByLabel('Nome do pagador').fill('Pagador E2E');
  await doador.getByLabel('CPF do pagador').fill('529.982.247-25');
  await doador.getByLabel('Nome na lista de apoiadores (opcional)').fill('Apoiadora E2E');
  await doador.getByRole('button', { name: 'Gerar Pix' }).click();
  await doador.waitForURL(/\/doacao\/[0-9a-f-]{36}$/);
  await expect(doador.getByRole('img', { name: 'QR Code Pix para pagamento' })).toBeVisible();
  await expect(doador.getByText('Este QR Code não é pagável')).toBeVisible();
  await doador.getByRole('button', { name: 'Simular pagamento (desenvolvimento)' }).click();
  await expect(doador.getByText('Pagamento confirmado pelo banco. Obrigado!')).toBeVisible({ timeout: 30_000 });

  // 5. Página pública: o valor confirmado aparece (cache do servidor de até 30 s).
  await expect
    .poll(
      async () => {
        await doador.goto(urlCampanha);
        return doador.locator('main').innerText();
      },
      { timeout: 60_000, intervals: [2_000, 5_000] },
    )
    .toContain('Apoiadora E2E');
  const pagina = await doador.locator('main').innerText();
  expect(pagina).toContain('50,00');
  expect(pagina).not.toContain('529.982.247-25');
  expect(pagina).not.toContain('Pagador E2E');

  // 6. Avisos por e-mail (Mailpit): aprovação para a organizadora.
  await expect.poll(() => emailsPara(emailOrg), { timeout: 30_000 }).toContainEqual(expect.stringContaining('Campanha aprovada'));
});

test('páginas públicas abrem sem login e sem erros no console', async ({ page }) => {
  const erros: string[] = [];
  page.on('pageerror', (e) => erros.push(e.message));
  page.on('console', (m) => m.type() === 'error' && erros.push(m.text()));
  for (const rota of ['/', '/campanhas', '/como-funciona', '/transparencia', '/entrar', '/cadastrar']) {
    const resposta = await page.goto(rota);
    expect(resposta?.status(), rota).toBe(200);
    await expect(page.locator('h1').first()).toBeVisible();
  }
  expect(erros).toEqual([]);
});

test('área restrita manda para o login', async ({ page }) => {
  await page.goto('/painel');
  await page.waitForURL(/\/entrar\?next=%2Fpainel/);
  await page.goto('/moderacao');
  await page.waitForURL(/\/entrar\?next=%2Fmoderacao/);
});
