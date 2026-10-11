import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { INTENT_STATUSES, type IntentStatus, type ProviderChargeStatus, canTransition, planTransitions } from './intent-status';

const reportados: ProviderChargeStatus[] = ['PENDING', 'CONFIRMED', 'REFUNDED', 'EXPIRED', 'FAILED'];

describe('transições da cobrança', () => {
  it('confirma uma cobrança aguardando pagamento', () => {
    expect(planTransitions('AWAITING_PAYMENT', 'CONFIRMED')).toEqual(['CONFIRMED']);
  });

  it('confirmação repetida não faz nada', () => {
    expect(planTransitions('CONFIRMED', 'CONFIRMED')).toEqual([]);
  });

  it('aceita pagamento depois da expiração local', () => {
    expect(planTransitions('EXPIRED', 'CONFIRMED')).toEqual(['CONFIRMED']);
  });

  it('estorno visto antes da confirmação aplica as duas etapas, em ordem', () => {
    expect(planTransitions('AWAITING_PAYMENT', 'REFUNDED')).toEqual(['CONFIRMED', 'REFUNDED']);
  });

  it('evento atrasado não faz o estado voltar', () => {
    expect(planTransitions('REFUNDED', 'CONFIRMED')).toEqual([]);
    expect(planTransitions('CONFIRMED', 'EXPIRED')).toEqual([]);
    expect(planTransitions('CONFIRMED', 'PENDING')).toEqual([]);
  });

  it('cobrança que falhou não é confirmada depois', () => {
    expect(planTransitions('FAILED', 'CONFIRMED')).toEqual([]);
  });

  it('todo plano é uma cadeia de transições válidas, sem repetir estado (propriedade)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...INTENT_STATUSES), fc.constantFrom(...reportados), (atual, reportado) => {
        const plano = planTransitions(atual, reportado);
        let estado: IntentStatus = atual;
        for (const proximo of plano) {
          expect(canTransition(estado, proximo)).toBe(true);
          estado = proximo;
        }
        expect(new Set(plano).size).toBe(plano.length);
      }),
    );
  });

  it('qualquer ordem de eventos converge para o mesmo estado final (propriedade)', () => {
    // Para a mesma "verdade" no provedor (estornado), a ordem de chegada não importa.
    fc.assert(
      fc.property(fc.shuffledSubarray(['CONFIRMED', 'REFUNDED', 'PENDING', 'CONFIRMED'] as ProviderChargeStatus[], { minLength: 1 }), (eventos) => {
        if (!eventos.includes('REFUNDED')) return;
        let estado: IntentStatus = 'AWAITING_PAYMENT';
        for (const e of eventos) for (const proximo of planTransitions(estado, e)) estado = proximo;
        expect(estado).toBe('REFUNDED');
      }),
    );
  });
});
