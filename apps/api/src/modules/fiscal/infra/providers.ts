import type IORedis from 'ioredis';
import type { FiscalDocumentRef, FiscalVerificationProvider, FiscalVerificationResult } from '../domain/verification';

/**
 * Provedor padrão enquanto não há integração oficial contratada. Não consulta
 * nada e diz por quê: o webservice da SEFAZ exige certificado digital
 * ICP-Brasil da empresa consulente, e os portais de consulta pública exigem
 * CAPTCHA (que não contornamos). A despesa segue para revisão humana.
 */
export class NoIntegrationFiscalProvider implements FiscalVerificationProvider {
  readonly name = 'none';

  supports(): boolean {
    return true;
  }

  verify(doc: FiscalDocumentRef): Promise<FiscalVerificationResult> {
    return Promise.resolve({
      status: 'UNVERIFIABLE',
      reason: 'NO_INTEGRATION',
      details: `Sem integração oficial para ${doc.model === 'NFE_55' ? 'NF-e' : 'NFC-e'} de ${doc.uf}: a consulta automática exige certificado digital ICP-Brasil (decisão pendente).`,
    });
  }
}

type DevStatus = 'AUTHORIZED' | 'CANCELLED' | 'NOT_FOUND' | 'DIVERGENT';

/**
 * SÓ DESENVOLVIMENTO E TESTES. Responde o que for combinado por chave via
 * `simulate` (endpoint /api/dev/fiscal). Sem combinação, devolve
 * UNVERIFIABLE. A evidência é marcada como simulada.
 */
export class DevFiscalVerificationProvider implements FiscalVerificationProvider {
  readonly name = 'dev';

  constructor(private readonly redis: IORedis) {}

  supports(): boolean {
    return true;
  }

  async simulate(accessKey: string, status: DevStatus): Promise<void> {
    await this.redis.set(`dev:fiscal:${accessKey}`, status, 'EX', 24 * 3600);
  }

  async verify(doc: FiscalDocumentRef): Promise<FiscalVerificationResult> {
    const combinado = (await this.redis.get(`dev:fiscal:${doc.accessKey}`)) as DevStatus | null;
    if (!combinado) return { status: 'UNVERIFIABLE', reason: 'NO_INTEGRATION', details: 'Provedor de desenvolvimento sem resultado combinado' };
    const evidence = { method: 'SIMULADO (desenvolvimento)', observedAt: new Date().toISOString(), summary: { simulated: true, status: combinado } };
    if (combinado === 'AUTHORIZED') return { status: 'AUTHORIZED', evidence };
    return { status: combinado, evidence, details: `Resultado simulado: ${combinado}` };
  }

  close(): void {
    this.redis.disconnect();
  }
}
