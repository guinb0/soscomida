# Pipeline de IA

> Estado (2026-10-12): **implementado na Fase 3, sem nenhuma chamada a
> provedor real.** O fluxo inteiro roda com o provedor `simulated` (regras de
> palavras-chave, só dev/test) e o adaptador real foi testado contra um
> servidor local que imita a API. Ligar um modelo de verdade custa dinheiro e
> manda dados para fora: depende de autorização (ver "Como ligar").
>
> | Parte | Onde | Situação |
> |---|---|---|
> | Porta única para IA (`AiService`): validação Zod, 1 nova tentativa, registro de cada chamada, orçamento mensal | `modules/ai` | feito |
> | Adaptador Chat Completions (OpenAI, OpenRouter, Mistral) | `ai/infra/openai-compatible.provider.ts` | feito, **não executado contra provedor real** |
> | Provedor simulado (dev/test; proibido em produção) | `ai/infra/simulated.provider.ts` | feito |
> | Pré-filtro determinístico de prompt injection | `ai/domain/injection.ts` | feito (vira alerta `SUSPICIOUS_INSTRUCTIONS`) |
> | Análise de aderência (prompt `aderencia-v1`) | `expenses/domain/adherence.ts` | feito |
> | Motor de risco com pontuação versionada (`risco-v1`) | `expenses/domain/risk.ts` | feito |
> | Fila de revisão por risco, painel da análise, reanálise manual | `expenses` + `/moderacao/despesas` | feito |
> | Contestação (uma por despesa, outra pessoa revisa) | `ExpensesService.appeal` | feito |
> | Avaliação automatizada | `expenses/domain/adherence-eval.ts` + `pnpm --filter @soscomida/api ai-eval` | feito; **só rodada com o simulador** |
> | OCR de foto sem QR e de PDF escaneado (local, Tesseract) | `fiscal/infra/receipt-ocr.ts` | feito; IA multimodal **não** usada |
> | Política de risco editável pela administração (versões só-inserção) | `/moderacao/risco` + `RiskPolicyService` | feito |

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

## Como funciona hoje

1. A despesa entra na fila (envio ou contestação) → evento `ExpenseStatusChanged`
   → o worker roda `ExpenseAnalysisService.analyze`. Entrega repetida do mesmo
   evento não chama a IA de novo (`source_event_id` único).
2. Alertas determinísticos são recalculados (inclui assinatura do XML, imagem
   parecida por hash perceptual e instruções embutidas).
3. Os dados do caso são montados com minimização (sem nomes de pessoas, CPF,
   chave de acesso ou arquivos; fornecedor pessoa física vai sem nome) e
   enviados como JSON numa mensagem separada, marcada como não confiável.
4. Saída validada; inválida duas vezes, provedor fora do ar, orçamento
   esgotado ou IA desligada → a análise fica só com as regras e o motivo é
   mostrado. Nunca há aprovação por omissão.
5. Risco = soma de pontos das regras + da IA (a IA só soma, nunca reduz),
   teto 100; ≥ 50 alto, ≥ 20 médio. Sinais "duros" (nota cancelada/não
   encontrada/divergente, assinatura inválida, arquivo duplicado, nota de
   homologação) = alto direto. IA recomendando aprovar com regras em risco
   alto fica marcado como divergência.
6. A análise vai para `expense_analyses` (só inserção) e o risco é projetado em
   `expenses.risk_score` para ordenar a fila. Organizador e público **não**
   veem a análise.

## Como ligar um provedor real (precisa de autorização)

```
AI_PROVIDER=openai_compatible
AI_BASE_URL=https://api.openai.com/v1      # ou https://openrouter.ai/api/v1, https://api.mistral.ai/v1
AI_API_KEY=...
AI_MODEL=...
AI_INPUT_PRICE_CENTS_PER_MTOK=...          # preço em centavos de real por milhão de tokens
AI_OUTPUT_PRICE_CENTS_PER_MTOK=...
AI_MONTHLY_BUDGET_CENTS=5000               # obrigatório (> 0)
```

Depois: `pnpm --filter @soscomida/api build && pnpm --filter @soscomida/api ai-eval`
(16 casos sintéticos, custo de centavos) e registrar o resultado aqui.

Antes de produção: base legal e contrato de tratamento de dados com o
provedor (transferência internacional, LGPD art. 33) — **pendente jurídico**.

## Resultados de avaliação

| Data | Provedor / modelo | Prompt | Acerto | Falsos negativos | Falsos positivos | Injeções | Observação |
|---|---|---|---|---|---|---|---|
| 2026-10-12 | simulated (regras locais) | aderencia-v1 | 16/16 | 0 | 0 | 2/2 | **Não mede qualidade**: as regras do simulador foram escritas junto com os casos. Só prova que o harness funciona. |

## OCR de foto sem QR Code e de PDF escaneado

Feito com Tesseract local (tesseract.js + dados `por` empacotados; nada vai
para fora, custo zero). Só dígitos: a chave sai de `findAccessKeys`, que
exige estrutura válida e dígito verificador, e o organizador confere os 44
dígitos antes de informar o total (a mensagem diz que veio de OCR). PDF
escaneado: a primeira página é renderizada (unpdf + @napi-rs/canvas) e passa
pelo mesmo OCR.

Testado com cupons sintéticos (fonte monoespaçada, JPEG comprimido, PDF só
com imagem). **Não medido com fotos reais de cupom térmico** — amassado,
desfocado ou com pouca luz deve falhar mais; nesse caso o fluxo continua
pedindo a chave digitada. IA multimodal fica como opção futura pelo mesmo
`AiService`, se as falhas do OCR forem frequentes.

## Política de risco editável

Pesos dos alertas, da consulta fiscal e da IA, sinais de "risco alto direto"
e os limites médio/alto são editados em `/moderacao/risco` (só `admin`, com
MFA; a moderação consulta). Cada publicação vira uma versão nova em
`risk_policies` (só inserção, com motivo e auditoria); as análises gravam o
nome da versão (`risco-v1` = padrão do código, `politica-N` = publicada).
Situação fiscal grave (cancelada, não encontrada, divergente) é sempre risco
alto e não é configurável. Mudar a política não reanalisa o passado.
