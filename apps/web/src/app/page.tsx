import { CAMPAIGN_CATEGORIES, CATEGORY_LABELS, type CampaignList } from '@soscomida/contracts';
import { BadgeCheck, FileSearch, HandCoins, Receipt } from 'lucide-react';
import Link from 'next/link';
import { CampaignCard } from '@/components/campaign-card';
import { Container, buttonClass } from '@/components/ui';
import { publicApi } from '@/lib/server-api';

// Renderizada por requisição: o build não depende da API no ar. Os dados
// continuam em cache por `revalidate` no fetch de publicApi.
export const dynamic = 'force-dynamic';

const PASSOS = [
  { icone: HandCoins, titulo: 'Você doa por Pix', texto: 'O valor só entra no total da campanha depois que o banco confirma o pagamento.' },
  { icone: Receipt, titulo: 'A campanha presta contas', texto: 'Quem organiza registra cada gasto e envia notas fiscais e comprovantes.' },
  { icone: FileSearch, titulo: 'Os documentos são conferidos', texto: 'Verificamos o que dá para verificar automaticamente e mostramos o que não deu.' },
  { icone: BadgeCheck, titulo: 'Tudo fica público', texto: 'Cada número tem um significado claro. Nada de selo genérico de "verificado".' },
];

export default async function HomePage() {
  const destaques = await publicApi<CampaignList>('/campaigns?pageSize=6&sort=recentes');

  return (
    <>
      <section className="border-b border-line bg-gradient-to-b from-sky-50 to-paper">
        <Container className="grid gap-10 py-16 md:grid-cols-[1.2fr_1fr] md:items-center md:py-24">
          <div>
            <p className="mb-3 font-bold text-sky-700">Doações com prestação de contas</p>
            <h1 className="font-display text-4xl font-extrabold leading-tight text-ink-900 sm:text-5xl">
              Ajude e acompanhe <span className="text-maca-600">para onde vai</span> cada real.
            </h1>
            <p className="mt-4 max-w-xl text-lg text-ink-600">
              Campanhas solidárias com doações via Pix e transparência de verdade: você vê o que foi arrecadado, o que foi gasto e o que já foi
              comprovado — separadamente.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/campanhas" className={buttonClass('donate', 'lg')}>
                Quero doar
              </Link>
              <Link href="/painel/campanhas/nova" className={buttonClass('secondary', 'lg')}>
                Criar campanha
              </Link>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {CAMPAIGN_CATEGORIES.slice(0, 6).map((categoria) => (
              <Link
                key={categoria}
                href={`/campanhas?category=${categoria}`}
                className="rounded-2xl border border-line bg-surface px-4 py-5 text-center font-bold text-ink-800 shadow-soft hover:border-sky-300"
              >
                {CATEGORY_LABELS[categoria]}
              </Link>
            ))}
          </div>
        </Container>
      </section>

      <Container className="py-14">
        <div className="mb-6 flex items-end justify-between gap-4">
          <h2 className="font-display text-2xl font-extrabold text-ink-900 sm:text-3xl">Campanhas recentes</h2>
          <Link href="/campanhas" className="font-bold text-sky-700 hover:underline">
            Ver todas
          </Link>
        </div>
        {destaques.items.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line-strong p-8 text-center text-ink-600">
            Nenhuma campanha ativa no momento. <Link href="/painel/campanhas/nova" className="font-bold text-sky-700 underline">Crie a primeira.</Link>
          </p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {destaques.items.map((c) => (
              <CampaignCard key={c.id} campaign={c} />
            ))}
          </div>
        )}
      </Container>

      <section className="border-y border-line bg-paper-2">
        <Container className="py-14">
          <h2 className="mb-8 font-display text-2xl font-extrabold text-ink-900 sm:text-3xl">Como funciona</h2>
          <ol className="grid gap-6 md:grid-cols-4">
            {PASSOS.map(({ icone: Icone, titulo, texto }, i) => (
              <li key={titulo} className="rounded-2xl bg-surface p-5 shadow-soft">
                <Icone className="mb-3 size-7 text-sky-600" aria-hidden />
                <p className="font-display text-lg font-bold text-ink-900">
                  {i + 1}. {titulo}
                </p>
                <p className="mt-1 text-sm text-ink-600">{texto}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>
    </>
  );
}
