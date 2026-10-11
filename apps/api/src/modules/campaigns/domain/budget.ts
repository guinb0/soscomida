import type { BudgetItemInput } from '@soscomida/contracts';
import { addCents } from '@soscomida/shared';

export type BudgetProblem = 'EMPTY' | 'TOTAL_DIFFERS_FROM_GOAL';

/**
 * O orçamento planejado precisa fechar com a meta: é contra ele que as
 * despesas serão comparadas na prestação de contas (Fase 2).
 */
export function validateBudget(goalCents: number, items: Pick<BudgetItemInput, 'plannedCents'>[]): BudgetProblem | null {
  if (items.length === 0) return 'EMPTY';
  const total = addCents(...items.map((i) => i.plannedCents));
  return total === goalCents ? null : 'TOTAL_DIFFERS_FROM_GOAL';
}
