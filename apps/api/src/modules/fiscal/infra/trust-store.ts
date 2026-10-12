import { readFileSync } from 'node:fs';
import path from 'node:path';
import { TrustStore } from '../domain/icp-chain';

/** apps/api/assets: mesma profundidade a partir de src/ e de dist/. */
export const ICP_BRASIL_BUNDLE = path.resolve(__dirname, '../../../../assets/icp-brasil/acs-icp-brasil.pem');

export const FISCAL_TRUST_STORE = Symbol('FISCAL_TRUST_STORE');

/**
 * ACs da ICP-Brasil + âncoras extras (só desenvolvimento/testes, para os
 * certificados fictícios; a configuração proíbe em produção).
 */
export function loadTrustStore(extras: string[] = []): TrustStore {
  return TrustStore.fromPem(readFileSync(ICP_BRASIL_BUNDLE, 'utf8'), ...extras.map((f) => readFileSync(f, 'utf8')));
}
