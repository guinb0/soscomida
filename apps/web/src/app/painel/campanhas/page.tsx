'use client';

import { type OwnedCampaign, STATUS_LABELS } from '@soscomida/contracts';
import { formatBrl } from '@soscomida/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { RequireSession } from '@/components/require-session';
import { Alert, Badge, Container, PageTitle, Skeleton, buttonClass } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

export default function MinhasCampanhasPage() {
  return (
    <RequireSession>
      {() => (
        <Container className="py-10">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <PageTitle title="Minhas campanhas" />
            <Link href="/painel/campanhas/nova" className={buttonClass('primary')}>
              Nova campanha
            </Link>
          </div>
          <Lista />
        </Container>
      )}
    </RequireSession>
  );
}

function Lista() {
  const { data, isLoading, error } = useQuery({ queryKey: ['me', 'campaigns'], queryFn: () => api<OwnedCampaign[]>('/me/campaigns') });
  if (isLoading) return <Skeleton className="h-40" />;
  if (error) return <Alert tone="danger">{errorMessage(error)}</Alert>;
  if (!data?.length) {
    return <p className="rounded-2xl border border-dashed border-line-strong p-8 text-center text-ink-600">Você ainda não criou campanhas.</p>;
  }
  return (
    <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
      {data.map((c) => (
        <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <Link href={`/painel/campanhas/${c.id}`} className="font-bold text-ink-900 hover:text-sky-700">
              {c.title}
            </Link>
            <p className="text-sm text-ink-500">
              {formatBrl(c.confirmedCents)} confirmados de {formatBrl(c.goalCents)}
            </p>
          </div>
          <Badge tone={c.status === 'ACTIVE' ? 'success' : c.status === 'DRAFT' ? 'neutral' : 'sun'}>{STATUS_LABELS[c.status]}</Badge>
        </li>
      ))}
    </ul>
  );
}
