import sharp from 'sharp';

/**
 * dHash de 64 bits: a imagem vira 9×8 em tons de cinza e cada bit diz se um
 * pixel é mais claro que o vizinho da direita. Sobrevive a recompressão,
 * redimensionamento e pequenos ajustes de brilho — o SHA-256 não. Serve para
 * achar a mesma foto de comprovante reenviada com outra compressão.
 *
 * Não é prova de nada: duas fotos parecidas (mesmo cupom fotografado duas
 * vezes, ou cupons diferentes muito parecidos) dão hashes próximos. Vira
 * alerta para a revisão humana.
 */
export async function perceptualHash(imagem: Buffer): Promise<string> {
  const { data } = await sharp(imagem, { limitInputPixels: 50_000_000 })
    .rotate()
    .flatten({ background: '#ffffff' })
    .grayscale()
    .resize(9, 8, { fit: 'fill', kernel: 'lanczos3' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits = (bits << 1n) | (data[y * 9 + x]! > data[y * 9 + x + 1]! ? 1n : 0n);
    }
  }
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
export const SIMILAR_IMAGE_MAX_DISTANCE = 6;
