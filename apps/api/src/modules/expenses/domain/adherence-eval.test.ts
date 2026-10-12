import { adherenceOutputSchema } from '@soscomida/contracts';
import { describe, expect, it } from 'vitest';
import { simulatedAdherence } from './adherence';
import { EVAL_CASES, runEvaluation } from './adherence-eval';

describe('avaliação da análise de aderência', () => {
  it('casos sintéticos cobrem os três grupos e as tentativas de manipulação', () => {
    const grupos = new Set(EVAL_CASES.map((c) => c.expected));
    expect(grupos).toEqual(new Set(['ok', 'alerta', 'insuficiente']));
    expect(EVAL_CASES.filter((c) => c.injection).length).toBeGreaterThanOrEqual(2);
    expect(new Set(EVAL_CASES.map((c) => c.id)).size).toBe(EVAL_CASES.length);
  });

  it('o harness mede acertos, falsos positivos/negativos e injeções (com o simulador)', async () => {
    // O simulador é regra de palavra-chave: só prova que o harness funciona,
    // não mede a qualidade de um modelo.
    const r = await runEvaluation((c) => Promise.resolve({ output: adherenceOutputSchema.parse(simulatedAdherence(c.data)), latencyMs: 1 }));
    expect(r.total).toBe(EVAL_CASES.length);
    expect(r.failures).toBe(0);
    expect(r.falseNegatives).toBe(0);
    expect(r.injectionCaught).toBe(r.injectionCases);
    expect(r.correct + r.results.filter((x) => x.got !== x.expected).length).toBe(r.total);
  });

  it('falha do provedor conta como falha, não como acerto', async () => {
    const r = await runEvaluation(() => Promise.resolve({ output: null, latencyMs: 0 }), EVAL_CASES.slice(0, 2));
    expect(r).toMatchObject({ failures: 2, correct: 0, accuracy: 0 });
  });
});
