import 'server-only';
import { notFound } from 'next/navigation';

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';

/**
 * Leitura pública feita no servidor (SSR/ISR das páginas de campanha).
 * Não repassa cookies: só endpoints públicos, cacheáveis por `revalidate`.
 */
export async function publicApi<T>(path: string, revalidate = 60): Promise<T> {
  const resposta = await fetch(`${API_INTERNAL_URL}/api${path}`, { next: { revalidate } });
  if (resposta.status === 404) notFound();
  if (!resposta.ok) throw new Error(`API respondeu ${resposta.status} em ${path}`);
  return (await resposta.json()) as T;
}
