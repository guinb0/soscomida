'use client';

import { EXPENSE_FLAG_LABELS, type ExpenseQueueItem } from '@soscomida/contracts';
import { formatBrl } from '@soscomida/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { RiskBadge } from '@/components/expense-analysis';
import { ExpenseStatusBadge } from '@/components/expense-badges';
import { RequireSession } from '@/components/require-session';
import { Alert, Badge, Container, PageTitle, Skeleton } from '@/components/ui';
import { api, errorMessage, needsMfa } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';

export default function FilaDespesasPage() {
  return <RequireSession staff>{() => <Fila />}</RequireSession>;
}

function Fila() {
  const router = useRouter();
  const { data, isLoading, error } = useQuery({ queryKey: ['moderation', 'expenses'], queryFn: () => api<ExpenseQueueItem[]>('/moderation/expenses') });

  useEffect(() => {
    if (needsMfa(error)) router.replace('/seguranca?next=/moderacao/despesas');
  }, [error, router]);

  return (
    <Container className="py-10">
      <PageTitle title="Moderação" subtitle="Despesas enviadas para revisão, das de maior risco para as de menor; empate, a mais antiga primeiro." />
      <nav className="mb-6 flex flex-wrap gap-2" aria-label="Filas">
        <Link href="/moderacao" className="rounded-full border border-line-strong px-3 py-1 text-sm font-bold text-ink-700 hover:bg-paper-2">
          Campanhas
        </Link>
        <span className="rounded-full bg-sky-100 px-3 py-1 text-sm font-bold text-sky-800">Despesas</span>
        <Link href="/moderacao/risco" className="rounded-full border border-line-strong px-3 py-1 text-sm font-bold text-ink-700 hover:bg-paper-2">
          Política de risco
        </Link>
      </nav>
      {isLoading && <Skeleton className="h-40" />}
      {error && !needsMfa(error) && <Alert tone="danger">{errorMessage(error)}</Alert>}
      {data && data.length === 0 && <p className="rounded-2xl border border-dashed border-line-strong p-8 text-center text-ink-600">Nenhuma despesa aguardando revisão.</p>}
      {data && data.length > 0 && (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {data.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div>
                <Link href={`/moderacao/despesas/${d.id}`} className="font-bold text-ink-900 hover:text-sky-700">
                  {d.description}
                </Link>
                <p className="text-sm text-ink-500">
                  {d.campaignTitle} · {formatBrl(d.amountCents)}
                  {d.submittedAt && <> · enviada {formatDateTime(d.submittedAt)}</>}
                </p>
                {d.flags.length > 0 && (
                  <p className="mt-1 text-xs text-sun-800">
                    {d.flags.length} alerta(s): {d.flags.slice(0, 2).map((f) => EXPENSE_FLAG_LABELS[f]).join('; ')}
                    {d.flags.length > 2 && '…'}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {d.appealed && <Badge tone="sky">Contestação</Badge>}
                <RiskBadge level={d.riskLevel} score={d.riskScore} />
                <ExpenseStatusBadge status={d.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
