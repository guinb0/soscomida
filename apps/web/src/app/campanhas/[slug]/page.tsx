import { CATEGORY_LABELS, type CampaignDetail, type CampaignTransparency, type PublicExpense, STATUS_LABELS } from '@soscomida/contracts';
import { formatBrl, percentOf } from '@soscomida/shared';
import type { Metadata } from 'next';
import { DonateForm } from '@/components/donate-form';
import { PublicExpenses } from '@/components/public-expenses';
import { TransparencyPanel } from '@/components/transparency-panel';
import { Alert, Badge, Card, Container, ProgressBar } from '@/components/ui';
import { cacheTags, publicApi } from '@/lib/server-api';
import { daysLeft, formatDate } from '@/lib/utils';

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const campanha = await publicApi<CampaignDetail>(`/campaigns/${encodeURIComponent(slug)}`, { tags: [cacheTags.campaign(slug)] });
  return { title: campanha.title, description: campanha.summary, openGraph: { images: campanha.coverUrl ? [campanha.coverUrl] : [] } };
}

export default async function CampanhaPage({ params }: { params: Params }) {
  const { slug } = await params;
  const [campanha, transparencia, atualizacoes, despesas] = await Promise.all([
    publicApi<CampaignDetail>(`/campaigns/${encodeURIComponent(slug)}`, { tags: [cacheTags.campaign(slug)] }),
    publicApi<CampaignTransparency>(`/campaigns/${encodeURIComponent(slug)}/transparency`, { tags: [cacheTags.campaign(slug)] }),
    publicApi<{ id: string; title: string; body: string; createdAt: string }[]>(`/campaigns/${encodeURIComponent(slug)}/updates`, { tags: [cacheTags.campaign(slug)] }),
    publicApi<PublicExpense[]>(`/campaigns/${encodeURIComponent(slug)}/expenses`, { tags: [cacheTags.campaign(slug)] }),
  ]);
  const dias = daysLeft(campanha.endsAt);

  return (
    <Container className="py-10">
      {campanha.status === 'UNDER_INVESTIGATION' && (
        <Alert tone="sun" title="Campanha sob investigação" className="mb-6">
          A moderação está analisando esta campanha. Novas doações estão suspensas até a conclusão.
        </Alert>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
        <article className="space-y-8">
          <header>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge tone="sky">{CATEGORY_LABELS[campanha.category]}</Badge>
              {campanha.status !== 'ACTIVE' && <Badge tone="sun">{STATUS_LABELS[campanha.status]}</Badge>}
              {campanha.region && <span className="text-sm text-ink-500">{campanha.region}</span>}
            </div>
            <h1 className="font-display text-3xl font-extrabold leading-tight text-ink-900 sm:text-4xl">{campanha.title}</h1>
            <p className="mt-2 text-lg text-ink-600">{campanha.summary}</p>
            <p className="mt-2 text-sm text-ink-500">
              Organizada por <strong className="text-ink-700">{campanha.organizer.name}</strong>
              {campanha.publishedAt && <> · no ar desde {formatDate(campanha.publishedAt)}</>}
            </p>
          </header>

          {campanha.imageUrls.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {campanha.imageUrls.map((url, i) => (
                // eslint-disable-next-line @next/next/no-img-element -- imagens do bucket público
                <img key={url} src={url} alt={`Imagem ${i + 1} da campanha`} className={i === 0 ? 'rounded-2xl sm:col-span-2' : 'rounded-2xl'} />
              ))}
            </div>
          )}

          <section aria-labelledby="sobre">
            <h2 id="sobre" className="mb-3 font-display text-2xl font-extrabold text-ink-900">
              Sobre a campanha
            </h2>
            <div className="whitespace-pre-line leading-relaxed text-ink-700">{campanha.description}</div>
          </section>

          <TransparencyPanel data={transparencia} />

          <section aria-labelledby="despesas">
            <h2 id="despesas" className="mb-3 font-display text-2xl font-extrabold text-ink-900">
              Despesas
            </h2>
            <PublicExpenses expenses={despesas} />
          </section>

          {atualizacoes.length > 0 && (
            <section aria-labelledby="atualizacoes">
              <h2 id="atualizacoes" className="mb-3 font-display text-2xl font-extrabold text-ink-900">
                Atualizações
              </h2>
              <ol className="space-y-4">
                {atualizacoes.map((a) => (
                  <li key={a.id} className="rounded-2xl border border-line bg-surface p-5">
                    <p className="text-xs text-ink-500">{formatDate(a.createdAt)}</p>
                    <h3 className="font-bold text-ink-900">{a.title}</h3>
                    <p className="mt-1 whitespace-pre-line text-ink-700">{a.body}</p>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </article>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Card className="space-y-5 p-6">
            <div>
              <p className="font-display text-3xl font-extrabold text-ink-900">{formatBrl(campanha.confirmedCents)}</p>
              <p className="text-sm text-ink-600">confirmados de {formatBrl(campanha.goalCents)}</p>
            </div>
            <ProgressBar value={campanha.confirmedCents} max={campanha.goalCents} label="Progresso da arrecadação" />
            <p className="text-sm text-ink-600">
              <strong className="text-melancia-700">{percentOf(campanha.confirmedCents, campanha.goalCents)}%</strong> da meta ·{' '}
              {campanha.donationsCount} doações · {dias > 0 ? `${dias} dias restantes` : 'prazo encerrado'}
            </p>
            <DonateForm campaignId={campanha.id} acceptsDonations={campanha.acceptsDonations} />
          </Card>
        </aside>
      </div>
    </Container>
  );
}
