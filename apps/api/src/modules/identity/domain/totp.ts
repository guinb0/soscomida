import { Secret, TOTP } from 'otpauth';

const PARAMS = { algorithm: 'SHA1', digits: 6, period: 30 } as const;

export function newTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

export function totpUri(secretBase32: string, issuer: string, account: string): string {
  return new TOTP({ ...PARAMS, issuer, label: account, secret: Secret.fromBase32(secretBase32) }).toString();
}

/** Aceita o código do intervalo atual e de um intervalo vizinho (relógio do celular adiantado/atrasado). */
export function verifyTotp(secretBase32: string, code: string, timestamp = Date.now()): boolean {
  const totp = new TOTP({ ...PARAMS, secret: Secret.fromBase32(secretBase32) });
  return totp.validate({ token: code, window: 1, timestamp }) !== null;
}

export function generateTotp(secretBase32: string, timestamp = Date.now()): string {
  return new TOTP({ ...PARAMS, secret: Secret.fromBase32(secretBase32) }).generate({ timestamp });
}
