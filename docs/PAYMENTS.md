# Pagamentos e ledger

## Princípios

1. **Quem confirma pagamento é o provedor.** Nenhum retorno do navegador muda
   estado financeiro.
2. **Toda escrita financeira é idempotente** e tolera repetição, atraso e
   ordem trocada de eventos.
3. **Dinheiro em centavos inteiros.** Conversões para exibição só na borda.
4. **Ledger só inserção.** Erro se corrige com lançamento compensatório.
5. **O ledger registra; não custodia.** Ele espelha o que o provedor reportou.
   Saldo real é o do provedor, conferido na conciliação.

## Interface de provedor

`apps/api/src/modules/payments/domain/payment-provider.ts`

```ts
interface PaymentProvider {
  readonly name: 'asaas' | 'dev';
  createPixCharge(input: CreatePixChargeInput): Promise<PixCharge>;
  getCharge(providerPaymentId: string): Promise<ChargeSnapshot>;
  verifyWebhook(headers, rawBody): WebhookVerification;
  parseWebhook(body): ProviderWebhookEvent;
}
```

O domínio só conhece `ChargeSnapshot` (estado normalizado: `PENDING`,
`CONFIRMED`, `REFUNDED`, `EXPIRED`, `FAILED`, valores bruto/líquido). Mapear o
vocabulário do provedor é responsabilidade do adaptador.

### Adaptadores

| Adaptador | Onde roda | Estado |
|---|---|---|
| `AsaasPaymentProvider` | sandbox e produção | implementado; **desligado até ser validado com conta sandbox** (`PAYMENTS_PROVIDER=asaas` + credenciais) |
| `DevPaymentProvider` | só `NODE_ENV=development` | gera QR **não pagável**, marcado "DESENVOLVIMENTO"; o boot da API falha se for configurado em produção |

### Asaas — o que foi confirmado na documentação oficial

Fonte: docs.asaas.com, consultado em 10/10/2026.

| Item | Valor | Status |
|---|---|---|
| Criar cobrança | `POST /v3/payments` com `customer`, `billingType: "PIX"`, `value`, `dueDate` | confirmado |
| Cliente | `customer` é obrigatório (id de cliente criado em `POST /v3/customers`) | confirmado (campo); criação de cliente: **conferir no sandbox** |
| QR Code | `GET /v3/payments/{id}/pixQrCode` → `encodedImage`, `payload` (copia e cola), `expirationDate` | confirmado |
| Sem chave Pix cadastrada | QR dinâmico pagável até 23:59 do dia; opção será descontinuada | confirmado — **cadastrar chave Pix na conta** |
| Webhook: autenticação | cabeçalho `asaas-access-token` com o token definido na configuração do webhook (não usar a API key) | confirmado |
| Webhook: entrega | pelo menos uma vez; ordem não garantida; retries; fila pausa após 15 falhas seguidas; retenção de 14 dias | confirmado |
| Webhook: idempotência | usar o `id` do evento | confirmado |
| Webhook: resposta | persistir e responder 200; processar depois | confirmado |
| Eventos | `PAYMENT_RECEIVED` (exemplo oficial), `PAYMENT_CONFIRMED` | confirmado; lista completa de eventos **não consultada** |
| URL base | produção `https://api.asaas.com`; sandbox `https://sandbox.asaas.com/api` | **não confirmado oficialmente** — configurável por `ASAAS_BASE_URL` |
| Cabeçalho da API key | `access_token` | **não confirmado oficialmente** — conferir no sandbox |
| Consulta de cobrança | `GET /v3/payments/{id}` | padrão REST da API; **conferir no sandbox** |

Itens não confirmados ficam isolados no adaptador e cobertos por testes de
contrato com respostas gravadas do sandbox, a serem gravadas quando houver
credenciais. Até lá o adaptador só roda com `ASAAS_ADAPTER_VERIFIED=true`,
definido conscientemente por quem fez a validação.

## Estados

### Doação (`donations.status`)

`PENDING → CONFIRMED → REFUNDED`; `PENDING → EXPIRED`; `PENDING → FAILED`.
Doação só aparece no total arrecadado depois de `CONFIRMED`.

### Cobrança (`payment_intents.status`)

