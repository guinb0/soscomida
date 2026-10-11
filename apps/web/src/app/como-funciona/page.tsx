import type { Metadata } from 'next';
import Link from 'next/link';
import { Container, PageTitle, buttonClass } from '@/components/ui';

export const metadata: Metadata = { title: 'Como funciona' };

const ETAPAS = [
  ['Quem organiza cria a campanha', 'Descreve a causa, define a meta e divide o orçamento em categorias de gasto.'],
  ['A moderação analisa', 'Antes de receber qualquer doação, alguém da equipe confere a campanha. Pode aprovar, pedir ajustes ou recusar, sempre com justificativa registrada.'],
  ['Doações por Pix', 'Quem doa recebe um QR Code. O valor só conta no total depois que o banco confirma o pagamento.'],
  ['Prestação de contas', 'O organizador registra os gastos com notas fiscais e comprovantes, que são conferidos automaticamente quando possível e revisados por pessoas quando necessário.'],
  ['Tudo público', 'A página da campanha mostra o que foi arrecadado, o que foi gasto e o nível de verificação de cada despesa.'],
] as const;

export default function ComoFuncionaPage() {
  return (
    <Container className="max-w-3xl py-10">
      <PageTitle title="Como funciona" />
      <ol className="space-y-4">
        {ETAPAS.map(([titulo, texto], i) => (
          <li key={titulo} className="flex gap-4 rounded-2xl border border-line bg-surface p-5">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sky-100 font-display text-lg font-extrabold text-sky-800">{i + 1}</span>
            <div>
              <h2 className="font-display text-lg font-bold text-ink-900">{titulo}</h2>
              <p className="mt-1 text-ink-700">{texto}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-8 rounded-2xl bg-paper-2 p-5 text-sm text-ink-700">
        A plataforma é tecnologia de arrecadação e transparência: <strong>não guarda o dinheiro das doações</strong>. Os pagamentos passam por um
        provedor Pix regulado, e os números exibidos refletem o que ele confirmou.
      </p>
      <div className="mt-8 flex gap-3">
        <Link href="/campanhas" className={buttonClass('donate')}>
          Ver campanhas
        </Link>
        <Link href="/transparencia" className={buttonClass('secondary')}>
          O que cada número significa
        </Link>
      </div>
    </Container>
  );
}
