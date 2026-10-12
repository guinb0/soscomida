import { expect, test } from '@playwright/test';
import { moderadoraViaApi } from '../helpers';

test('administração publica nova versão da política de risco pela tela; moderação só consulta', async ({ browser }, testInfo) => {
  const adminCtx = await browser.newContext();
  const modCtx = await browser.newContext();
  await moderadoraViaApi(adminCtx, 'admin');
  await moderadoraViaApi(modCtx);

  const mod = await modCtx.newPage();
  await mod.goto('/moderacao/risco');
  await expect(mod.getByText('Só a administração pode publicar uma nova versão.')).toBeVisible();
  await expect(mod.getByLabel('Sem comprovante de pagamento')).toBeDisabled();

  const admin = await adminCtx.newPage();
  await admin.goto('/moderacao/risco');
  const campo = admin.getByLabel('Sem comprovante de pagamento');
  const original = await campo.inputValue();
  await campo.fill(String(Number(original) + 5));
  await admin.getByLabel(/Motivo da mudança/).fill('Teste e2e: mais peso para falta de comprovante.');
  await admin.getByRole('button', { name: 'Publicar nova versão' }).click();
  await expect(admin.getByText(/Versão politica-\d+ publicada/)).toBeVisible();
  await expect(admin.getByLabel('Sem comprovante de pagamento')).toHaveValue(String(Number(original) + 5));
  await admin.screenshot({ fullPage: true, path: testInfo.outputPath('politica-risco.png') });

  // Devolve o valor anterior (outra versão; o histórico guarda as duas).
  await admin.getByLabel('Sem comprovante de pagamento').fill(original);
  await admin.getByLabel(/Motivo da mudança/).fill('Teste e2e: volta ao valor anterior.');
  await admin.getByRole('button', { name: 'Publicar nova versão' }).click();
  await expect(admin.getByText('Teste e2e: volta ao valor anterior.').first()).toBeVisible();
  await expect(admin.getByLabel('Sem comprovante de pagamento')).toHaveValue(original);
});
