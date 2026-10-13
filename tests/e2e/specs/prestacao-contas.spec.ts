import { expect, test } from '@playwright/test';
import { BASE, MAILPIT, SENHA, apiDo, campanhaAtivaViaApi, moderadoraViaApi, nfceXml, sufixo } from '../helpers';

test('organizadora presta contas com XML e comprovante; revisão aprova; público vê a despesa com os selos', async ({ browser }, testInfo) => {
  const orgCtx = await browser.newContext();
  const modCtx = await browser.newContext();
  const emailOrg = `e2e-${sufixo()}@exemplo.com`;
  await apiDo(orgCtx).post('/auth/register', { name: 'Organizadora Contas', email: emailOrg, password: SENHA });
  await moderadoraViaApi(modCtx);
  const campanha = await campanhaAtivaViaApi(orgCtx, modCtx, `Prestação E2E ${sufixo()}`);

  const { xml, chave } = nfceXml([
    { descricao: 'ARROZ TIPO 1 5KG', centavos: 2_590 },
    { descricao: 'FEIJAO CARIOCA 1KG', centavos: 899 },
  ]);
  // "Consulta ao fisco" simulada (provedor de desenvolvimento).
  await apiDo(orgCtx).post(`/dev/fiscal/${chave}/simulate`, { status: 'AUTHORIZED' });

  // 1. Organizadora registra a despesa pela tela.
  const org = await orgCtx.newPage();
  await org.goto(`/painel/campanhas/${campanha.id}/despesas`);
  await org.getByLabel('O que foi comprado ou contratado').fill('Arroz e feijão para as cestas');
  await org.getByLabel('Valor (R$)').fill('34,89');
  await org.getByLabel('Fornecedor', { exact: true }).fill('Supermercado Exemplo');
  await org.getByLabel('CNPJ ou CPF do fornecedor (opcional)').fill('11.222.333/0001-81');
  await org.getByRole('button', { name: 'Criar e anexar documentos' }).click();
  await org.waitForURL(/\/painel\/despesas\/[0-9a-f-]{36}$/);

  // 2. Anexa o XML da nota: a leitura mostra itens e total.
  await org.getByLabel('Tipo de documento').selectOption('FISCAL');
  await org.getByLabel('Arquivo do documento').setInputFiles({ name: 'nota.xml', mimeType: 'text/xml', buffer: Buffer.from(xml) });
  await expect(org.getByText('2 itens lidos da nota')).toBeVisible();
  await expect(org.getByText('Lida de: XML')).toBeVisible();

  // 3. Comprovante de pagamento (PDF) e envio para revisão.
  await org.getByLabel('Tipo de documento').selectOption('PAYMENT_PROOF');
  await org.getByLabel('Arquivo do documento').setInputFiles({ name: 'pix.pdf', mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n% ${sufixo()}\n%%EOF\n`) });
  await expect(org.getByText('Comprovante de pagamento').first()).toBeVisible();
  await org.getByRole('button', { name: 'Enviar para revisão' }).click();
  await expect(org.getByText('Aguardando revisão').first()).toBeVisible();
  await org.screenshot({ fullPage: true, path: testInfo.outputPath('despesa-organizadora.png') });

  // 4. Moderadora revisa pela tela.
  const mod = await modCtx.newPage();
  await mod.goto('/moderacao/despesas');
  await mod.getByRole('link', { name: 'Arroz e feijão para as cestas' }).first().click();
  await mod.getByRole('button', { name: 'Assumir revisão' }).click();
  // A consulta ao fisco roda no worker (outbox); a tela não se atualiza sozinha.
  await expect(async () => {
    await mod.reload();
    await expect(mod.getByText('Nota autenticada no fisco').first()).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 45_000 });
  await mod.getByLabel('Comprovante de pagamento').selectOption('ACCEPTED');
  await mod.getByLabel(/Justificativa/).fill('Nota autenticada, itens compatíveis com as cestas e pagamento conferido.');
  await mod.screenshot({ fullPage: true, path: testInfo.outputPath('revisao-moderadora.png') });
  await mod.getByRole('button', { name: 'Aprovar' }).click();
  await expect(mod.getByText('Despesa aprovada.')).toBeVisible();

  // 5. Página pública: despesa aprovada com os selos; sem chave de acesso nem CPF.
  const pub = await (await browser.newContext()).newPage();
  await expect
    .poll(
      async () => {
        await pub.goto(`${BASE}/campanhas/${campanha.slug}`);
        return pub.locator('#despesas').locator('..').innerText();
      },
      { timeout: 60_000, intervals: [1_000, 3_000] },
    )
    .toContain('Aprovada');
  const secao = await pub.locator('#despesas').locator('..').innerText();
  expect(secao).toContain('Arroz e feijão para as cestas');
  expect(secao).toContain('Nota autenticada no fisco');
  expect(secao).toContain('Pagamento conferido');
  expect(secao).toContain('11.222.333/0001-81');
  expect(await pub.locator('main').innerText()).not.toContain(chave);
  await expect(pub.getByText('Despesas aprovadas')).toBeVisible();
  await pub.screenshot({ fullPage: true, path: testInfo.outputPath('pagina-publica.png') });

  // 6. Aviso por e-mail da decisão (Mailpit).
  await expect
    .poll(async () => {
      const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${emailOrg}"`)}`).catch(() => null);
      if (!r?.ok) return [];
      return ((await r.json()) as { messages: { Subject: string }[] }).messages.map((m) => m.Subject);
    }, { timeout: 30_000 })
    .toContainEqual(expect.stringContaining('Despesa aprovada'));
});
