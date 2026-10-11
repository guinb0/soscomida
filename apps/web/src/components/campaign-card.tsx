import { CATEGORY_LABELS, type CampaignCard as CampaignCardData } from '@soscomida/contracts';
import { formatBrl, percentOf } from '@soscomida/shared';
import Link from 'next/link';
import { daysLeft } from '@/lib/utils';
import { Badge, ProgressBar } from './ui';

export function CampaignCard({ campaign }: { campaign: CampaignCardData }) {
  const dias = daysLeft(campaign.endsAt);
  return (
    <Link
      href={`/campanhas/${campaign.slug}`}
      className="group flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-soft transition-shadow hover:shadow-lift"
    >
      <div className="aspect-[16/9] bg-gradient-to-br from-sky-100 to-sun-100">
        {campaign.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- capa vem do bucket público (domínio varia por ambiente)
          <img src={campaign.coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="grid h-full place-items-center font-display text-4xl font-extrabold text-sky-300" aria-hidden>
            SOS
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="sky">{CATEGORY_LABELS[campaign.category]}</Badge>
          {campaign.region && <span className="text-xs text-ink-500">{campaign.region}</span>}
        </div>
        <h3 className="font-display text-lg font-bold leading-snug text-ink-900 group-hover:text-sky-700">{campaign.title}</h3>
        <p className="line-clamp-2 text-sm text-ink-600">{campaign.summary}</p>
        <div className="mt-auto space-y-2">
          <ProgressBar value={campaign.confirmedCents} max={campaign.goalCents} label={`Arrecadado de ${campaign.title}`} />
          <div className="flex items-baseline justify-between text-sm">
            <span>
              <strong className="text-ink-900">{formatBrl(campaign.confirmedCents)}</strong>{' '}
              <span className="text-ink-500">de {formatBrl(campaign.goalCents)}</span>
            </span>
            <span className="font-bold text-melancia-700">{percentOf(campaign.confirmedCents, campaign.goalCents)}%</span>
          </div>
          <p className="text-xs text-ink-500">
            {campaign.donationsCount} {campaign.donationsCount === 1 ? 'doação confirmada' : 'doações confirmadas'} ·{' '}
            {dias > 0 ? `${dias} ${dias === 1 ? 'dia restante' : 'dias restantes'}` : 'prazo encerrado'}
          </p>
        </div>
      </div>
    </Link>
  );
}
