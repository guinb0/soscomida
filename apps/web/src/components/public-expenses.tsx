import { BUDGET_LABELS, type PublicExpense } from '@soscomida/contracts';
import { formatBrl } from '@soscomida/shared';
import { formatDate } from '@/lib/utils';
import { ExpenseSeals, ExpenseStatusBadge } from './expense-badges';

const MODELO = { NFE_55: 'NF-e', NFCE_65: 'NFC-e' } as const;

/**
 * Despesas enviadas para revisão, com os selos independentes. Os arquivos
 * originais não são públicos (podem ter dados pessoais); aparecem os dados
 * lidos da nota, sem a chave de acesso e sem CPF.
 */
export function PublicExpenses({ expenses }: { expenses: PublicExpense[] }) {
  if (expenses.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-line-strong p-6 text-sm text-ink-600">
        Nenhuma despesa enviada até agora. Quando a organização registrar gastos, eles aparecem aqui com as notas e o resultado da revisão.
      </p>
    );
  }
  return (
    <ol className="space-y-4">
      {expenses.map((e) => (
        <li key={e.id} className="rounded-2xl border border-line bg-surface p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs text-ink-500">
                {formatDate(`${e.spentOn}T12:00:00`)} · {BUDGET_LABELS[e.budgetCategory]}
              </p>
              <h3 className="font-bold text-ink-900">{e.description}</h3>
              <p className="text-sm text-ink-600">
                {e.supplierName}
                {e.supplierDocument && <> · {e.supplierDocument}</>}
              </p>
            </div>
            <div className="text-right">
              <p className="font-display text-xl font-extrabold text-ink-900">{formatBrl(e.amountCents)}</p>
              <ExpenseStatusBadge status={e.status} />
            </div>
          </div>
          <div className="mt-3">
            <ExpenseSeals fiscal={e.fiscalCheck} paymentProof={e.paymentProof} delivery={e.delivery} />
          </div>
          {e.decisionReason && <p className="mt-3 text-sm text-ink-700">Revisão: {e.decisionReason}</p>}
          {e.fiscalDocuments.map((f, i) => (
            <details key={i} className="mt-3 rounded-xl bg-paper-2 p-3 text-sm">
              <summary className="cursor-pointer font-bold text-ink-800">
                {MODELO[f.model]} nº {f.number} série {f.series} · {f.issuerName ?? 'emitente'} ({f.issuerDocument})
                {f.effectiveTotalCents !== null && <> · {formatBrl(f.effectiveTotalCents)}</>}
                {f.totalSource === 'DECLARED' && ' (total informado pela organização)'}
              </summary>
              {f.items.length > 0 ? (
                <ul className="mt-2 divide-y divide-line">
                  {f.items.map((it, j) => (
                    <li key={j} className="flex justify-between gap-4 py-1.5">
                      <span>
                        {it.description}
                        {it.quantity && <span className="text-ink-500"> · {Number(it.quantity).toLocaleString('pt-BR')} {it.unit ?? ''}</span>}
                      </span>
                      <span className="whitespace-nowrap">{formatBrl(it.totalCents)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-ink-600">Os itens não foram lidos automaticamente (documento sem XML).</p>
              )}
            </details>
          ))}
        </li>
      ))}
    </ol>
  );
}
