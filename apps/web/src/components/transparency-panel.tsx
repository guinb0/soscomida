import { type BudgetCategory, type CampaignTransparency } from '@soscomida/contracts';
import { formatBrl } from '@soscomida/shared';
import { Info } from 'lucide-react';
import Link from 'next/link';
import { formatDateTime } from '@/lib/utils';
import { Card } from './ui';

const BUDGET_LABELS: Record<BudgetCategory, string> = {
  ALIMENTOS: 'Alimentos',
  MEDICAMENTOS: 'Medicamentos',
  SERVICOS_SAUDE: 'Serviços de saúde',
  VETERINARIO: 'Veterinário',
  TRANSPORTE: 'Transporte',
  EMBALAGENS: 'Embalagens',
  MATERIAIS: 'Materiais',
  SERVICOS: 'Serviços',
  MORADIA: 'Moradia',
  EDUCACAO: 'Educação',
  OUTROS: 'Outros',
};

function Numero({ rotulo, valor, explicacao }: { rotulo: string; valor: string; explicacao: string }) {
  return (
    <div className="rounded-xl bg-paper-2 p-4">
      <dt className="text-sm font-bold text-ink-600">{rotulo}</dt>
      <dd className="mt-1 font-display text-2xl font-extrabold text-ink-900">{valor}</dd>
      <dd className="mt-1 text-xs text-ink-500">{explicacao}</dd>
    </div>
  );
}

/**
 * Cada indicador tem significado próprio (docs/ARCHITECTURE.md). Nenhum
 * "índice de transparência" agrega tudo num número só.
 */
export function TransparencyPanel({ data }: { data: CampaignTransparency }) {
  const totalPlanejado = data.budget.reduce((t, b) => t + b.plannedCents, 0);
  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="font-display text-2xl font-extrabold text-ink-900">Transparência</h2>
        <Link href="/transparencia" className="inline-flex items-center gap-1 text-sm font-bold text-sky-700 hover:underline">
          <Info className="size-4" aria-hidden /> O que cada número significa
        </Link>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2">
        <Numero rotulo="Arrecadação confirmada" valor={formatBrl(data.confirmedCents)} explicacao={`${data.donationsCount} doações confirmadas pelo provedor de pagamento`} />
        <Numero rotulo="Tarifas do pagamento" valor={formatBrl(data.feesCents)} explicacao="Cobradas pelo provedor Pix sobre as doações" />
        <Numero rotulo="Estornos" valor={formatBrl(data.refundsCents)} explicacao="Doações devolvidas a quem doou" />
        <Numero rotulo="Líquido estimado" valor={formatBrl(data.netEstimateCents)} explicacao="Estimativa até a conciliação com o extrato do provedor" />
      </dl>

      <h3 className="mt-8 mb-3 font-display text-lg font-bold text-ink-900">Orçamento planejado</h3>
      <p className="mb-3 text-sm text-ink-600">É contra este plano que as despesas serão comparadas na prestação de contas.</p>
      <ul className="divide-y divide-line rounded-xl border border-line">
        {data.budget.map((item, i) => (
          <li key={i} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
            <span>
              <span className="font-bold text-ink-800">{BUDGET_LABELS[item.category]}</span>
              <span className="block text-ink-500">{item.description}</span>
            </span>
            <span className="whitespace-nowrap font-bold text-ink-900">{formatBrl(item.plannedCents)}</span>
          </li>
        ))}
        <li className="flex justify-between bg-paper-2 px-4 py-3 text-sm font-extrabold text-ink-900">
          <span>Total</span>
          <span>{formatBrl(totalPlanejado)}</span>
        </li>
      </ul>

      <div className="mt-8 rounded-xl border border-dashed border-line-strong p-4 text-sm text-ink-600">
        <p className="font-bold text-ink-800">Prestação de contas</p>
        <p className="mt-1">
          O envio de despesas com notas fiscais e a verificação dos documentos chegam na próxima etapa da plataforma. Até lá, esta campanha mostra
          apenas o que foi arrecadado e o orçamento planejado — nenhum gasto aparece como comprovado.
        </p>
      </div>

      {data.recentSupporters.length > 0 && (
        <>
          <h3 className="mt-8 mb-3 font-display text-lg font-bold text-ink-900">Apoios recentes</h3>
          <ul className="space-y-2 text-sm">
            {data.recentSupporters.map((s, i) => (
              <li key={i} className="flex justify-between gap-4">
                <span className="text-ink-700">{s.displayName}</span>
                <span className="text-ink-500">
                  {formatBrl(s.amountCents)} · {formatDateTime(s.confirmedAt)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
