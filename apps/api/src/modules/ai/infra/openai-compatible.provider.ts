import { type LlmProvider, LlmProviderError, type LlmRequest, type LlmResponse, dataMessage } from '../domain/llm';

export interface OpenAiCompatibleConfig {
  /** Ex.: https://api.openai.com/v1, https://openrouter.ai/api/v1, https://api.mistral.ai/v1 */
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * API de Chat Completions (`POST {baseUrl}/chat/completions`), o formato
 * aceito por OpenAI, OpenRouter e Mistral. Pede JSON (`response_format:
 * json_object`); o esquema vai nas instruções e a saída é validada depois.
 *
 * Testado contra um servidor local que imita a API (openai-compatible.provider.test.ts).
 * Ainda NÃO foi executado contra um provedor real: isso custa dinheiro e
 * depende de autorização (ver docs/AI_PIPELINE.md).
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name = 'openai_compatible';

  constructor(
    private readonly config: OpenAiCompatibleConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async complete(req: LlmRequest): Promise<LlmResponse> {
    let resposta: Response;
    try {
      resposta = await this.fetchImpl(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.config.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: dataMessage(req) },
          ],
        }),
        signal: AbortSignal.timeout(req.timeoutMs),
      });
    } catch (error) {
      const tempo = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new LlmProviderError(tempo ? 'Tempo esgotado' : `Falha de rede: ${error instanceof Error ? error.message : String(error)}`, true);
    }
    if (!resposta.ok) {
      const corpo = (await resposta.text().catch(() => '')).slice(0, 300);
      throw new LlmProviderError(`HTTP ${resposta.status}: ${corpo}`, resposta.status === 429 || resposta.status >= 500);
    }
    const corpo = (await resposta.json()) as {
      model?: string;
      choices?: { message?: { content?: string | null } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const texto = corpo.choices?.[0]?.message?.content;
    if (typeof texto !== 'string') throw new LlmProviderError('Resposta sem conteúdo', true);
    return {
      text: texto,
      model: corpo.model ?? this.config.model,
      inputTokens: corpo.usage?.prompt_tokens ?? 0,
      outputTokens: corpo.usage?.completion_tokens ?? 0,
    };
  }
}
