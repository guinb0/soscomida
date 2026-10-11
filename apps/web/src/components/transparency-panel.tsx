import { BUDGET_LABELS, type CampaignTransparency } from '@soscomida/contracts';
import { formatBrl } from '@soscomida/shared';
import { Info } from 'lucide-react';
import Link from 'next/link';
import { formatDateTime } from '@/lib/utils';
import { Card } from './ui';

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
      <p className="mb-3 text-sm text-ink-600">É contra este plano que as despesas são comparadas na prestação de contas.</p>
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

      <h3 className="mt-8 mb-3 font-display text-lg font-bold text-ink-900">Prestação de contas</h3>
      <dl className="grid gap-3 sm:grid-cols-3">
        <Numero rotulo="Despesas aprovadas" valor={formatBrl(data.expenses.approvedCents)} explicacao="Conferidas pela revisão da plataforma" />
        <Numero rotulo="Em revisão" valor={formatBrl(data.expenses.inReviewCents)} explicacao="Enviadas e ainda não decididas" />
        <Numero
          rotulo="Com nota autenticada"
          valor={formatBrl(data.expenses.fiscallyAuthenticatedCents)}
          explicacao="Aprovadas cuja nota o fisco confirmou. Sem integração oficial, fica em zero."
        />
      </dl>
      {data.expenses.rejectedCount > 0 && (
        <p className="mt-2 text-sm text-maca-700">{data.expenses.rejectedCount} despesa(s) recusada(s) pela revisão — veja os motivos abaixo.</p>
      )}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="text-left text-ink-500">
              <th className="py-2 font-bold">Categoria</th>
              <th className="py-2 text-right font-bold">Planejado</th>
              <th className="py-2 text-right font-bold">Aprovado</th>
              <th className="py-2 text-right font-bold">Em revisão</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.expenses.byCategory.map((c) => (
              <tr key={c.category}>
                <td className="py-2 font-bold text-ink-800">{BUDGET_LABELS[c.category]}</td>
                <td className="py-2 text-right">{formatBrl(c.plannedCents)}</td>
                <td className={c.approvedCents > c.plannedCents ? 'py-2 text-right font-bold text-maca-700' : 'py-2 text-right'}>{formatBrl(c.approvedCents)}</td>
                <td className="py-2 text-right text-ink-600">{formatBrl(c.inReviewCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
