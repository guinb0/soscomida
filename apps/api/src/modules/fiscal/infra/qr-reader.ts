import jsQR from 'jsqr';
import sharp, { type Sharp } from 'sharp';

const LADO_MAXIMO = 1_600;

/**
 * Procura um QR Code na foto (cupom de NFC-e). Tenta a imagem reduzida e,
 * se não achar, uma versão com contraste normalizado e nitidez —
 * ajuda em cupom térmico desbotado. Devolve o texto do QR ou null.
 */
export async function readQrCode(imagem: Buffer): Promise<string | null> {
  const tentativas = [
    (s: Sharp) => s,
    (s: Sharp) => s.normalise().sharpen(),
  ];
  for (const preparar of tentativas) {
    const { data, info } = await preparar(
      sharp(imagem, { limitInputPixels: 40_000_000 }).rotate().resize({ width: LADO_MAXIMO, height: LADO_MAXIMO, fit: 'inside', withoutEnlargement: true }),
    )
      .toColourspace('srgb')
      .removeAlpha()
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    // jsQR espera RGBA; imagem em tons de cinza chega com menos canais.
    if (info.channels !== 4) continue;
    const achado = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), info.width, info.height, { inversionAttempts: 'attemptBoth' });
    if (achado?.data) return achado.data;
  }
  return null;
}
