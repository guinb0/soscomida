import type { Metadata, Viewport } from 'next';
import { Baloo_2, Nunito } from 'next/font/google';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { Providers } from '@/lib/session';
import './globals.css';

const baloo = Baloo_2({ subsets: ['latin', 'latin-ext'], weight: ['600', '700', '800'], variable: '--font-baloo', display: 'swap' });
const nunito = Nunito({ subsets: ['latin', 'latin-ext'], weight: ['400', '600', '700', '800'], variable: '--font-nunito', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'SOS Comida — doações com prestação de contas', template: '%s · SOS Comida' },
  description: 'Doe para campanhas solidárias e acompanhe, com transparência, como o dinheiro é usado.',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = { themeColor: '#26b4e0' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${baloo.variable} ${nunito.variable}`}>
      <body className="flex min-h-dvh flex-col font-sans">
        <a href="#conteudo" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2">
          Pular para o conteúdo
        </a>
        <Providers>
          <SiteHeader />
          <main id="conteudo" className="flex-1">
            {children}
          </main>
        </Providers>
        <footer className="mt-16 border-t border-line bg-paper-2 py-8 text-sm text-ink-600">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 sm:flex-row sm:justify-between sm:px-6">
            <p>SOS Comida — tecnologia para arrecadação e transparência. A plataforma não guarda o dinheiro das doações.</p>
            <nav className="flex gap-4" aria-label="Rodapé">
              <Link href="/como-funciona" className="hover:underline">
                Como funciona
              </Link>
              <Link href="/transparencia" className="hover:underline">
                O que cada número significa
              </Link>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
