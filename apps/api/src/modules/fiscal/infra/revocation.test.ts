import 'reflect-metadata';
import { X509Certificate as NodeCertificate, webcrypto } from 'node:crypto';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CRLDistributionPointsExtension, X509CertificateGenerator, X509CrlGenerator, X509CrlReason } from '@peculiar/x509';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RevocationChecker } from './revocation';

const alg = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', publicExponent: new Uint8Array([1, 0, 1]), modulusLength: 2048 } as const;
const node = (raw: ArrayBuffer) => new NodeCertificate(Buffer.from(raw));

/** AC fictícia + LCR servida por um servidor local (nenhuma rede externa). */
let servidor: Server;
let base = '';
const lcrs = new Map<string, Buffer>();
let ac: NodeCertificate;
let acChaves: CryptoKeyPair;

async function folha(serial: string, caminhoLcr: string): Promise<NodeCertificate> {
  const chaves = (await webcrypto.subtle.generateKey(alg, true, ['sign', 'verify'])) as CryptoKeyPair;
  const c = await X509CertificateGenerator.create({
    serialNumber: serial,
    subject: 'CN=SUPERMERCADO EXEMPLO LTDA:11222333000181',
    issuer: 'CN=AC FICTICIA LCR',
    notBefore: new Date('2020-01-01'),
    notAfter: new Date('2045-01-01'),
    signingAlgorithm: alg,
    publicKey: chaves.publicKey,
    signingKey: acChaves.privateKey,
    extensions: [new CRLDistributionPointsExtension([`${base}${caminhoLcr}`])],
  });
  return node(c.rawData);
}

async function publicarLcr(caminho: string, revogados: { serial: string; em: Date }[], nextUpdate = new Date(Date.now() + 86_400_000)) {
  const crl = await X509CrlGenerator.create({
    issuer: 'CN=AC FICTICIA LCR',
    thisUpdate: new Date(Date.now() - 3_600_000),
    nextUpdate,
    signingAlgorithm: alg,
    signingKey: acChaves.privateKey,
    entries: revogados.map((r) => ({ serialNumber: r.serial, revocationDate: r.em, reason: X509CrlReason.keyCompromise })),
  });
  lcrs.set(caminho, Buffer.from(crl.rawData));
}

beforeAll(async () => {
  servidor = createServer((req, res) => {
    const corpo = lcrs.get(req.url ?? '');
    if (!corpo) res.writeHead(404).end();
    else res.writeHead(200, { 'content-type': 'application/pkix-crl' }).end(corpo);
  });
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  acChaves = (await webcrypto.subtle.generateKey(alg, true, ['sign', 'verify'])) as CryptoKeyPair;
  const c = await X509CertificateGenerator.createSelfSigned({
    serialNumber: '01',
    name: 'CN=AC FICTICIA LCR',
    notBefore: new Date('2020-01-01'),
    notAfter: new Date('2045-01-01'),
    signingAlgorithm: alg,
    keys: acChaves,
  });
  ac = node(c.rawData);
});
afterAll(() => new Promise<void>((r) => servidor.close(() => r())));

describe('revogação pela LCR', () => {
  it('certificado fora da lista: GOOD', async () => {
    await publicarLcr('/ac1.crl', [{ serial: '99', em: new Date('2024-01-01') }]);
    const r = await new RevocationChecker().check(await folha('10', '/ac1.crl'), ac, new Date());
    expect(r.status).toBe('GOOD');
  });

  it('revogado antes da emissão: REVOKED; revogado depois: a assinatura continua valendo', async () => {
    await publicarLcr('/ac2.crl', [{ serial: '20', em: new Date('2025-06-01') }]);
    const c = await folha('20', '/ac2.crl');
    const checker = new RevocationChecker();
    expect(await checker.check(c, ac, new Date('2026-10-05'))).toMatchObject({ status: 'REVOKED' });
    expect(await checker.check(c, ac, new Date('2025-01-10'))).toMatchObject({ status: 'GOOD', detail: expect.stringContaining('depois da emissão') });
  });

  it('LCR inexistente, vencida ou assinada por outra AC: UNKNOWN (nunca GOOD por omissão)', async () => {
    const checker = new RevocationChecker();
    expect((await checker.check(await folha('30', '/nao-existe.crl'), ac, null)).status).toBe('UNKNOWN');

    await publicarLcr('/vencida.crl', [], new Date(Date.now() - 1_000));
    expect((await checker.check(await folha('31', '/vencida.crl'), ac, null)).status).toBe('UNKNOWN');

    const outraAc = node(
      (
        await X509CertificateGenerator.createSelfSigned({
          serialNumber: '02',
          name: 'CN=AC FICTICIA LCR',
          notBefore: new Date('2020-01-01'),
          notAfter: new Date('2045-01-01'),
          signingAlgorithm: alg,
          keys: (await webcrypto.subtle.generateKey(alg, true, ['sign', 'verify'])) as CryptoKeyPair,
        })
      ).rawData,
    );
    await publicarLcr('/ac3.crl', []);
    expect(await checker.check(await folha('32', '/ac3.crl'), outraAc, null)).toMatchObject({ status: 'UNKNOWN', detail: expect.stringContaining('não confere') });
  });

  it('certificado sem endereço de LCR: NOT_CHECKED', async () => {
    expect((await new RevocationChecker().check(ac, ac, null)).status).toBe('NOT_CHECKED');
  });

  it('guarda a LCR até a próxima atualização (uma busca só)', async () => {
    await publicarLcr('/cache.crl', []);
    let buscas = 0;
    const contando: typeof fetch = (input, init) => {
      buscas++;
      return fetch(input, init);
    };
    const checker = new RevocationChecker(5_000, contando);
    const c = await folha('40', '/cache.crl');
    await checker.check(c, ac, null);
    await checker.check(c, ac, null);
    expect(buscas).toBe(1);
  });
});
