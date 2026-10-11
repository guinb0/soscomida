'use client';

import { BUDGET_LABELS, type OwnedExpense } from '@soscomida/contracts';
import { formatBrl } from '@soscomida/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ExpenseFlags, ExpenseSeals, ExpenseStatusBadge } from '@/components/expense-badges';
import { ExpenseDocuments } from '@/components/expense-documents';
import { ExpenseForm, toExpenseFormDefaults } from '@/components/expense-form';
import { RequireSession } from '@/components/require-session';
import { Alert, Button, Card, Container, PageTitle, Skeleton } from '@/components/ui';
import { ApiClientError, api, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/utils';

export default function DespesaPage() {
  const { id } = useParams<{ id: string }>();
  return <RequireSession>{() => <Despesa id={id} />}</RequireSession>;
}

function Despesa({ id }: { id: string }) {
  const client = useQueryClient();
  const chave = ['me', 'expense', id];
  const { data: e, isLoading, error } = useQuery({ queryKey: chave, queryFn: () => api<OwnedExpense>(`/me/expenses/${id}`) });
  const [erro, setErro] = useState<string | null>(null);
  const [agindo, setAgindo] = useState(false);

  if (isLoading) return <Container className="py-10"><Skeleton className="h-96" /></Container>;
  if (error || !e) return <Container className="py-10"><Alert tone="danger">{errorMessage(error)}</Alert></Container>;

  const atualizar = (nova: OwnedExpense) => {
    client.setQueryData(chave, nova);
    void client.invalidateQueries({ queryKey: ['me', 'campaign', nova.campaignId, 'expenses'] });
  };

  const agir = async (acao: 'submit' | 'withdraw' | 'cancel') => {
    setErro(null);
    setAgindo(true);
    try {
      atualizar(await api<OwnedExpense>(`/me/expenses/${e.id}/actions/${acao}`, { method: 'POST', json: { version: e.version } }));
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'VERSION_CONFLICT') await client.invalidateQueries({ queryKey: chave });
      setErro(errorMessage(err));
    } finally {
      setAgindo(false);
    }
  };

  return (
    <Container className="py-10">
      <Link href={`/painel/campanhas/${e.campaignId}/despesas`} className="mb-4 inline-flex items-center gap-1 text-sm font-bold text-sky-700 hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> Prestação de contas
      </Link>
      <div className="mb-2 flex items-center gap-3">
        <ExpenseStatusBadge status={e.status} />
        <span className="text-sm text-ink-500">
          {formatDate(`${e.spentOn}T12:00:00`)} · {BUDGET_LABELS[e.budgetCategory]}
        </span>
      </div>
      <PageTitle title={e.description} subtitle={`${e.supplierName} · ${formatBrl(e.amountCents)}`} />

      {e.decisionReason && (
        <Alert tone={e.status === 'APPROVED' ? 'success' : e.status === 'REJECTED' ? 'danger' : 'sun'} title="Mensagem da revisão" className="mb-6">
          {e.decisionReason}
        </Alert>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
        <div className="space-y-8">
          <Card className="p-6">
            <h2 className="mb-4 font-display text-xl font-bold">Documentos</h2>
            <ExpenseDocuments expense={e} onChange={atualizar} />
          </Card>
          {e.status === 'DRAFT' && (
            <Card className="p-6">
              <h2 className="mb-4 font-display text-xl font-bold">Dados da despesa</h2>
              <ExpenseForm
                key={e.version}
                initial={toExpenseFormDefaults({ ...e, supplierDocument: e.supplierDocument })}
                submitLabel="Salvar alterações"
                onSubmit={async (input) => atualizar(await api<OwnedExpense>(`/me/expenses/${e.id}`, { method: 'PATCH', json: { ...input, version: e.version } }))}
              />
            </Card>
          )}
        </div>

        <aside className="space-y-4">
          {e.status !== 'DRAFT' && (
            <Card className="space-y-3 p-5">
              <h2 className="font-display text-lg font-bold">Verificações</h2>
              <ExpenseSeals fiscal={e.fiscalCheck} paymentProof={e.paymentProof} delivery={e.delivery} />
            </Card>
          )}
          <ExpenseFlags flags={e.flags} />
          <Card className="space-y-3 p-5">
            <h2 className="font-display text-lg font-bold">Ações</h2>
            {e.status === 'DRAFT' && (
              <>
                <Button className="w-full" loading={agindo} onClick={() => void agir('submit')}>
                  Enviar para revisão
                </Button>
                <p className="text-xs text-ink-500">Depois de enviada, a despesa aparece na página pública como “aguardando revisão”.</p>
                <Button variant="danger" className="w-full" loading={agindo} onClick={() => void agir('cancel')}>
                  Cancelar despesa
                </Button>
              </>
            )}
            {e.status === 'SUBMITTED' && (
              <Button variant="secondary" className="w-full" loading={agindo} onClick={() => void agir('withdraw')}>
                Retirar da revisão
              </Button>
            )}
            {['IN_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(e.status) && <p className="text-sm text-ink-600">Nenhuma ação disponível neste status.</p>}
            {erro && <Alert tone="danger">{erro}</Alert>}
          </Card>
        </aside>
      </div>
    </Container>
  );
}
