import { describe, expect, it } from 'vitest';
import { campaignStatusEmail, donationConfirmedEmail } from './templates';

describe('templates de e-mail', () => {
  it('doação confirmada traz valor formatado e link', () => {
    const e = donationConfirmedEmail({ name: 'Maria', amountCents: 5_000, campaignTitle: 'Cestas', campaignUrl: 'https://x.test/campanhas/cestas' });
    expect(e.subject).toContain('Cestas');
    expect(e.text).toContain('R$');
    expect(e.text).toContain('50,00');
    expect(e.text).toContain('https://x.test/campanhas/cestas');
  });

  it('escapa HTML vindo de usuários (título, nome, justificativa)', () => {
    const e = campaignStatusEmail({
      name: '<b>Ana</b>',
      action: 'request_changes',
      campaignTitle: 'Título <script>alert(1)</script>',
      reason: 'Falta "orçamento" & <img src=x onerror=alert(1)>',
      panelUrl: 'https://x.test/painel',
    });
    expect(e.html).not.toContain('<script>');
    expect(e.html).not.toContain('<img');
    expect(e.html).not.toContain('<b>Ana');
    expect(e.html).toContain('&lt;script&gt;');
    expect(e.text).toContain('Justificativa registrada');
  });

  it('omite a justificativa quando não há', () => {
    const e = campaignStatusEmail({ name: 'Ana', action: 'expire', campaignTitle: 'C', reason: null, panelUrl: 'https://x.test' });
    expect(e.text).not.toContain('Justificativa');
  });
});
