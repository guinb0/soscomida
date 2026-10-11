import { CAMPAIGN_CATEGORIES, CATEGORY_LABELS, type CampaignList, listCampaignsQuerySchema } from '@soscomida/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { CampaignCard } from '@/components/campaign-card';
import { Container, Input, PageTitle, Select, buttonClass } from '@/components/ui';
import { publicApi } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Campanhas' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function CampanhasPage({ searchParams }: { searchParams: SearchParams }) {
  const bruto = await searchParams;
  const filtros = listCampaignsQuerySchema.safeParse(Object.fromEntries(Object.entries(bruto).filter(([, v]) => typeof v === 'string' && v !== '')));
  const query = filtros.success ? filtros.data : listCampaignsQuerySchema.parse({});

  const params = new URLSearchParams();
  for (const [chave, valor] of Object.entries(query)) if (valor !== undefined) params.set(chave, String(valor));
  const lista = await publicApi<CampaignList>(`/campaigns?${params}`, 30);
  const totalPaginas = Math.max(1, Math.ceil(lista.total / lista.pageSize));

  const linkPagina = (page: number) => {
    const p = new URLSearchParams(params);
    p.set('page', String(page));
    return `/campanhas?${p}`;
  };

  return (
    <Container className="py-10">
      <PageTitle title="Campanhas ativas" subtitle="Todas passaram por análise antes de receber doações." />

      <form className="mb-8 grid gap-3 rounded-2xl border border-line bg-surface p-4 shadow-soft sm:grid-cols-[2fr_1fr_1fr_1fr_auto]" role="search">
        <label className="sr-only" htmlFor="q">
          Buscar
        </label>
        <Input id="q" name="q" placeholder="Buscar por nome ou objetivo" defaultValue={query.q ?? ''} />
        <label className="sr-only" htmlFor="category">
          Categoria
        </label>
        <Select id="category" name="category" defaultValue={query.category ?? ''}>
          <option value="">Todas as categorias</option>
          {CAMPAIGN_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </Select>
        <label className="sr-only" htmlFor="region">
          Região
        </label>
        <Input id="region" name="region" placeholder="Região (ex.: Ceilândia)" defaultValue={query.region ?? ''} />
        <label className="sr-only" htmlFor="sort">
          Ordenar
        </label>
        <Select id="sort" name="sort" defaultValue={query.sort}>
          <option value="recentes">Mais recentes</option>
          <option value="mais_arrecadadas">Mais arrecadadas</option>
          <option value="terminando">Terminando</option>
        </Select>
        <button className={buttonClass('primary')} type="submit">
          Filtrar
        </button>
      </form>

      <p className="mb-4 text-sm text-ink-600" aria-live="polite">
        {lista.total} {lista.total === 1 ? 'campanha encontrada' : 'campanhas encontradas'}
      </p>

      {lista.items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line-strong p-10 text-center text-ink-600">Nenhuma campanha com esses filtros.</p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {lista.items.map((c) => (
            <CampaignCard key={c.id} campaign={c} />
          ))}
        </div>
      )}

      {totalPaginas > 1 && (
        <nav className="mt-10 flex items-center justify-center gap-3" aria-label="Paginação">
          {query.page > 1 && (
            <Link className={buttonClass('secondary', 'sm')} href={linkPagina(query.page - 1)}>
              Anterior
            </Link>
          )}
          <span className="text-sm text-ink-600">
            Página {query.page} de {totalPaginas}
          </span>
          {query.page < totalPaginas && (
            <Link className={buttonClass('secondary', 'sm')} href={linkPagina(query.page + 1)}>
              Próxima
            </Link>
          )}
        </nav>
      )}
    </Container>
  );
}
