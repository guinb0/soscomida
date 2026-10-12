import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { type AiStatus, type ExpenseAnalysis, adherenceOutputSchema } from '@soscomida/contracts';
import { desc, eq } from 'drizzle-orm';
import { DB, type Database } from '../../infra/db/db';
import { newId } from '../../infra/ids';
import { AiService, LLM_PROVIDER, type LlmProvider, SimulatedLlmProvider, detectSuspiciousInstructions } from '../ai';
import { ADHERENCE_PROMPT_VERSION, ADHERENCE_SYSTEM_PROMPT, buildAdherenceCase, simulatedAdherence } from './domain/adherence';
import { RULESET_VERSION, computeRisk } from './domain/risk';
import { ExpensesService } from './expenses.service';
import { expenseAnalyses } from './infra/expenses.schema';

type AnalysisRow = typeof expenseAnalyses.$inferSelect;

/**
 * Análise automática de despesas: regras determinísticas sempre; IA quando
 * configurada e dentro do orçamento. O resultado orienta a fila e a pessoa que
 * revisa — nunca aprova nem recusa nada sozinho.
 */
@Injectable()
export class ExpenseAnalysisService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly expenses: ExpensesService,
    private readonly ai: AiService,
    @Inject(LLM_PROVIDER) provider: LlmProvider | null,
  ) {
    if (provider instanceof SimulatedLlmProvider) provider.register(ADHERENCE_PROMPT_VERSION, simulatedAdherence);
  }

  async analyze(expenseId: string, trigger: 'SUBMITTED' | 'MANUAL', opts: { sourceEventId?: string; requestedBy?: string } = {}): Promise<ExpenseAnalysis> {
    if (opts.sourceEventId) {
      // Entrega repetida do mesmo evento: não chama a IA (nem paga) de novo.
      const [feita] = await this.db.select().from(expenseAnalyses).where(eq(expenseAnalyses.sourceEventId, opts.sourceEventId));
      if (feita) return this.toView(feita);
    }

    const entrada = await this.expenses.analysisInput(expenseId);
    const caso = buildAdherenceCase({
      campaign: entrada.campaign,
      expense: entrada.expense,
      items: entrada.items,
    });
    const sinais = detectSuspiciousInstructions(entrada.texts);
    const ia = await this.ai.analyze({
      purpose: 'expense_adherence',
      subject: { type: 'expense', id: expenseId },
      promptVersion: ADHERENCE_PROMPT_VERSION,
      system: ADHERENCE_SYSTEM_PROMPT,
      data: caso,
      schema: adherenceOutputSchema,
    });
    const aiStatus: AiStatus = ia.ok ? 'COMPLETED' : ia.reason;
    const risco = computeRisk({ flags: entrada.flags, fiscalCheck: entrada.fiscalCheck, ai: { status: aiStatus, output: ia.ok ? ia.output : null } });

    const linha: typeof expenseAnalyses.$inferInsert = {
      id: newId(),
      expenseId,
      expenseVersion: entrada.expense.version,
      trigger,
      sourceEventId: opts.sourceEventId ?? null,
      requestedBy: opts.requestedBy ?? null,
      rulesetVersion: RULESET_VERSION,
      riskScore: risco.score,
      riskLevel: risco.level,
      riskFactors: risco.factors,
      suspiciousInstructions: sinais,
      aiStatus,
      aiProvider: ia.provider,
      aiModel: ia.model,
      promptVersion: ADHERENCE_PROMPT_VERSION,
      aiOutput: ia.ok ? ia.output : null,
      aiDetail: ia.ok ? null : ia.detail,
      inputSha256: createHash('sha256').update(JSON.stringify(caso)).digest('hex'),
    };
    const gravadas = await this.db.insert(expenseAnalyses).values(linha).onConflictDoNothing().returning();
    const gravada = gravadas[0] ?? (await this.db.select().from(expenseAnalyses).where(eq(expenseAnalyses.sourceEventId, opts.sourceEventId!)))[0]!;
    await this.expenses.setRisk(expenseId, gravada.riskScore, gravada.riskLevel);
    return this.toView(gravada);
  }

  async latest(expenseId: string): Promise<ExpenseAnalysis | null> {
    const [l] = await this.db.select().from(expenseAnalyses).where(eq(expenseAnalyses.expenseId, expenseId)).orderBy(desc(expenseAnalyses.createdAt)).limit(1);
    return l ? this.toView(l) : null;
  }

  private toView(l: AnalysisRow): ExpenseAnalysis {
    return {
      id: l.id,
      createdAt: l.createdAt.toISOString(),
      trigger: l.trigger as ExpenseAnalysis['trigger'],
      expenseVersion: l.expenseVersion,
      rulesetVersion: l.rulesetVersion,
      risk: { score: l.riskScore, level: l.riskLevel as ExpenseAnalysis['risk']['level'], factors: l.riskFactors },
      ai: {
        status: l.aiStatus as AiStatus,
        provider: l.aiProvider,
        model: l.aiModel,
        promptVersion: l.promptVersion,
        simulated: l.aiProvider === 'simulated',
        output: l.aiOutput,
        detail: l.aiDetail,
      },
      suspiciousInstructions: l.suspiciousInstructions,
    };
  }
}
