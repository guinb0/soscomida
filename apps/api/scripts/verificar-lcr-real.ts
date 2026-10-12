// Confere a revogação de algumas ACs intermediárias do pacote ICP-Brasil
// contra as LCRs reais das raízes (rede). Diagnóstico manual, fora do CI:
//   cd apps/api && npx vite-node scripts/verificar-lcr-real.ts
import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { RevocationChecker } from '../src/modules/fiscal/infra/revocation';

async function main(): Promise<void> {
  const pem = readFileSync(path.resolve(__dirname, '../assets/icp-brasil/acs-icp-brasil.pem'), 'utf8');
  const certs = (pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? []).map((b) => new X509Certificate(b));
  const raizes = certs.filter((c) => c.subject === c.issuer);
  const checker = new RevocationChecker(20_000);
  let n = 0;
  for (const c of certs) {
    const raiz = raizes.find((r) => c !== r && c.checkIssued(r) && c.verify(r.publicKey));
    if (!raiz || n >= 4) continue;
    n++;
    const r = await checker.check(c, raiz, new Date());
    console.warn(`${/CN=([^\n]+)/.exec(c.subject)?.[1]} → ${r.status} (${r.detail})`);
  }
}

void main();
