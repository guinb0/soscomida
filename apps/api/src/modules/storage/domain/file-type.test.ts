import { describe, expect, it } from 'vitest';
import { detectFileType } from './file-type';

const bytes = (...valores: (number | string)[]) =>
  new Uint8Array(valores.flatMap((v) => (typeof v === 'string' ? [...v].map((c) => c.charCodeAt(0)) : [v])));

describe('detecção do tipo real do arquivo', () => {
  it.each([
    ['JPEG', bytes(0xff, 0xd8, 0xff, 0xe0), 'image/jpeg'],
    ['PNG', bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a), 'image/png'],
    ['WebP', bytes('RIFF', 0, 0, 0, 0, 'WEBP'), 'image/webp'],
    ['PDF', bytes('%PDF-1.7'), 'application/pdf'],
    ['XML', bytes('<?xml version="1.0"?>'), 'application/xml'],
    ['XML com BOM', bytes(0xef, 0xbb, 0xbf, '<?xml'), 'application/xml'],
  ])('reconhece %s', (_nome, conteudo, esperado) => {
    expect(detectFileType(conteudo)).toBe(esperado);
  });

  it.each([
    ['HTML disfarçado de imagem', bytes('<html><script>alert(1)</script>')],
    ['executável', bytes('MZ', 0x90, 0x00)],
    ['RIFF que não é WebP (WAV)', bytes('RIFF', 0, 0, 0, 0, 'WAVE')],
    ['vazio', new Uint8Array()],
  ])('recusa %s', (_nome, conteudo) => {
    expect(detectFileType(conteudo)).toBeNull();
  });
});
