/**
 * Tipo real do arquivo pelos primeiros bytes. O Content-Type e a extensão
 * vêm do cliente e não valem como prova.
 */
export type DetectedType = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf' | 'application/xml';

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  bytes.length >= offset + signature.length && signature.every((b, i) => bytes[offset + i] === b);

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

export function detectFileType(bytes: Uint8Array): DetectedType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'image/webp';
  if (startsWith(bytes, ascii('%PDF-'))) return 'application/pdf';
  // XML: com ou sem BOM UTF-8.
  if (startsWith(bytes, ascii('<?xml')) || startsWith(bytes, [0xef, 0xbb, 0xbf, ...ascii('<?xml')])) return 'application/xml';
  return null;
}

export const EXTENSION: Record<DetectedType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'application/xml': 'xml',
};
