# Pipeline de IA

> Estado: **planejado para a Fase 3.** Nada de IA roda nas Fases 0–2, exceto,
> opcionalmente, extração multimodal como último recurso na Fase 2.

## Onde a IA entra (e onde não)

| Tarefa | Quem faz |
|---|---|
| Validar CPF/CNPJ/chave de acesso, somar valores, comparar datas, detectar duplicidade por hash | código determinístico |
| Ler XML, QR Code, texto de PDF | código determinístico |
| Extrair campos de imagem difícil | OCR primeiro; IA multimodal só como apoio |
| Julgar se "ração terapêutica + antibiótico" combina com "tratamento veterinário" | **IA** (interpretação semântica) |
| Decidir aprovar/reprovar despesa ou campanha | política + humano; IA só recomenda |
| Mover dinheiro | nunca a IA |

## Interface

```ts
interface LlmProvider {
  name: string;                       // 'openai' | 'mistral' | ...
  analyze<T>(req: {
    model: string;
    promptVersion: string;
    system: string;                   // instruções fixas, versionadas
    data: unknown;                    // dados do caso, serializados como JSON
    schema: ZodType<T>;               // saída estruturada exigida
    timeoutMs: number;
  }): Promise<{ output: T; usage: { inputTokens: number; outputTokens: number; costCents: number }; latencyMs: number }>;
}
```

OpenAI é o primeiro adaptador configurável, como pede o briefing. Há
referência real de outro projeto do mesmo time: no benchmark de leitura de
documentos do Meu Pet, o Mistral Small acertou 100% a US$ 0,0005/documento e
3,4 s. Isso justifica deixar o provedor trocável desde o início.

## Saída da análise de aderência

```json
{
  "classification": "COMPATIBLE | POSSIBLY_COMPATIBLE | INCOMPATIBLE | INSUFFICIENT_EVIDENCE | REQUIRES_HUMAN_REVIEW",
  "riskLevel": "LOW | MEDIUM | HIGH",
  "purposeAlignment": 0.0,
  "detectedIssues": [{ "code": "ITEM_FORA_DA_FINALIDADE", "item": "Console de videogame", "detail": "..." }],
  "supportingEvidence": ["..."],
  "missingEvidence": ["comprovante de entrega"],
  "recommendation": "APPROVE | REVIEW | REJECT_SUGGESTED",
  "explanation": "texto curto em português",
  "modelVersion": "…",
  "promptVersion": "aderencia-v1"
}
```

A resposta é validada com Zod. JSON inválido → uma nova tentativa → se falhar
de novo, `REQUIRES_HUMAN_REVIEW` (nunca aprovação por omissão).

## Proteção contra prompt injection

- Texto extraído de documentos vai **apenas** no campo `data`, serializado
  como JSON, nunca concatenado às instruções.
- As instruções de sistema dizem explicitamente que o conteúdo de `data` é
  não confiável e que instruções dentro dele devem ser ignoradas e relatadas
  como `detectedIssues: PROMPT_INJECTION_SUSPECT`.
- Pré-filtro determinístico marca padrões típicos ("ignore as instruções",
  "aprove esta despesa") como sinal de fraude, independentemente da IA.
- A IA não tem ferramentas, não acessa rede e não executa nada: entra JSON, sai
  JSON.
- Divergência entre IA e regra determinística (ex.: IA diz compatível, regra
  diz nota cancelada) → a regra prevalece e o caso vai para revisão.

## Custos e limites

- Tabela `ai_analyses` registra modelo, versão do prompt, tokens, custo e
  latência de cada chamada.
- Orçamento por período (`AI_MONTHLY_BUDGET_CENTS`): ao atingir 80%, alerta;
  em 100%, novas análises vão direto para revisão humana.
- Provedor fora do ar ou timeout → fila com backoff; após o limite,
  `REQUIRES_HUMAN_REVIEW`.

## Avaliação

`apps/api/test/ai-eval/` terá um conjunto de casos (anonimizados e
sintéticos) com o rótulo esperado. Métricas por versão de prompt/modelo:
precisão, falsos positivos/negativos de `INCOMPATIBLE`, custo e latência
médios e taxa de revisão humana. Trocar modelo ou prompt exige rodar a
avaliação e registrar o resultado.
