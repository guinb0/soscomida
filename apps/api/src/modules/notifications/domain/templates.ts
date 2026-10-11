import { formatBrl } from '@soscomida/shared';

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const escapeHtml = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Monta texto e HTML a partir dos mesmos parágrafos; todo conteúdo dinâmico é escapado. */
function compose(subject: string, saudacao: string, paragrafos: string[], link?: { label: string; url: string }): RenderedEmail {
  const rodape = 'Você recebeu este e-mail porque tem uma conta no SOS Comida. Não responda: esta caixa não é lida.';
  const text = [saudacao, '', ...paragrafos.flatMap((p) => [p, '']), ...(link ? [`${link.label}: ${link.url}`, ''] : []), '—', rodape].join('\n');
  const html = [
    '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1f2933;max-width:560px">',
    `<p>${escapeHtml(saudacao)}</p>`,
    ...paragrafos.map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`),
    link ? `<p><a href="${escapeHtml(link.url)}" style="color:#0b7fab;font-weight:bold">${escapeHtml(link.label)}</a></p>` : '',
    `<p style="color:#6b7280;font-size:12px">${escapeHtml(rodape)}</p>`,
    '</div>',
  ].join('');
  return { subject, text, html };
}

export function donationConfirmedEmail(input: { name: string; amountCents: number; campaignTitle: string; campaignUrl: string }): RenderedEmail {
  return compose(
    `Sua doação para "${input.campaignTitle}" foi confirmada`,
    `Olá, ${input.name}!`,
    [
      `O provedor de pagamento confirmou sua doação de ${formatBrl(input.amountCents)} para a campanha "${input.campaignTitle}". O valor já aparece no total arrecadado.`,
      'Acompanhe pela página da campanha o que for gasto e os comprovantes enviados pela organização.',
    ],
    { label: 'Ver a campanha', url: input.campaignUrl },
  );
}

/** Mudanças de status que a pessoa organizadora precisa saber sem abrir o painel. */
export const NOTIFIED_CAMPAIGN_ACTIONS = [
  'approve',
  'request_changes',
  'reject',
  'investigate',
  'clear_investigation',
  'cancel_by_moderation',
  'expire',
] as const;
export type NotifiedCampaignAction = (typeof NOTIFIED_CAMPAIGN_ACTIONS)[number];

export const isNotifiedCampaignAction = (a: string): a is NotifiedCampaignAction => (NOTIFIED_CAMPAIGN_ACTIONS as readonly string[]).includes(a);

const STATUS_MESSAGES: Record<NotifiedCampaignAction, { assunto: string; texto: string }> = {
  approve: {
    assunto: 'Campanha aprovada',
    texto: 'Sua campanha foi aprovada pela moderação. Ela ainda não está no ar: publique pelo painel quando quiser começar a receber doações.',
  },
  request_changes: {
    assunto: 'Ajustes pedidos na campanha',
    texto: 'A moderação pediu ajustes antes de aprovar. A campanha voltou para rascunho: corrija e envie de novo para análise.',
  },
  reject: { assunto: 'Campanha não aprovada', texto: 'A moderação não aprovou a campanha.' },
  investigate: {
    assunto: 'Campanha em investigação',
    texto: 'A campanha está sob investigação e não recebe doações até a conclusão. Responda aos pedidos da moderação pelo painel.',
  },
  clear_investigation: { assunto: 'Investigação encerrada', texto: 'A investigação terminou sem irregularidades e a campanha voltou ao status anterior.' },
  cancel_by_moderation: { assunto: 'Campanha cancelada', texto: 'Ao fim da investigação, a moderação cancelou a campanha.' },
  expire: {
    assunto: 'Campanha encerrada pelo prazo',
    texto: 'O prazo da campanha terminou e ela não recebe mais doações. Lembre-se de prestar contas dos gastos.',
  },
};

export function campaignStatusEmail(input: {
  name: string;
  action: NotifiedCampaignAction;
  campaignTitle: string;
  reason: string | null;
  panelUrl: string;
}): RenderedEmail {
  const m = STATUS_MESSAGES[input.action];
  const paragrafos = [`Campanha: "${input.campaignTitle}".`, m.texto];
  if (input.reason) paragrafos.push(`Justificativa registrada:\n${input.reason}`);
  return compose(`${m.assunto}: ${input.campaignTitle}`, `Olá, ${input.name}!`, paragrafos, { label: 'Abrir no painel', url: input.panelUrl });
}

const EXPENSE_MESSAGES = {
  approve: { assunto: 'Despesa aprovada', texto: 'A revisão aprovou a despesa. Ela já aparece como aprovada na prestação de contas pública.' },
  request_changes: { assunto: 'Ajustes pedidos na despesa', texto: 'A revisão pediu ajustes. A despesa voltou para rascunho: corrija e envie de novo.' },
  reject: { assunto: 'Despesa recusada', texto: 'A revisão recusou a despesa. Ela aparece como recusada na prestação de contas pública.' },
} as const;

export type NotifiedExpenseAction = keyof typeof EXPENSE_MESSAGES;
export const isNotifiedExpenseAction = (a: string): a is NotifiedExpenseAction => a in EXPENSE_MESSAGES;

export function expenseDecisionEmail(input: {
  name: string;
  action: NotifiedExpenseAction;
  expenseDescription: string;
  campaignTitle: string;
  reason: string | null;
  url: string;
}): RenderedEmail {
  const m = EXPENSE_MESSAGES[input.action];
  const paragrafos = [`Despesa: "${input.expenseDescription}" — campanha "${input.campaignTitle}".`, m.texto];
  if (input.reason) paragrafos.push(`Justificativa registrada:
${input.reason}`);
  return compose(`${m.assunto}: ${input.expenseDescription}`, `Olá, ${input.name}!`, paragrafos, { label: 'Abrir a despesa', url: input.url });
}
