import { expect, test } from '@playwright/test';
import { SENHA, apiDo, campanhaAtivaViaApi, despesaEnviadaViaApi, moderadoraViaApi, sufixo } from '../helpers';

test('despesa com item fora da finalidade: análise na revisão, recusa, contestação pela organizadora e outra moderadora assume', async ({ browser }, testInfo) => {
  const orgCtx = await browser.newContext();
  const modCtx = await browser.newContext();
  const outraCtx = await browser.newContext();
  await apiDo(orgCtx).post('/auth/register', { name: 'Organizadora Contestação', email: `e2e-${sufixo()}@exemplo.com`, password: SENHA });
  await moderadoraViaApi(modCtx);
  await moderadoraViaApi(outraCtx);
  const campanha = await campanhaAtivaViaApi(orgCtx, modCtx, `Análise E2E ${sufixo()}`);
  const descricao = `Compra mista ${sufixo()}`;
  const despesaId = await despesaEnviadaViaApi(orgCtx, campanha.id, descricao, [
    { descricao: 'ARROZ TIPO 1 5KG', centavos: 2_590 },
    { descricao: 'CERVEJA LATA 350ML', centavos: 4_290 },
  ]);

  // 1. Fila por risco: a análise roda no worker; a moderadora vê o risco na fila.
  const mod = await modCtx.newPage();
  await expect
    .poll(
      async () => {
        await mod.goto('/moderacao/despesas');
        return mod.getByRole('listitem').filter({ hasText: descricao }).innerText();
      },
      { timeout: 60_000, intervals: [1_000, 2_000] },
    )
    .toMatch(/Risco (alto|médio)/);

  // 2. Painel de análise na revisão.
  await mod.getByRole('link', { name: descricao }).click();
  await expect(mod.getByRole('heading', { name: 'Análise automática' })).toBeVisible();
  await expect(mod.getByText('Incompatível com a finalidade', { exact: true })).toBeVisible();
  await expect(mod.getByText('CERVEJA LATA 350ML:')).toBeVisible();
  await expect(mod.getByText(/Simulador local de desenvolvimento/)).toBeVisible();
  await expect(mod.getByText('XML sem assinatura digital').first()).toBeVisible();
  await mod.screenshot({ fullPage: true, path: testInfo.outputPath('analise-revisao.png') });

  await mod.getByRole('button', { name: 'Assumir revisão' }).click();
  await expect(mod.getByRole('button', { name: 'Recusar' })).toBeVisible();
  await mod.getByLabel(/Justificativa/).fill('Cerveja não faz parte das cestas básicas.');
  await mod.getByRole('button', { name: 'Recusar' }).click();
  await expect(mod.getByText('Despesa recusada.')).toBeVisible();

  // 3. Organizadora contesta pela tela.
  const org = await orgCtx.newPage();
  await org.goto(`/painel/despesas/${despesaId}`);
  await expect(org.getByText('Cerveja não faz parte das cestas básicas.')).toBeVisible();
  await org.getByLabel('Contestar a recusa (uma vez)').fill('A cerveja foi comprada por engano e devolvida; anexo o comprovante de estorno.');
  await org.getByRole('button', { name: 'Enviar contestação' }).click();
  await expect(org.getByText('Contestação enviada')).toBeVisible();
  await expect(org.getByText('Aguardando revisão').first()).toBeVisible();
  await org.screenshot({ fullPage: true, path: testInfo.outputPath('contestacao-organizadora.png') });

  // 4. Quem recusou não assume; outra moderadora assume e vê a contestação.
  await mod.goto(`/moderacao/despesas/${despesaId}`);
  await mod.getByRole('button', { name: 'Assumir revisão' }).click();
  await expect(mod.getByText('Quem recusou a despesa não revisa a contestação')).toBeVisible();

  const outra = await outraCtx.newPage();
  await outra.goto('/moderacao/despesas');
  await expect(outra.getByRole('listitem').filter({ hasText: descricao }).getByText('Contestação')).toBeVisible();
  await outra.goto(`/moderacao/despesas/${despesaId}`);
  await expect(outra.getByText('Contestação do organizador')).toBeVisible();
  await outra.getByRole('button', { name: 'Assumir revisão' }).click();
  await expect(outra.getByRole('button', { name: 'Aprovar' })).toBeVisible();

  // 5. Página pública mostra a contestação em andamento, sem a análise.
  const pub = await (await browser.newContext()).newPage();
  await expect
    .poll(
      async () => {
        await pub.goto(`/campanhas/${campanha.slug}`);
        return pub.locator('#despesas').locator('..').innerText();
      },
      { timeout: 60_000, intervals: [1_000, 3_000] },
    )
    .toContain('Recusa contestada');
  const secao = await pub.locator('#despesas').locator('..').innerText();
  expect(secao).not.toContain('Incompatível');
  expect(secao).not.toContain('Risco');
});
