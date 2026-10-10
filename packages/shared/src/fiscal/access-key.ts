import { isValidCnpj, isValidCpf, onlyDigits } from '../documents';

/**
 * Chave de acesso de NF-e/NFC-e (44 dígitos):
 *
 *   cUF(2) AAMM(4) CNPJ/CPF emitente(14) modelo(2) série(3) número(9)
 *   tpEmis(1) código numérico(8) DV(1)
 *
 * Validar a estrutura e o dígito verificador descarta leituras erradas de
 * OCR/QR antes de qualquer consulta externa. Uma chave estruturalmente válida
 * **não** prova que o documento existe ou foi autorizado — isso é papel de um
 * FiscalVerificationProvider.
 */

/** Códigos IBGE das UFs. */
const UF_POR_CODIGO: Record<string, string> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
  '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS',
  '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};

export type FiscalModel = 'NFE_55' | 'NFCE_65';

export interface AccessKey {
  key: string;
  uf: string;
  ufCode: string;
  issueYear: number;
  issueMonth: number;
  issuerDocument: string;
  issuerDocumentType: 'CNPJ' | 'CPF';
  model: FiscalModel;
  series: number;
  number: number;
  emissionType: number;
  numericCode: string;
  checkDigit: number;
}

export type AccessKeyError =
  | 'FORMATO'
  | 'UF_INVALIDA'
  | 'DATA_INVALIDA'
  | 'MODELO_NAO_SUPORTADO'
  | 'EMITENTE_INVALIDO'
  | 'DIGITO_VERIFICADOR';

export type AccessKeyResult = { ok: true; value: AccessKey } | { ok: false; error: AccessKeyError };

/** DV da chave: módulo 11 com pesos 2..9 da direita para a esquerda. */
export function accessKeyCheckDigit(first43: string): number {
  let peso = 2;
  let soma = 0;
  for (let i = first43.length - 1; i >= 0; i--) {
    soma += Number(first43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

export function parseAccessKey(input: string): AccessKeyResult {
  const key = onlyDigits(input);
  if (key.length !== 44) return { ok: false, error: 'FORMATO' };

  const ufCode = key.slice(0, 2);
  const uf = UF_POR_CODIGO[ufCode];
  if (!uf) return { ok: false, error: 'UF_INVALIDA' };

  const ano = 2000 + Number(key.slice(2, 4));
  const mes = Number(key.slice(4, 6));
  if (mes < 1 || mes > 12) return { ok: false, error: 'DATA_INVALIDA' };

  const modelo = key.slice(20, 22);
  if (modelo !== '55' && modelo !== '65') return { ok: false, error: 'MODELO_NAO_SUPORTADO' };

  const documento = key.slice(6, 20);
  // Emitente pessoa física aparece como CPF com 3 zeros à esquerda.
  const ehCpf = documento.startsWith('000') && isValidCpf(documento.slice(3)) && !isValidCnpj(documento);
  if (!ehCpf && !isValidCnpj(documento)) return { ok: false, error: 'EMITENTE_INVALIDO' };

  const dv = Number(key[43]);
  if (accessKeyCheckDigit(key.slice(0, 43)) !== dv) return { ok: false, error: 'DIGITO_VERIFICADOR' };

  return {
    ok: true,
    value: {
      key,
      uf,
      ufCode,
      issueYear: ano,
      issueMonth: mes,
      issuerDocument: ehCpf ? documento.slice(3) : documento,
      issuerDocumentType: ehCpf ? 'CPF' : 'CNPJ',
      model: modelo === '55' ? 'NFE_55' : 'NFCE_65',
      series: Number(key.slice(22, 25)),
      number: Number(key.slice(25, 34)),
      emissionType: Number(key[34]),
      numericCode: key.slice(35, 43),
      checkDigit: dv,
    },
  };
}
