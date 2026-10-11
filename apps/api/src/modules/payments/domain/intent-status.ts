/**
 * Estados de uma cobrança e como ela reage ao que o provedor reporta.
 *
 * O estado só avança. Eventos atrasados ou fora de ordem não fazem voltar;
 * quando o provedor reporta algo "à frente" pulando etapas (ex.: estornado
 * sem nunca termos visto a confirmação), as etapas intermediárias são
 * aplicadas em sequência para o ledger contar a história inteira.
 */
export const INTENT_STATUSES = ['CREATED', 'AWAITING_PAYMENT', 'CONFIRMED', 'REFUNDED', 'EXPIRED', 'FAILED'] as const;
export type IntentStatus = (typeof INTENT_STATUSES)[number];

/** Estado normalizado que os adaptadores devolvem ao consultar o provedor. */
export type ProviderChargeStatus = 'PENDING' | 'CONFIRMED' | 'REFUNDED' | 'EXPIRED' | 'FAILED';

const NEXT: Record<IntentStatus, readonly IntentStatus[]> = {
  CREATED: ['AWAITING_PAYMENT', 'FAILED'],
  AWAITING_PAYMENT: ['CONFIRMED', 'EXPIRED', 'FAILED'],
  // Pagamento depois da expiração local: o dinheiro entrou e precisa ser contabilizado.
  EXPIRED: ['CONFIRMED'],
  CONFIRMED: ['REFUNDED'],
  REFUNDED: [],
  FAILED: [],
};

export const canTransition = (from: IntentStatus, to: IntentStatus): boolean => NEXT[from].includes(to);

/**
 * Sequência de estados a aplicar, dado o estado local e o que o provedor
 * reportou. Lista vazia = nada a fazer (repetido, atrasado ou incompatível).
 */
export function planTransitions(current: IntentStatus, reported: ProviderChargeStatus): IntentStatus[] {
  switch (reported) {
    case 'PENDING':
      return [];
    case 'CONFIRMED':
      return canTransition(current, 'CONFIRMED') ? ['CONFIRMED'] : [];
    case 'REFUNDED':
      if (current === 'CONFIRMED') return ['REFUNDED'];
      if (canTransition(current, 'CONFIRMED')) return ['CONFIRMED', 'REFUNDED'];
      return [];
    case 'EXPIRED':
      return current === 'AWAITING_PAYMENT' ? ['EXPIRED'] : [];
    case 'FAILED':
      return canTransition(current, 'FAILED') ? ['FAILED'] : [];
  }
}
