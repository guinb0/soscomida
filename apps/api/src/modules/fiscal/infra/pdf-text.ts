import { parseAccessKey } from '@soscomida/shared';
import { getDocumentProxy, renderPageAsImage } from 'unpdf';

const MAX_PAGES = 5;

/**
 * Texto de um PDF que tenha camada de texto (DANFE gerado pelo sistema
 * emissor). PDF escaneado só tem imagem: devolve texto vazio — OCR não é
 * feito aqui. Só as primeiras páginas: a chave fica no cabeçalho.
 */
export async function pdfText(conteudo: Buffer, timeoutMs = 10_000): Promise<string> {
  let timer: NodeJS.Timeout | undefined;
  const limite = new Promise<never>((_, rejeitar) => {
    timer = setTimeout(() => rejeitar(new Error('Tempo esgotado lendo o PDF')), timeoutMs);
  });
  try {
    return await Promise.race([lerTexto(conteudo), limite]);
  } finally {
    clearTimeout(timer);
  }
}

async function lerTexto(conteudo: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(conteudo), { disableFontFace: true });
  try {
    const paginas = Math.min(pdf.numPages, MAX_PAGES);
    const partes: string[] = [];
    for (let n = 1; n <= paginas; n++) {
      const pagina = await pdf.getPage(n);
      const t = await pagina.getTextContent();
      partes.push(t.items.map((i) => ('str' in i ? i.str : '')).join(' '));
    }
    return partes.join('\n');
  } finally {
    await pdf.cleanup();
  }
}

/**
 * Primeira página do PDF como imagem PNG, para o OCR de PDF escaneado (que
 * não tem camada de texto).
 */
export async function pdfFirstPageImage(conteudo: Buffer): Promise<Buffer> {
  const png = await renderPageAsImage(new Uint8Array(conteudo), 1, { canvasImport: () => import('@napi-rs/canvas'), scale: 2 });
  return Buffer.from(png);
}

export type KeyInText = { kind: 'FOUND'; accessKey: string } | { kind: 'NONE' } | { kind: 'AMBIGUOUS'; count: number };

/**
 * Procura chaves de acesso no texto: sequências de dígitos (o DANFE imprime em
 * grupos de 4, separados por espaço ou ponto) cuja janela de 44 dígitos passa
 * na validação estrutural e no dígito verificador.
 */
export function findAccessKeys(texto: string): KeyInText {
  const achadas = new Set<string>();
  for (const m of texto.matchAll(/\d(?:[ .\u00a0]?\d)+/g)) {
    const digitos = m[0].replace(/\D/g, '');
    for (let i = 0; i + 44 <= digitos.length; i++) {
      const k = parseAccessKey(digitos.slice(i, i + 44));
      if (k.ok) achadas.add(k.value.key);
    }
  }
  if (achadas.size === 0) return { kind: 'NONE' };
  if (achadas.size > 1) return { kind: 'AMBIGUOUS', count: achadas.size };
  return { kind: 'FOUND', accessKey: [...achadas][0]! };
}
