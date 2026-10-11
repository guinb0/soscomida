'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { api } from '@/lib/api';
import { isStaff, useMe, useRefreshSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { buttonClass } from './ui';

const LINKS = [
  { href: '/campanhas', label: 'Campanhas' },
  { href: '/como-funciona', label: 'Como funciona' },
];

export function SiteHeader() {
  const { data: me } = useMe();
  const pathname = usePathname();
  const router = useRouter();
  const refresh = useRefreshSession();
  const [aberto, setAberto] = useState(false);

  const sair = async () => {
    await api('/auth/logout', { method: 'POST' });
    await refresh();
    router.push('/');
  };

  const links = [
    ...LINKS,
    ...(me ? [{ href: '/painel', label: 'Meu painel' }] : []),
    ...(isStaff(me) ? [{ href: '/moderacao', label: 'Moderação' }] : []),
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2" aria-label="SOS Comida, página inicial">
          <span className="grid size-9 place-items-center rounded-[46%_54%_54%_46%/52%_48%_52%_48%] bg-gradient-to-br from-sky-400 to-sun-300 font-display text-lg font-extrabold text-white">
            S
          </span>
          <span className="font-display text-xl font-extrabold text-ink-900">SOS Comida</span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Principal">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn('rounded-lg px-3 py-2 font-semibold text-ink-700 hover:bg-paper-2', pathname.startsWith(l.href) && 'text-sky-700')}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          {me ? (
            <>
              <span className="text-sm text-ink-600">Olá, {me.name.split(' ')[0]}</span>
              <button onClick={sair} className={buttonClass('ghost', 'sm')}>
                Sair
              </button>
            </>
          ) : (
            <>
              <Link href="/entrar" className={buttonClass('ghost', 'sm')}>
                Entrar
              </Link>
              <Link href="/cadastrar" className={buttonClass('primary', 'sm')}>
                Criar conta
              </Link>
            </>
          )}
        </div>

        <button className="md:hidden" onClick={() => setAberto((v) => !v)} aria-expanded={aberto} aria-controls="menu-movel" aria-label="Abrir menu">
          {aberto ? <X /> : <Menu />}
        </button>
      </div>

      {aberto && (
        <nav id="menu-movel" className="border-t border-line bg-paper px-4 pb-4 md:hidden" aria-label="Menu">
          {links.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setAberto(false)} className="block rounded-lg px-2 py-3 font-semibold text-ink-800">
              {l.label}
            </Link>
          ))}
          {me ? (
            <button onClick={sair} className="block w-full px-2 py-3 text-left font-semibold text-ink-800">
              Sair
            </button>
          ) : (
            <div className="mt-2 flex gap-2">
              <Link href="/entrar" className={buttonClass('secondary', 'sm', 'flex-1')}>
                Entrar
              </Link>
              <Link href="/cadastrar" className={buttonClass('primary', 'sm', 'flex-1')}>
                Criar conta
              </Link>
            </div>
          )}
        </nav>
      )}
    </header>
  );
}
