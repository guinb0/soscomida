# 0008 — Asaas como primeiro provedor Pix

**Status:** aceito (escolha do dono do produto) · 2026-10-10

## Decisão
Primeiro adaptador de `PaymentProvider` para o Asaas. Base URL, cabeçalho de
autenticação e token de webhook vêm de configuração. Itens da API não
confirmados na documentação oficial estão listados em
[PAYMENTS.md](../PAYMENTS.md#asaas--o-que-foi-confirmado-na-documentação-oficial)
e o adaptador só liga com `ASAAS_ADAPTER_VERIFIED=true`, depois do teste no
sandbox.

Para desenvolvimento local existe `DevPaymentProvider`, que gera cobrança
**não pagável** e é recusado no boot fora de `development`.

## Consequências
Trocar ou somar provedores (Mercado Pago, Pagar.me) é escrever outro
adaptador; o domínio e o ledger não mudam.
