'use client';

import { DONATION_STATUS_LABELS, type MyDonation } from '@soscomida/contracts';
import { formatBrl } from '@soscomida/shared';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { RequireSession } from '@/components/require-session';
import { Alert, Badge, Card, Container, PageTitle, Skeleton, buttonClass } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/utils';

const TONS = { PENDING: 'sun', CONFIRMED: 'success', EXPIRED: 'neutral', FAILED: 'danger', REFUNDED: 'neutral' } as const;

function MinhasDoacoes() {
  const { data, isLoading, error } = useQuery({ queryKey: ['me', 'donations'], queryFn: () => api<MyDonation[]>('/me/donations') });
  if (isLoading) return <Skeleton className="h-40" />;
  if (error) return <Alert tone="danger">{errorMessage(error)}</Alert>;
  if (!data?.length) {
    return (
      <p className="rounded-2xl border border-dashed border-line-strong p-8 text-center text-ink-600">
        Você ainda não doou com esta conta.{' '}
        <Link className="font-bold text-sky-700 underline" href="/campanhas">
          Conheça as campanhas
        </Link>
        .
      </p>
    );
  }
  const total = data.filter((d) => d.status === 'CONFIRMED').reduce((t, d) => t + d.amountCents, 0);
  return (
    <>
      <p className="mb-4 text-ink-700">
        Total confirmado: <strong>{formatBrl(total)}</strong>
      </p>
      <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
        {data.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div>
              <Link href={`/campanhas/${d.campaignSlug}`} className="font-bold text-ink-900 hover:text-sky-700">
                {d.campaignTitle}
              </Link>
              <p className="text-sm text-ink-500">{formatDate(d.createdAt)}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-bold">{formatBrl(d.amountCents)}</span>
              <Badge tone={TONS[d.status]}>{DONATION_STATUS_LABELS[d.status]}</Badge>
              {d.status === 'PENDING' && (
                <Link href={`/doacao/${d.id}`} className="text-sm font-bold text-sky-700 underline">
                  Ver Pix
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function PainelPage() {
  return (
    <RequireSession>
      {(me) => (
        <Container className="py-10">
          <PageTitle title={`Olá, ${me.name.split(' ')[0]}`} subtitle="Acompanhe suas doações e campanhas." />
          <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
            <section>
              <h2 className="mb-4 font-display text-2xl font-extrabold text-ink-900">Minhas doações</h2>
              <MinhasDoacoes />
            </section>
            <aside className="space-y-4">
              <Card className="p-5">
                <h2 className="font-display text-lg font-bold text-ink-900">Minhas campanhas</h2>
                <p className="mt-1 text-sm text-ink-600">Crie uma campanha e acompanhe a análise, a arrecadação e a prestação de contas.</p>
                <div className="mt-4 flex flex-col gap-2">
                  <Link href="/painel/campanhas" className={buttonClass('secondary', 'sm')}>
                    Ver minhas campanhas
                  </Link>
                  <Link href="/painel/campanhas/nova" className={buttonClass('primary', 'sm')}>
                    Criar campanha
                  </Link>
                </div>
              </Card>
              <Card className="p-5">
                <h2 className="flex items-center gap-2 font-display text-lg font-bold text-ink-900">
                  <ShieldCheck className="size-5 text-melancia-600" aria-hidden /> Segurança
                </h2>
                <p className="mt-1 text-sm text-ink-600">
                  {me.mfaEnabled ? 'Verificação em duas etapas ativa.' : 'Ative a verificação em duas etapas para proteger sua conta.'}
                </p>
                <Link href="/seguranca" className={buttonClass('ghost', 'sm', 'mt-3 px-0')}>
                  Configurar
                </Link>
              </Card>
            </aside>
          </div>
        </Container>
      )}
    </RequireSession>
  );
}
