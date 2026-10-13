import sharp from 'sharp';

/**
 * pHash de 64 bits: a imagem vira 32×32 em tons de cinza, passa pela DCT e
 * cada bit diz se uma das 8×8 frequências mais baixas está acima da mediana.
 * Sobrevive a recompressão, redimensionamento e pequenos ajustes de brilho —
 * o SHA-256 não. Serve para achar a mesma foto de comprovante reenviada com
 * outra compressão.
 *
 * Trocou o dHash (diferença entre vizinhos), que oscilava em áreas lisas — e
 * cupom é quase todo papel branco: a mesma foto recomprimida chegava a 10 bits
 * de distância, misturando-se com fotos diferentes. Medido com 300 cupons
 * sintéticos (scripts/medir-hash-perceptual.ts): mesma foto ≤ 6, outra ≥ 10;
 * numa variante com um bloco escuro grande, 1 em 300 recomprimidas ficou em 10
 * (escapa do alerta). Ainda não medido com fotos reais.
 *
 * Não é prova de nada: duas fotos parecidas (mesmo cupom fotografado duas
 * vezes, ou cupons diferentes muito parecidos) dão hashes próximos. Vira
 * alerta para a revisão humana.
 */
const LADO = 32;
const FREQ = 8;
const COS = Array.from({ length: FREQ }, (_, u) => Array.from({ length: LADO }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / (2 * LADO))));

export async function perceptualHash(imagem: Buffer): Promise<string> {
  const { data } = await sharp(imagem, { limitInputPixels: 50_000_000 })
    .rotate()
    .flatten({ background: '#ffffff' })
    .grayscale()
    .resize(LADO, LADO, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  // DCT-II separável: primeiro nas linhas, depois nas colunas.
  const linhas = Array.from({ length: LADO }, (_, y) => COS.map((c) => c.reduce((s, k, x) => s + data[y * LADO + x]! * k, 0)));
  const coef: number[] = [];
  for (let u = 0; u < FREQ; u++) {
    for (let v = 0; v < FREQ; v++) coef.push(COS[u]!.reduce((s, k, y) => s + linhas[y]![v]! * k, 0));
  }
  // A mediana ignora o termo constante (brilho médio), que dominaria a conta.
  const ac = coef.slice(1).sort((a, b) => a - b);
  const mediana = ac[Math.floor(ac.length / 2)]!;
  let bits = 0n;
  for (const c of coef) bits = (bits << 1n) | (c > mediana ? 1n : 0n);
  return bits.toString(16).padStart(16, '0');
}

export function hammingDistance(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/** Distância máxima (em 64 bits) para considerar duas imagens a mesma foto. */
export const SIMILAR_IMAGE_MAX_DISTANCE = 8;
