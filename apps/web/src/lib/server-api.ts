import 'server-only';
import { notFound } from 'next/navigation';

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';

/** Etiquetas de cache invalidadas pelo worker da API (rota /interno/revalidar). */
export const cacheTags = {
  campaigns: 'campaigns',
  campaign: (slug: string) => `campaign:${slug}`,
};

/**
 * Leitura pública feita no servidor. Não repassa cookies: só endpoints
 * públicos. O cache expira em `revalidate` segundos, mas normalmente cai
 * antes: o worker invalida as etiquetas quando a campanha muda.
 */
export async function publicApi<T>(path: string, cache: { tags: string[]; revalidate?: number }): Promise<T> {
  const resposta = await fetch(`${API_INTERNAL_URL}/api${path}`, { next: { revalidate: cache.revalidate ?? 300, tags: cache.tags } });
  if (resposta.status === 404) notFound();
  if (!resposta.ok) throw new Error(`API respondeu ${resposta.status} em ${path}`);
  return (await resposta.json()) as T;
}
