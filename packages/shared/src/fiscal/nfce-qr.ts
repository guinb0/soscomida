import { decimalToCents } from '../money';
import { type AccessKey, parseAccessKey } from './access-key';

/**
 * Conteúdo do QR Code impresso no cupom de NFC-e. O QR é uma URL da SEFAZ da
 * UF com os dados no parâmetro `p` (versões 2 e 3), separados por `|`:
 *
 *   online:  chave|versão|ambiente|...
 *   offline: chave|versão|ambiente|dia da emissão|valor total|...
 *
 * Versões antigas (1.x) usam parâmetros nomeados (`chNFe`, `tpAmb`, `vNF`).
 * Só a chave (posição 1) e o ambiente (posição 3) são lidos sempre; dia e
 * valor só quando o QR tem o formato offline da versão 2. A posição exata dos
 * campos da versão 3 não foi confirmada em norma técnica — nela, só chave e
 * ambiente são usados. A chave passa pela validação estrutural com DV.
 */
export interface NfceQrData {
  accessKey: AccessKey;
  /** Endereço de consulta impresso (domínio da SEFAZ), quando há. */
  consultationUrl: string | null;
  version: string | null;
  /** 1 = produção; 2 = homologação (documento sem valor fiscal). */
  environment: 1 | 2 | null;
  /** Valor total em centavos, só quando o QR o informa (emissão offline). */
  totalCents: number | null;
}

export type NfceQrResult = { ok: true; value: NfceQrData } | { ok: false; error: 'SEM_CHAVE' | 'CHAVE_INVALIDA' | 'NAO_E_NFCE' };

/** Separa endereço e parâmetros sem depender de `URL` (o pacote não assume runtime). */
function campos(texto: string): { url: string | null; p: string | null; params: Map<string, string> | null } {
  const limpo = texto.trim();
  const m = /^(https?:\/\/[^?#\s]+)\?([^#\s]*)/i.exec(limpo);
  if (!m) {
    // Alguns leitores devolvem só o conteúdo de `p`.
    return { url: null, p: limpo.includes('|') ? limpo : null, params: null };
  }
  const params = new Map<string, string>();
  for (const par of m[2]!.split('&')) {
    const [k, ...v] = par.split('=');
    if (!k) continue;
    try {
      params.set(decodeURIComponent(k), decodeURIComponent(v.join('=').replace(/\+/g, ' ')));
    } catch {
      params.set(k, v.join('='));
    }
  }
  return { url: m[1]!, p: params.get('p') ?? null, params };
}

const ambiente = (v: string | null | undefined): 1 | 2 | null => (v === '1' ? 1 : v === '2' ? 2 : null);

const valor = (v: string | null | undefined): number | null => {
  if (!v || !/^\d+(\.\d{1,2})?$/.test(v)) return null;
  return decimalToCents(v);
};

export function parseNfceQrCode(texto: string): NfceQrResult {
  const { url, p, params } = campos(texto);

  let chave: string | null = null;
  let versao: string | null = null;
  let amb: 1 | 2 | null = null;
  let total: number | null = null;

  if (p) {
    const partes = p.split('|');
    chave = partes[0] ?? null;
    versao = partes[1] ?? null;
    amb = ambiente(partes[2]);
    if (versao === '2' && partes.length >= 8) total = valor(partes[4]);
  } else if (params?.get('chNFe')) {
    chave = params.get('chNFe') ?? null;
    versao = params.get('nVersao') ?? null;
    amb = ambiente(params.get('tpAmb'));
    total = valor(params.get('vNF'));
  }

  if (!chave || !/^\d{44}$/.test(chave)) return { ok: false, error: 'SEM_CHAVE' };
  const resultado = parseAccessKey(chave);
  if (!resultado.ok) return { ok: false, error: 'CHAVE_INVALIDA' };
  if (resultado.value.model !== 'NFCE_65') return { ok: false, error: 'NAO_E_NFCE' };

  return { ok: true, value: { accessKey: resultado.value, consultationUrl: url, version: versao, environment: amb, totalCents: total } };
}
