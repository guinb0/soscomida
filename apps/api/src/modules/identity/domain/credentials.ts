import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Algorithm, hash, verify } from '@node-rs/argon2';

/** Argon2id com os parâmetros mínimos recomendados pela OWASP (19 MiB, t=2, p=1). */
const ARGON2_OPTIONS = { algorithm: Algorithm.Argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export const hashPassword = (password: string): Promise<string> => hash(password, ARGON2_OPTIONS);

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/**
 * Hash usado quando o e-mail não existe: verificar contra ele custa o mesmo
 * tempo que uma senha real, e o tempo de resposta não revela se a conta existe.
 */
let hashFicticio: Promise<string> | undefined;
export function dummyPasswordHash(): Promise<string> {
  hashFicticio ??= hashPassword(randomBytes(16).toString('hex'));
  return hashFicticio;
}

/** Token de sessão: 32 bytes aleatórios. Só o SHA-256 vai para o banco. */
export function newSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: sha256(token) };
}

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export function constantTimeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** AES-256-GCM para guardar o segredo TOTP. Formato: iv.tag.ciphertext (base64url). */
export function encryptSecret(plain: string, keyBase64: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyBase64, 'base64'), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((b) => b.toString('base64url')).join('.');
}

export function decryptSecret(payload: string, keyBase64: string): string {
  const [iv, tag, data] = payload.split('.').map((p) => Buffer.from(p, 'base64url'));
  if (!iv || !tag || !data) throw new Error('Segredo cifrado em formato inválido');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyBase64, 'base64'), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
