import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { accessKey, fotoCupomSemQr as cupom, pdfComImagem } from '../../../../test/fiscal-fixtures';
import { findAccessKeys, pdfFirstPageImage, pdfText } from './pdf-text';
import { ReceiptOcr } from './receipt-ocr';

const ocr = new ReceiptOcr();
afterAll(() => ocr.close());

describe('OCR do cupom sem QR Code', () => {
  it('acha a chave de acesso impressa', async () => {
    const k = accessKey();
    expect(findAccessKeys(await ocr.digits(await cupom(k)))).toEqual({ kind: 'FOUND', accessKey: k });
  }, 60_000);

  it('foto mais ruim (menor e mais comprimida) ainda funciona', async () => {
    const k = accessKey();
    expect(findAccessKeys(await ocr.digits(await cupom(k, { jpeg: 45, largura: 700 })))).toEqual({ kind: 'FOUND', accessKey: k });
  }, 60_000);

  it('imagem sem chave não inventa uma', async () => {
    const vazia = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
    expect(findAccessKeys(await ocr.digits(vazia))).toEqual({ kind: 'NONE' });
  }, 60_000);

  it('PDF escaneado (só imagem): sem texto, mas a página renderizada passa no OCR', async () => {
    const k = accessKey({ model: '55' });
    const jpeg = await cupom(k);
    const { width, height } = await sharp(jpeg).metadata();
    const pdf = pdfComImagem(jpeg, width, height);
    expect((await pdfText(pdf)).trim()).toBe('');
    expect(findAccessKeys(await ocr.digits(await pdfFirstPageImage(pdf)))).toEqual({ kind: 'FOUND', accessKey: k });
  }, 60_000);
});
