// Distribuição da distância do hash perceptual em cupons sintéticos: a mesma
// foto recomprimida contra uma foto diferente. Diagnóstico manual, fora do CI:
//   cd apps/api && npx vite-node scripts/medir-hash-perceptual.ts
import sharp from 'sharp';
import { SIMILAR_IMAGE_MAX_DISTANCE, hammingDistance, perceptualHash } from '../src/modules/storage/infra/perceptual-hash';

async function fotoCupom(semente: number): Promise<Buffer> {
  const faixas = Array.from({ length: 9 }, (_, i) => {
    const y = 40 + ((semente * 37 + i * 101) % 800);
    return `<rect x="${30 + ((semente + i) % 5) * 20}" y="${y}" width="${300 + ((semente * 13 + i * 29) % 200)}" height="16" fill="#222"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="960"><rect width="600" height="960" fill="#f4f1ea"/>${faixas}</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}

/** Variante do teste unitário: faixas de largura fixa e um bloco escuro (QR). */
async function fotoComBloco(semente: number): Promise<Buffer> {
  const faixas = Array.from({ length: 9 }, (_, i) => `<rect x="${40 + (i % 3) * 25}" y="${40 + ((semente * 37 + i * 101) % 800)}" width="${380 - (i % 4) * 60}" height="18" fill="#222"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="960"><rect width="600" height="960" fill="#f4f1ea"/>${faixas}<rect x="200" y="760" width="200" height="160" fill="#000"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
}

async function medir(nome: string, fotoCupom: (s: number) => Promise<Buffer>): Promise<void> {
  const mesma: number[] = [];
  const outra: number[] = [];
  for (let s = 0; s < 300; s++) {
    const o = await fotoCupom(s);
    const h = await perceptualHash(o);
    mesma.push(hammingDistance(h, await perceptualHash(await sharp(o).resize(420).jpeg({ quality: 40 }).toBuffer())));
    outra.push(hammingDistance(h, await perceptualHash(await fotoCupom(s + 7))));
  }
  const hist = (a: number[]) =>
    Object.entries(a.reduce<Record<number, number>>((m, d) => ((m[d] = (m[d] ?? 0) + 1), m), {}))
      .map(([d, n]) => `${d}:${n}`)
      .join(' ');
  console.warn(`${nome}
  mesma foto  ${hist(mesma)}
  outra foto  ${hist(outra)}`);
}

async function main(): Promise<void> {
  console.warn(`limite ${SIMILAR_IMAGE_MAX_DISTANCE}`);
  await medir('faixas variadas', fotoCupom);
  await medir('com bloco escuro', fotoComBloco);
}

void main();
