// Monta assets/icp-brasil/acs-icp-brasil.pem. Lê os .crt do pacote do ITI (PEM ou DER), confere a cadeia até as raízes
// ICP-Brasil e escreve um único PEM. Uso: node scripts/montar-acs-icp-brasil.mjs <pasta-com-os-crt> assets/icp-brasil/acs-icp-brasil.pem
import { X509Certificate } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [pasta, saida] = process.argv.slice(2);
const certs = [];
for (const nome of readdirSync(pasta).sort()) {
  const bruto = readFileSync(path.join(pasta, nome));
  const texto = bruto.toString('latin1');
  const blocos = texto.includes('-----BEGIN CERTIFICATE-----') ? texto.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) : [bruto];
  for (const b of blocos) {
    try {
      certs.push({ nome, c: new X509Certificate(b) });
    } catch (e) {
      console.error('ilegível', nome, e.message);
    }
  }
}
const assina = (filho, pai) => {
  try {
    return filho.verify(pai.publicKey);
  } catch {
    return false;
  }
};
const unicos = new Map();
for (const x of certs) unicos.set(x.c.fingerprint256, x);
const lista = [...unicos.values()];
const raizes = lista.filter((x) => x.c.subject === x.c.issuer && assina(x.c, x.c) && /Raiz Brasileira/i.test(x.c.subject));
console.warn('certificados', lista.length, 'raízes', raizes.length);
for (const r of raizes) console.warn('  raiz:', r.c.subject.split('\n').find((l) => l.startsWith('CN=')), r.c.validTo);

// Mantém só ACs que encadeiam até uma raiz.
const confiaveis = new Set(raizes.map((r) => r.c.fingerprint256));
let mudou = true;
while (mudou) {
  mudou = false;
  for (const x of lista) {
    if (confiaveis.has(x.c.fingerprint256)) continue;
    const emissor = lista.find((y) => confiaveis.has(y.c.fingerprint256) && x.c.checkIssued(y.c) && assina(x.c, y.c));
    if (emissor) {
      confiaveis.add(x.c.fingerprint256);
      mudou = true;
    }
  }
}
const fora = lista.filter((x) => !confiaveis.has(x.c.fingerprint256));
console.warn('encadeiam até a raiz:', confiaveis.size, '· fora:', fora.length);
for (const f of fora) console.warn('  fora:', f.nome);
const pem = lista
  .filter((x) => confiaveis.has(x.c.fingerprint256))
  .map((x) => `# ${x.c.subject.split('\n').find((l) => l.startsWith('CN=')) ?? x.nome}\n${x.c.toString().trim()}`)
  .join('\n');
writeFileSync(saida, pem + '\n');
