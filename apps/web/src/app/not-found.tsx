import Link from 'next/link';
import { Container, buttonClass } from '@/components/ui';

export default function NotFound() {
  return (
    <Container className="max-w-xl py-20 text-center">
      <p className="font-display text-6xl font-extrabold text-sky-300">404</p>
      <h1 className="mt-2 font-display text-2xl font-extrabold text-ink-900">Página não encontrada</h1>
      <p className="mt-2 text-ink-600">A campanha pode ter sido encerrada ou o endereço está incorreto.</p>
      <Link href="/campanhas" className={buttonClass('primary', 'md', 'mt-6')}>
        Ver campanhas
      </Link>
    </Container>
  );
}
