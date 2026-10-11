'use client';

import { type ModerationQueueItem, STATUS_LABELS } from '@soscomida/contracts';
import { formatBrl } from '@soscomida/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { RequireSession } from '@/components/require-session';
import { Alert, Badge, Container, PageTitle, Skeleton } from '@/components/ui';
import { api, errorMessage, needsMfa } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';

export default function ModeracaoPage() {
  return <RequireSession staff>{() => <Fila />}</RequireSession>;
}

function Fila() {
  const router = useRouter();
  const { data, isLoading, error } = useQuery({ queryKey: ['moderation', 'queue'], queryFn: () => api<ModerationQueueItem[]>('/moderation/queue') });

  useEffect(() => {
    if (needsMfa(error)) router.replace('/seguranca?next=/moderacao');
  }, [error, router]);

  return (
    <Container className="py-10">
      <PageTitle title="Moderação" subtitle="Campanhas aguardando análise, das mais antigas para as mais recentes." />
      {isLoading && <Skeleton className="h-40" />}
      {error && !needsMfa(error) && <Alert tone="danger">{errorMessage(error)}</Alert>}
      {data && data.length === 0 && <p className="rounded-2xl border border-dashed border-line-strong p-8 text-center text-ink-600">Nenhuma campanha aguardando análise.</p>}
      {data && data.length > 0 && (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {data.map((item) => (
            <li key={item.campaignId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div>
                <Link href={`/moderacao/campanhas/${item.campaignId}`} className="font-bold text-ink-900 hover:text-sky-700">
                  {item.campaignTitle}
                </Link>
                <p className="text-sm text-ink-500">
                  {item.organizerName} · meta {formatBrl(item.goalCents)} · desde {formatDateTime(item.openedAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {item.assignedTo && <span className="text-sm text-ink-600">com {item.assignedTo.name}</span>}
                <Badge tone={item.campaignStatus === 'IN_REVIEW' ? 'sky' : 'sun'}>{STATUS_LABELS[item.campaignStatus]}</Badge>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
