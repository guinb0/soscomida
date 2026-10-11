/** Validação de CPF e CNPJ pelos dígitos verificadores (módulo 11). */

export const onlyDigits = (value: string): string => value.replace(/\D/g, '');

export function isValidCpf(value: string): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  const digito = (base: string, pesoInicial: number) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (pesoInicial - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  const d1 = digito(cpf.slice(0, 9), 10);
  const d2 = digito(cpf.slice(0, 10), 11);
  return d1 === Number(cpf[9]) && d2 === Number(cpf[10]);
}

export function isValidCnpj(value: string): boolean {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;

  const digito = (base: string) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((total, peso, i) => total + Number(base[i]) * peso, 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const d1 = digito(cnpj.slice(0, 12));
  const d2 = digito(cnpj.slice(0, 13));
  return d1 === Number(cnpj[12]) && d2 === Number(cnpj[13]);
}

/** "123.456.789-09" → "***.456.789-**": formato usado em qualquer exibição pública. */
export function maskCpf(value: string): string {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11) return '***';
  return `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`;
}

/** "11222333000181" → "11.222.333/0001-81". CNPJ é dado de empresa e pode ser público. */
export function formatCnpj(value: string): string {
  const c = onlyDigits(value);
  if (c.length !== 14) return value;
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}

/** Documento de fornecedor para exibição pública: CNPJ formatado, CPF sempre mascarado. */
export function publicSupplierDocument(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = onlyDigits(value);
  if (d.length === 14) return formatCnpj(d);
  if (d.length === 11) return maskCpf(d);
  return null;
}
