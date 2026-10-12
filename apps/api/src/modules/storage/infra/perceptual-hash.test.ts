import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { SIMILAR_IMAGE_MAX_DISTANCE, hammingDistance, perceptualHash } from './perceptual-hash';

/** "Foto de cupom" sintética: fundo claro com faixas de texto em posições fixas. */
async function cupom(linhas: number[], largura = 600): Promise<Buffer> {
  const altura = Math.round(largura * 1.6);
  const faixas = linhas
    .map((y, i) => `<rect x="${40 + (i % 3) * 25}" y="${y}" width="${380 - (i % 4) * 60}" height="18" fill="#222"/>`)
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="960"><rect width="600" height="960" fill="#f4f1ea"/>${faixas}<rect x="200" y="760" width="200" height="160" fill="#000"/></svg>`;
  return sharp(Buffer.from(svg)).resize(largura, altura).jpeg({ quality: 92 }).toBuffer();
}

describe('hash perceptual (dHash)', () => {
  it('a mesma foto recomprimida e reduzida fica a poucos bits de distância', async () => {
    const original = await cupom([60, 110, 160, 260, 300, 420, 470, 560, 620]);
    const recomprimida = await sharp(original).resize(300).jpeg({ quality: 35 }).toBuffer();
    const clareada = await sharp(original).modulate({ brightness: 1.08 }).png().toBuffer();
    const [a, b, c] = await Promise.all([perceptualHash(original), perceptualHash(recomprimida), perceptualHash(clareada)]);
    expect(hammingDistance(a, b)).toBeLessThanOrEqual(SIMILAR_IMAGE_MAX_DISTANCE);
    expect(hammingDistance(a, c)).toBeLessThanOrEqual(SIMILAR_IMAGE_MAX_DISTANCE);
  });

  it('outro cupom fica longe', async () => {
    const a = await perceptualHash(await cupom([60, 110, 160, 260, 300, 420, 470, 560, 620]));
    const b = await perceptualHash(await cupom([30, 200, 240, 380, 500, 520, 680]));
    expect(hammingDistance(a, b)).toBeGreaterThan(SIMILAR_IMAGE_MAX_DISTANCE);
  });

  it('hash tem 16 dígitos hexadecimais e distância é simétrica', async () => {
    const h = await perceptualHash(await cupom([100, 300]));
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(hammingDistance('ffffffffffffffff', '0000000000000000')).toBe(64);
    expect(hammingDistance(h, h)).toBe(0);
  });
});
