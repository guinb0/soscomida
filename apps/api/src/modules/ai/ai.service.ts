import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { ZodType } from 'zod';
import { APP_CONFIG, type AppConfig } from '../../infra/config/config';
import { DB, type Database } from '../../infra/db/db';
import { newId } from '../../infra/ids';
import { metrics } from '../../infra/observability/metrics';
import { LLM_PROVIDER, type LlmProvider, costMillicents } from './domain/llm';
import { aiCalls } from './infra/ai.schema';

export interface AiRequest<T> {
  purpose: string;
  subject: { type: string; id: string };
  promptVersion: string;
  system: string;
  data: unknown;
  schema: ZodType<T>;
}

export type AiFailure = 'NO_PROVIDER' | 'BUDGET_EXHAUSTED' | 'INVALID_OUTPUT' | 'PROVIDER_ERROR';

export type AiOutcome<T> =
  | { ok: true; output: T; provider: string; model: string; attempts: number }
  | { ok: false; reason: AiFailure; provider: string; model: string | null; detail: string | null; attempts: number };

export interface AiBudget {
  provider: string;
  enforced: boolean;
  budgetCents: number;
  spentMillicents: number;
  /** 0–100 (inteiro, arredondado para baixo). */
  usedPercent: number;
}

const ALERTA_ORCAMENTO = 80;

/** Tira cercas de bloco de código que alguns modelos põem em volta do JSON. */
function extrairJson(texto: string): unknown {
  const limpo = texto
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  return JSON.parse(limpo);
}

/**
 * Porta única para IA. Garante: saída validada (Zod) com uma nova tentativa
 * se vier inválida; orçamento mensal; registro de cada chamada (tokens, custo,
 * latência). Nunca lança por causa da IA: devolve `ok: false` com o motivo, e
 * quem chamou manda o caso para revisão humana.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(LLM_PROVIDER) private readonly provider: LlmProvider | null,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get providerName(): string {
    return this.provider?.name ?? 'none';
  }

  /** Orçamento só vale para provedor pago (o simulado não custa nada). */
  private get budgetEnforced(): boolean {
    return this.provider !== null && this.provider.name !== 'simulated';
  }

  async budget(): Promise<AiBudget> {
    const [r] = await this.db
      .select({ gasto: sql<string>`coalesce(sum(${aiCalls.costMillicents}), 0)::text` })
      .from(aiCalls)
      .where(sql`${aiCalls.createdAt} >= date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'`);
    const gasto = Number(r?.gasto ?? 0);
    const limite = this.config.AI_MONTHLY_BUDGET_CENTS * 1000;
    return {
      provider: this.providerName,
      enforced: this.budgetEnforced,
      budgetCents: this.config.AI_MONTHLY_BUDGET_CENTS,
      spentMillicents: gasto,
      usedPercent: limite > 0 ? Math.floor((gasto * 100) / limite) : 0,
    };
  }

  async analyze<T>(req: AiRequest<T>): Promise<AiOutcome<T>> {
    const provider = this.provider;
    if (!provider) return { ok: false, reason: 'NO_PROVIDER', provider: 'none', model: null, detail: null, attempts: 0 };

    if (this.budgetEnforced) {
      const b = await this.budget();
      if (b.usedPercent >= 100) {
        this.logger.warn({ spentMillicents: b.spentMillicents }, 'Orçamento mensal de IA esgotado: análises vão direto para revisão humana');
        return { ok: false, reason: 'BUDGET_EXHAUSTED', provider: provider.name, model: null, detail: `Gasto do mês: ${b.usedPercent}% do orçamento`, attempts: 0 };
      }
      if (b.usedPercent >= ALERTA_ORCAMENTO) this.logger.warn({ usedPercent: b.usedPercent }, 'Orçamento mensal de IA acima de 80%');
    }

    let retryNote: string | undefined;
    let modelo: string | null = null;
    let ultimoErro = '';
    for (let tentativa = 1; tentativa <= 2; tentativa++) {
      const inicio = Date.now();
      try {
        const r = await provider.complete({
          promptVersion: req.promptVersion,
          system: req.system,
          data: req.data,
          timeoutMs: this.config.AI_TIMEOUT_MS,
          ...(retryNote ? { retryNote } : {}),
        });
        modelo = r.model;
        let saida: T | null = null;
        try {
          const v = req.schema.safeParse(extrairJson(r.text));
          if (v.success) saida = v.data;
          else ultimoErro = v.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
        } catch {
          ultimoErro = 'Resposta não é JSON';
        }
        await this.record(req, provider.name, r.model, saida ? 'OK' : 'INVALID_OUTPUT', r.inputTokens, r.outputTokens, Date.now() - inicio, saida ? null : ultimoErro);
        if (saida) return { ok: true, output: saida, provider: provider.name, model: r.model, attempts: tentativa };
        retryNote = `A resposta anterior foi recusada (${ultimoErro.slice(0, 200)}). Responda SOMENTE com o objeto JSON no formato pedido.`;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        await this.record(req, provider.name, modelo, 'ERROR', 0, 0, Date.now() - inicio, msg);
        return { ok: false, reason: 'PROVIDER_ERROR', provider: provider.name, model: modelo, detail: msg.slice(0, 300), attempts: tentativa };
      }
    }
    return { ok: false, reason: 'INVALID_OUTPUT', provider: provider.name, model: modelo, detail: ultimoErro.slice(0, 300), attempts: 2 };
  }

  private async record(
    req: AiRequest<unknown>,
    provider: string,
    model: string | null,
    status: 'OK' | 'INVALID_OUTPUT' | 'ERROR',
    inputTokens: number,
    outputTokens: number,
    latencyMs: number,
    error: string | null,
  ): Promise<void> {
    const custo =
      provider === 'simulated'
        ? 0
        : costMillicents(inputTokens, outputTokens, {
            inputCentsPerMTok: this.config.AI_INPUT_PRICE_CENTS_PER_MTOK ?? 0,
            outputCentsPerMTok: this.config.AI_OUTPUT_PRICE_CENTS_PER_MTOK ?? 0,
          });
    await this.db.insert(aiCalls).values({
      id: newId(),
      purpose: req.purpose,
      subjectType: req.subject.type,
      subjectId: req.subject.id,
      provider,
      model,
      promptVersion: req.promptVersion,
      status,
      inputTokens,
      outputTokens,
      costMillicents: custo,
      latencyMs,
      error: error?.slice(0, 1000) ?? null,
    });
    metrics.aiCalls.inc({ provider, purpose: req.purpose, status });
    if (custo) metrics.aiCostMillicents.inc({ provider, purpose: req.purpose }, custo);
  }
}
