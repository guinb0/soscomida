# 0009 — Sem custódia ou escrow simulado

**Status:** aceito · 2026-10-10

## Contexto
Um dos objetivos de longo prazo é liberar recursos mediante comprovação ou
pagar fornecedores diretamente. É tentador modelar isso como "saldo retido"
numa tabela.

## Decisão
A plataforma não declara nem simula custódia. O dinheiro fica na conta do
provedor/parceiro; o ledger apenas espelha eventos reportados por ele.
Funcionalidades de retenção, liberação condicional e pagamento a fornecedor
ficam atrás de feature flags **desligadas** e só serão implementadas sobre
produtos de parceiros financeiros habilitados, com contrato e parecer
jurídico. Split de pagamento não é tratado como retenção condicional.

## Consequências
Textos públicos nunca usam "dinheiro guardado", "saldo em custódia" ou
equivalentes. Indicadores mostram "confirmado pelo provedor" e "transferido".
