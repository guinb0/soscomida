import path from 'node:path';
import sharp from 'sharp';
import { type Worker, createWorker } from 'tesseract.js';

export const RECEIPT_OCR = Symbol('RECEIPT_OCR');

/**
 * OCR local (Tesseract, sem rede e sem custo) para achar a chave de acesso
 * impressa num cupom fotografado sem QR Code legível. Só dígitos: a chave é
 * reconhecida depois pela validação estrutural + dígito verificador
 * (findAccessKeys), o que descarta a maior parte do ruído do OCR.
 *
 * Os dados de idioma vêm do pacote @tesseract.js-data/por (nada é baixado em
 * tempo de execução). O worker é criado na primeira foto e reaproveitado.
 */
export class ReceiptOcr {
  private worker: Promise<Worker> | null = null;

  constructor(private readonly timeoutMs = 20_000) {}

  private obterWorker(): Promise<Worker> {
    this.worker ??= (async () => {
      const langPath = path.join(path.dirname(require.resolve('@tesseract.js-data/por/package.json')), '4.0.0_best_int');
      const w = await createWorker('por', 1, { langPath, cacheMethod: 'none', gzip: true });
      await w.setParameters({ tessedit_char_whitelist: '0123456789 ' });
      return w;
    })().catch((error: unknown) => {
      this.worker = null;
      throw error;
    });
    return this.worker;
  }

  /** Texto (só dígitos e espaços) lido da imagem. Vazio se o OCR falhar ou demorar demais. */
  async digits(imagem: Buffer): Promise<string> {
    const preparada = await sharp(imagem, { limitInputPixels: 50_000_000 })
      .rotate()
      .flatten({ background: '#ffffff' })
      .grayscale()
      .normalize()
      .resize({ width: 1800, withoutEnlargement: false })
      .png()
      .toBuffer();
    let timer: NodeJS.Timeout | undefined;
    const limite = new Promise<string>((resolve) => {
      timer = setTimeout(() => resolve(''), this.timeoutMs);
    });
    try {
      const leitura = this.obterWorker().then(async (w) => (await w.recognize(preparada)).data.text);
      return await Promise.race([leitura, limite]);
    } catch {
      return '';
    } finally {
      clearTimeout(timer);
    }
  }

  async close(): Promise<void> {
    const w = this.worker;
    this.worker = null;
    if (w) await (await w).terminate();
  }
}
