import type { LlmProvider, LlmRequest, LlmResponse } from '../domain/llm';

export type SimulatedResponder = (data: unknown) => unknown;

/**
 * SÓ DESENVOLVIMENTO E TESTES. Não é IA: cada versão de prompt registra uma
 * função determinística (regras de palavras-chave) que devolve uma resposta
 * no formato esperado. Serve para exercitar o fluxo inteiro sem custo e sem
 * mandar dados para fora. Proibido em produção (config).
 */
export class SimulatedLlmProvider implements LlmProvider {
  readonly name = 'simulated';
  private readonly responders = new Map<string, SimulatedResponder>();

  register(promptVersion: string, responder: SimulatedResponder): void {
    this.responders.set(promptVersion, responder);
  }

  complete(req: LlmRequest): Promise<LlmResponse> {
    const responder = this.responders.get(req.promptVersion);
    if (!responder) return Promise.reject(new Error(`Sem resposta simulada para ${req.promptVersion}`));
    const texto = JSON.stringify(responder(req.data));
    return Promise.resolve({
      text: texto,
      model: 'simulado-regras-locais',
      inputTokens: Math.ceil((req.system.length + JSON.stringify(req.data).length) / 4),
      outputTokens: Math.ceil(texto.length / 4),
    });
  }
}
