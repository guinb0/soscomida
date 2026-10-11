'use client';

import { BUDGET_LABELS, type OwnedCampaign, type OwnedExpense } from '@soscomida/contracts';
import { formatBrl } from '@soscomida/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ExpenseSeals, ExpenseStatusBadge } from '@/components/expense-badges';
import { ExpenseForm, toExpenseFormDefaults } from '@/components/expense-form';
import { RequireSession } from '@/components/require-session';
import { Alert, Card, Container, PageTitle, Skeleton } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/utils';

const ABERTA = ['ACTIVE', 'PAUSED', 'ENDED', 'UNDER_INVESTIGATION'];

export default function DespesasDaCampanhaPage() {
  const { id } = useParams<{ id: string }>();
  return <RequireSession>{() => <Despesas campaignId={id} />}</RequireSession>;
}

function Despesas({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const campanha = useQuery({ queryKey: ['me', 'campaign', campaignId], queryFn: () => api<OwnedCampaign>(`/me/campaigns/${campaignId}`) });
  const despesas = useQuery({ queryKey: ['me', 'campaign', campaignId, 'expenses'], queryFn: () => api<OwnedExpense[]>(`/me/campaigns/${campaignId}/expenses`) });

  if (campanha.isLoading || despesas.isLoading) return <Container className="py-10"><Skeleton className="h-96" /></Container>;
  if (campanha.error || despesas.error || !campanha.data) {
    return <Container className="py-10"><Alert tone="danger">{errorMessage(campanha.error ?? despesas.error)}</Alert></Container>;
  }
  const c = campanha.data;
  const lista = despesas.data ?? [];
  const aberta = ABERTA.includes(c.status);

  return (
    <Container className="py-10">
      <Link href={`/painel/campanhas/${c.id}`} className="mb-4 inline-flex items-center gap-1 text-sm font-bold text-sky-700 hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> {c.title}
      </Link>
      <PageTitle title="Prestação de contas" subtitle="Registre cada gasto com a nota fiscal e o comprovante de pagamento. Tudo passa por revisão antes de aparecer como aprovado." />

      <div className="grid gap-8 lg:grid-cols-[1fr_400px]">
        <section className="space-y-3">
          {lista.length === 0 && <p className="rounded-2xl border border-dashed border-line-strong p-6 text-ink-600">Nenhuma despesa registrada ainda.</p>}
          {lista.map((e) => (
            <Link key={e.id} href={`/painel/despesas/${e.id}`} className="block rounded-2xl border border-line bg-surface p-4 hover:border-sky-300">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs text-ink-500">
                    {formatDate(`${e.spentOn}T12:00:00`)} · {BUDGET_LABELS[e.budgetCategory]}
                  </p>
                  <p className="font-bold text-ink-900">{e.description}</p>
                  <p className="text-sm text-ink-600">{e.supplierName}</p>
                </div>
                <div className="text-right">
                  <p className="font-display text-lg font-extrabold">{formatBrl(e.amountCents)}</p>
                  <ExpenseStatusBadge status={e.status} />
                </div>
              </div>
              {e.status !== 'DRAFT' && (
                <div className="mt-2">
                  <ExpenseSeals fiscal={e.fiscalCheck} paymentProof={e.paymentProof} delivery={e.delivery} />
                </div>
              )}
            </Link>
          ))}
        </section>

        <aside>
          <Card className="p-6">
            <h2 className="mb-4 font-display text-xl font-bold">Nova despesa</h2>
            {aberta ? (
              <ExpenseForm
                initial={toExpenseFormDefaults()}
                submitLabel="Criar e anexar documentos"
                onSubmit={async (input) => {
                  const criada = await api<OwnedExpense>(`/me/campaigns/${c.id}/expenses`, { method: 'POST', json: input });
                  router.push(`/painel/despesas/${criada.id}`);
                }}
              />
            ) : (
              <Alert tone="neutral">A prestação de contas abre quando a campanha é publicada.</Alert>
            )}
          </Card>
        </aside>
      </div>
    </Container>
  );
}
