import { revalidateTag } from 'next/cache';
import { createHash, timingSafeEqual } from 'node:crypto';

const TAG_VALIDA = /^(campaigns|campaign:[a-z0-9-]{1,160})$/;

const resumo = (v: string) => createHash('sha256').update(v).digest();

/**
 * Chamada pelo worker da API quando uma campanha muda (status, doação
 * confirmada, estorno): expira o cache das páginas públicas na hora. Sem
 * REVALIDATE_SECRET a rota não existe.
 */
export async function POST(request: Request): Promise<Response> {
  const segredo = process.env.REVALIDATE_SECRET;
  if (!segredo) return new Response(null, { status: 404 });

  const enviado = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  if (!timingSafeEqual(resumo(enviado), resumo(segredo))) return new Response(null, { status: 401 });

  const corpo = (await request.json().catch(() => null)) as { tags?: unknown } | null;
  const tags = corpo?.tags;
  if (!Array.isArray(tags) || tags.length === 0 || tags.length > 20 || !tags.every((t): t is string => typeof t === 'string' && TAG_VALIDA.test(t))) {
    return Response.json({ error: 'tags inválidas' }, { status: 400 });
  }
  for (const tag of tags) revalidateTag(tag, { expire: 0 });
  return Response.json({ revalidated: tags });
}
