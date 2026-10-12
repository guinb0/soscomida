import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { adherenceOutputSchema } from '@soscomida/contracts';
import { AiService } from '../modules/ai';
import { ADHERENCE_PROMPT_VERSION, ADHERENCE_SYSTEM_PROMPT } from '../modules/expenses/domain/adherence';
import { runEvaluation } from '../modules/expenses/domain/adherence-eval';
import { WorkerModule } from '../worker/worker.module';

/**
 * Roda o conjunto de avaliação contra o provedor de IA configurado (AI_PROVIDER).
 * Com provedor pago, CUSTA DINHEIRO (dentro do orçamento mensal) e manda os
 * casos sintéticos para fora. Uso: pnpm --filter @soscomida/api ai-eval
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['error', 'warn'] });
  const ai = app.get(AiService);
  console.warn(`Provedor: ${ai.providerName} · prompt ${ADHERENCE_PROMPT_VERSION}`);
  if (ai.providerName === 'none') {
    console.error('AI_PROVIDER=none: nada para avaliar.');
    await app.close();
    process.exit(1);
  }

  const resumo = await runEvaluation(async (c) => {
    const inicio = Date.now();
    const r = await ai.analyze({
      purpose: 'ai_eval',
      subject: { type: 'eval_case', id: '00000000-0000-4000-8000-000000000000' },
      promptVersion: ADHERENCE_PROMPT_VERSION,
      system: ADHERENCE_SYSTEM_PROMPT,
      data: c.data,
      schema: adherenceOutputSchema,
    });
    if (!r.ok) console.warn(`  ${c.id}: ${r.reason} ${r.detail ?? ''}`);
    return { output: r.ok ? r.output : null, latencyMs: Date.now() - inicio };
  });
  const orcamento = await ai.budget();

  for (const r of resumo.results) {
    console.warn(`${r.got === r.expected ? 'ok  ' : 'ERRO'} ${r.id.padEnd(24)} esperado=${r.expected.padEnd(12)} obtido=${String(r.got).padEnd(12)} ${r.classification ?? ''}`);
  }
  console.warn(
    `\nAcerto: ${resumo.correct}/${resumo.total} (${Math.round(resumo.accuracy * 100)}%) · falsos negativos (alerta que passou): ${resumo.falseNegatives} · ` +
      `falsos positivos: ${resumo.falsePositives} · falhas: ${resumo.failures} · injeções detectadas: ${resumo.injectionCaught}/${resumo.injectionCases} · ` +
      `latência média: ${resumo.avgLatencyMs} ms · gasto do mês: ${(orcamento.spentMillicents / 1000).toFixed(3)} centavos (${orcamento.usedPercent}% do orçamento)`,
  );

  const pasta = path.resolve('ai-eval-results');
  mkdirSync(pasta, { recursive: true });
  const arquivo = path.join(pasta, `${new Date().toISOString().replace(/[:.]/g, '-')}-${ai.providerName}-${ADHERENCE_PROMPT_VERSION}.json`);
  writeFileSync(arquivo, JSON.stringify({ provider: ai.providerName, promptVersion: ADHERENCE_PROMPT_VERSION, ...resumo }, null, 2));
  console.warn(`Resultado salvo em ${arquivo}`);
  await app.close();
}

void main();
