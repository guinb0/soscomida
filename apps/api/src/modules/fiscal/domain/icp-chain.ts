import { X509Certificate } from 'node:crypto';

/**
 * Repositório de confiança: raízes (autoassinadas) e ACs intermediárias. Em
 * produção, só a ICP-Brasil (assets/icp-brasil). A cadeia é montada a partir
 * do certificado do XML, conferindo assinatura e validade de cada elo na data
 * de emissão da nota (modelo de cadeia da ICP-Brasil). Revogação (LCR) não é
 * consultada.
 */
export interface ChainResult {
  trusted: boolean;
  /** Nomes (CN) do certificado até a raiz, na ordem. */
  chain: string[];
  problem: string | null;
}

const MAX_PROFUNDIDADE = 8;

const cn = (c: X509Certificate) => /(?:^|\n)CN=([^\n]+)/.exec(c.subject)?.[1]?.trim() ?? c.subject.replace(/\n/g, ', ');

const assinadoPor = (filho: X509Certificate, pai: X509Certificate) => {
  try {
    return filho.checkIssued(pai) && filho.verify(pai.publicKey);
  } catch {
    // Chave em algoritmo que o OpenSSL não lê: não serve de elo.
    return false;
  }
};

const valido = (c: X509Certificate, em: Date) => em >= new Date(c.validFrom) && em <= new Date(c.validTo);

export class TrustStore {
  private readonly raizes: Set<string>;

  private constructor(private readonly certs: X509Certificate[]) {
    this.raizes = new Set(certs.filter((c) => c.subject === c.issuer && assinadoPor(c, c)).map((c) => c.fingerprint256));
  }

  static fromPem(...pems: string[]): TrustStore {
    const certs: X509Certificate[] = [];
    for (const pem of pems) {
      for (const bloco of pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? []) certs.push(new X509Certificate(bloco));
    }
    return new TrustStore(certs);
  }

  get size(): number {
    return this.certs.length;
  }

  get rootCount(): number {
    return this.raizes.size;
  }

  chainFor(folha: X509Certificate, emitidaEm: Date | null): ChainResult {
    const cadeia = [cn(folha)];
    let atual = folha;
    for (let n = 0; n < MAX_PROFUNDIDADE; n++) {
      if (this.raizes.has(atual.fingerprint256)) return { trusted: true, chain: cadeia, problem: null };
      if (atual.subject === atual.issuer && assinadoPor(atual, atual)) {
        return { trusted: false, chain: cadeia, problem: 'Certificado autoassinado fora da ICP-Brasil' };
      }
      const emissor = this.certs.find((c) => assinadoPor(atual, c));
      if (!emissor) return { trusted: false, chain: cadeia, problem: 'Certificado não emitido por AC da ICP-Brasil' };
      if (emitidaEm && !valido(emissor, emitidaEm)) {
        return { trusted: false, chain: [...cadeia, cn(emissor)], problem: `AC ${cn(emissor)} fora da validade na data de emissão` };
      }
      cadeia.push(cn(emissor));
      atual = emissor;
    }
    return { trusted: false, chain: cadeia, problem: 'Cadeia de certificação longa demais' };
  }
}
