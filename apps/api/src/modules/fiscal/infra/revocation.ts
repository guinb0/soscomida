import 'reflect-metadata';
import type { X509Certificate as NodeCertificate } from 'node:crypto';
import { CRLDistributionPointsExtension, X509Certificate, X509Crl } from '@peculiar/x509';

/**
 * Revogação do certificado da assinatura pela LCR (lista de certificados
 * revogados) publicada pela AC emissora, no endereço que vem no próprio
 * certificado. Só é chamada depois de a cadeia fechar numa raiz ICP-Brasil:
 * o endereço foi assinado por uma AC confiável (não é URL arbitrária do
 * usuário). A LCR é conferida com a chave da AC e guardada até o
 * `nextUpdate` (no máximo 24 h).
 *
 * Revogação DEPOIS da emissão não invalida a assinatura (o certificado era
 * válido quando assinou); revogação antes ou na data da emissão, sim.
 */
export type RevocationStatus = 'GOOD' | 'REVOKED' | 'UNKNOWN' | 'NOT_CHECKED';

export interface RevocationResult {
  status: RevocationStatus;
  detail: string | null;
}

const MAX_LCR_BYTES = 40 * 1024 * 1024;
const MAX_CACHE_MS = 24 * 3600 * 1000;

export const REVOCATION_CHECKER = Symbol('REVOCATION_CHECKER');

export class RevocationChecker {
  private readonly cache = new Map<string, { crl: X509Crl; validUntil: number }>();

  constructor(
    private readonly timeoutMs = 8_000,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async check(leaf: NodeCertificate, issuer: NodeCertificate, signedAt: Date | null): Promise<RevocationResult> {
    const cert = new X509Certificate(leaf.raw);
    const ext = cert.getExtension(CRLDistributionPointsExtension);
    const urls = (ext?.distributionPoints ?? [])
      .flatMap((d) => d.distributionPoint?.fullName ?? [])
      .map((n) => n.uniformResourceIdentifier)
      .filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u));
    if (urls.length === 0) return { status: 'NOT_CHECKED', detail: 'Certificado sem endereço de LCR' };

    const erros: string[] = [];
    for (const url of urls) {
      try {
        const crl = await this.load(url, issuer);
        const entrada = crl.findRevoked(cert);
        if (!entrada) return { status: 'GOOD', detail: `LCR de ${crl.thisUpdate.toISOString().slice(0, 10)}` };
        const quando = entrada.revocationDate;
        if (signedAt && quando > signedAt) {
          return { status: 'GOOD', detail: `Revogado em ${quando.toISOString().slice(0, 10)}, depois da emissão da nota` };
        }
        return { status: 'REVOKED', detail: `Revogado em ${quando.toISOString().slice(0, 10)}` };
      } catch (error) {
        erros.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { status: 'UNKNOWN', detail: `LCR indisponível (${erros.join('; ').slice(0, 300)})` };
  }

  private async load(url: string, issuer: NodeCertificate): Promise<X509Crl> {
    const guardada = this.cache.get(url);
    if (guardada && guardada.validUntil > Date.now()) return guardada.crl;

    const resposta = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.timeoutMs), redirect: 'follow' });
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    const tamanho = Number(resposta.headers.get('content-length') ?? 0);
    if (tamanho > MAX_LCR_BYTES) throw new Error('LCR grande demais');
    const bytes = Buffer.from(await resposta.arrayBuffer());
    if (bytes.length > MAX_LCR_BYTES) throw new Error('LCR grande demais');

    const texto = bytes.subarray(0, 30).toString('latin1');
    const crl = new X509Crl(texto.includes('-----BEGIN') ? bytes.toString('latin1') : new Uint8Array(bytes));
    if (!(await crl.verify({ publicKey: new X509Certificate(issuer.raw) }))) throw new Error('assinatura da LCR não confere com a AC');
    const proxima = crl.nextUpdate?.getTime() ?? Date.now();
    if (proxima < Date.now()) throw new Error('LCR vencida');
    this.cache.set(url, { crl, validUntil: Math.min(proxima, Date.now() + MAX_CACHE_MS) });
    return crl;
  }
}
