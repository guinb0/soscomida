import QRCode from 'qrcode';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { readQrCode } from './qr-reader';

describe('leitura de QR Code em imagem', () => {
  it('lê o QR de uma "foto" JPEG com margem e fundo', async () => {
    const conteudo = 'https://www.fazenda.df.gov.br/nfce/qrcode?p=53261011222333000181650010001234561123456780|2|1|1|ABC';
    const qr = await QRCode.toBuffer(conteudo, { width: 300, margin: 2 });
    // Simula a foto: QR no meio de uma área maior, em JPEG.
    const foto = await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#f4f1ea' } })
      .composite([{ input: qr, top: 500, left: 300 }])
      .jpeg({ quality: 80 })
      .toBuffer();
    await expect(readQrCode(foto)).resolves.toBe(conteudo);
  });

  it('lê QR em imagem que já chega em tons de cinza (scanner)', async () => {
    const qr = await QRCode.toBuffer('teste-cinza', { width: 240, margin: 2 });
    const cinza = await sharp(qr).toColourspace('b-w').jpeg().toBuffer();
    expect((await sharp(cinza).metadata()).channels).toBe(1);
    await expect(readQrCode(cinza)).resolves.toBe('teste-cinza');
  });

  it('devolve null quando não há QR', async () => {
    const vazia = await sharp({ create: { width: 400, height: 400, channels: 3, background: '#ffffff' } }).png().toBuffer();
    await expect(readQrCode(vazia)).resolves.toBeNull();
  });
});
