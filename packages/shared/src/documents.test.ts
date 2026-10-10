import { describe, expect, it } from 'vitest';
import { isValidCnpj, isValidCpf, maskCpf } from './documents';
import { slugify } from './slug';

describe('CPF e CNPJ', () => {
  it('aceita documentos com dígitos verificadores corretos', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
  });

  it('recusa dígito errado, sequência repetida e tamanho errado', () => {
    expect(isValidCpf('529.982.247-26')).toBe(false);
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(isValidCpf('1234')).toBe(false);
    expect(isValidCnpj('11.222.333/0001-80')).toBe(false);
    expect(isValidCnpj('00000000000000')).toBe(false);
  });

  it('mascara CPF para exibição pública', () => {
    expect(maskCpf('52998224725')).toBe('***.982.247-**');
  });
});

describe('slug', () => {
  it('remove acentos e pontuação', () => {
    expect(slugify('Cestas básicas para Ceilândia!')).toBe('cestas-basicas-para-ceilandia');
    expect(slugify('  --Ração & Remédio--  ')).toBe('racao-remedio');
  });
});