```
CREATED ──► AWAITING_PAYMENT ──► CONFIRMED ──► REFUNDED
   │               │
   └──► FAILED     └──► EXPIRED ──► CONFIRMED (pagamento tardio aceito)
```

Regras:

- Transições só avançam. Um evento que levaria a um estado "anterior" é
  gravado em `payment_events` com status `IGNORED` e motivo.
- `EXPIRED → CONFIRMED` é permitido: se o provedor confirmar depois da
  expiração local, o dinheiro entrou e precisa ser contabilizado. Isso gera
  um alerta para a operação.
- Cada mudança usa `UPDATE ... WHERE id = $1 AND version = $2` (concorrência
  otimista). Dois workers não confirmam a mesma cobrança.

## Processamento de webhook

1. `POST /api/payments/webhooks/asaas`
2. Verifica `asaas-access-token` em tempo constante. Falha → 401, sem detalhes.
3. `INSERT INTO payment_events ... ON CONFLICT (provider, provider_event_id) DO NOTHING`
   + `INSERT INTO outbox_events` na mesma transação.
4. Responde 200 (também para evento repetido).
5. Worker consome `PaymentEventReceived`:
   - busca a cobrança local pelo `provider_payment_id` (desconhecida →
     `IGNORED`, alerta);
   - **consulta `getCharge` no provedor** e usa o estado retornado, não o do
     corpo do webhook (protege contra corpo forjado e eventos fora de ordem);
   - aplica a transição em transação única com os lançamentos do ledger e o
     evento `DonationConfirmed`/`DonationRefunded` no outbox.
6. Falha transitória → retry com backoff exponencial (5 tentativas) → DLQ e
   alerta. Reprocessar pela administração é seguro (idempotente).

## Ledger

Contas (criadas sob demanda, `code` único):

| Código | Tipo | Significado |
|---|---|---|
| `provider:<provedor>:receivable` | ASSET | valores confirmados pelo provedor e ainda não transferidos |
| `campaign:<id>:donations` | LIABILITY | doações confirmadas para a campanha (devidas à campanha) |
| `campaign:<id>:fees` | EXPENSE | tarifas do provedor atribuídas à campanha |
| `campaign:<id>:refunds` | EXPENSE | estornos |
| `campaign:<id>:transfers` | EXPENSE | repasses ao organizador (Fase 4) |

Lançamentos:

| Evento | Débito | Crédito | Valor |
|---|---|---|---|
| Doação confirmada | `provider:asaas:receivable` | `campaign:X:donations` | bruto |
| Tarifa do provedor | `campaign:X:fees` | `provider:asaas:receivable` | tarifa (bruto − líquido) |
| Estorno | `campaign:X:refunds` | `provider:asaas:receivable` | bruto estornado |

Projeção pública de uma campanha (Fase 1):

- **Arrecadação confirmada** = saldo credor de `campaign:X:donations`.
- **Tarifas** = saldo de `campaign:X:fees`.
- **Estornos** = saldo de `campaign:X:refunds`.
- **Líquido estimado** = doações − tarifas − estornos (rotulado como estimativa
  até a conciliação com o extrato do provedor).

Chaves de idempotência das transações: `donation:<id>:confirmed`,
`donation:<id>:refunded`. O `UNIQUE` impede lançamento duplo mesmo com dois
workers.

Testes de propriedade (fast-check) garantem que qualquer sequência de
confirmações, tarifas e estornos mantém Σ débitos = Σ créditos e saldo de
doações ≥ 0.

## Conciliação

- **A cada 15 min:** cobranças `AWAITING_PAYMENT` com mais de 30 min são
  consultadas no provedor (pega webhook perdido). Vencidas viram `EXPIRED`.
- **Diária (Fase 4):** compara extrato/saldo do provedor com o ledger;
  divergências viram `reconciliation_discrepancies` e alerta. Até lá, o painel
  público rotula valores como "confirmados pelo provedor", nunca "em caixa".

## Fase 4 — pagamentos controlados (desligado)

Interfaces previstas: contas vinculadas, solicitações de desembolso, aprovação
de despesa, pagamento direto a fornecedor. **Nada disso movimenta dinheiro**
até haver parceiro financeiro habilitado, contrato e parecer jurídico. Split de
pagamento não é retenção condicional e não será tratado como tal
([ADR 0009](decisions/0009-sem-escrow-simulado.md)).
