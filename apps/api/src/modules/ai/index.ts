import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../infra/config/config';
import { AiService } from './ai.service';
import { LLM_PROVIDER, type LlmProvider } from './domain/llm';
import { OpenAiCompatibleProvider } from './infra/openai-compatible.provider';
import { SimulatedLlmProvider } from './infra/simulated.provider';

export { AiService, type AiOutcome, type AiFailure, type AiBudget } from './ai.service';
export { detectSuspiciousInstructions, type InstructionSignal } from './domain/injection';
export { LLM_PROVIDER, type LlmProvider } from './domain/llm';
export { SimulatedLlmProvider } from './infra/simulated.provider';

function createProvider(config: AppConfig): LlmProvider | null {
  if (config.AI_PROVIDER === 'simulated') return new SimulatedLlmProvider();
  if (config.AI_PROVIDER === 'openai_compatible') {
    return new OpenAiCompatibleProvider({ baseUrl: config.AI_BASE_URL, apiKey: config.AI_API_KEY!, model: config.AI_MODEL! });
  }
  return null;
}

/** IA desacoplada: ninguém fala com o provedor fora daqui (docs/AI_PIPELINE.md). */
@Module({
  providers: [AiService, { provide: LLM_PROVIDER, inject: [APP_CONFIG], useFactory: createProvider }],
  exports: [AiService, LLM_PROVIDER],
})
export class AiModule {}
