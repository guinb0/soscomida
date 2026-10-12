# Roadmap

Cada fase só começa quando a anterior cumpre todos os critérios de aceitação.

## Fase 0 — Fundação

- [x] Diagnóstico e decisões de arquitetura (este diretório `docs/`)
- [ ] Monorepo (pnpm + Turborepo), TypeScript strict, ESLint com regras de fronteira entre módulos
- [ ] Docker Compose de desenvolvimento (Postgres, Redis, MinIO)
- [ ] API NestJS: configuração validada, logs estruturados com correlation id, health/readiness, métricas, OpenAPI
- [ ] Banco: Drizzle, migrações, triggers de imutabilidade
- [ ] Identidade: cadastro, login, logout, sessões opacas, papéis, MFA TOTP, rate limit, CSRF por origem
- [ ] Auditoria e outbox
- [ ] Worker: relay do outbox e BullMQ com retry/backoff/DLQ
- [ ] CI: lint, tipagem, testes (com Postgres e Redis), build

**Critérios:** `pnpm install && pnpm dev:infra && pnpm dev` sobe tudo do zero;
CI verde; teste de integração prova que sessão revogada perde acesso, que rota
de moderador exige MFA e que import cruzando fronteira de módulo quebra o lint.

## Fase 1 — MVP de campanhas e doações

- [x] Campanhas: CRUD do organizador, categorias, orçamento por categoria, imagens por upload assinado, máquina de estados formal com histórico
- [x] Moderação: fila, assumir caso, aprovar, pedir ajustes, suspender com justificativa
- [x] Catálogo público com busca, filtros e página de campanha com SSR (dados em cache de 30–60 s)
- [x] Doação Pix: intenção idempotente, cobrança no provedor, QR Code, expiração, webhook idempotente, confirmação consultando o provedor
- [x] Ledger de dupla entrada com testes de propriedade
- [x] Painel do doador (minhas doações) e do organizador (arrecadação)
- [x] Transparência v1: arrecadação confirmada, tarifas, estornos, orçamento planejado
- [x] Notificações por e-mail (doação confirmada para quem doou logado; decisões da moderação, investigação e fim de prazo para quem organiza) — Mailpit em dev, SMTP em produção

**Situação (2026-10-11):** critérios 1–6 cobertos por testes de integração (103 na API) e pelo e2e Playwright no navegador (desktop e celular: cadastro → campanha → moderação com MFA → publicação → Pix simulado → valor na página pública → e-mail no Mailpit). Critério 7: fluxo `dev` verificado; `asaas` sandbox **não verificado** (aguarda credenciais).

**Critérios de aceitação do MVP:**

1. Visitante encontra uma campanha ativa, doa via Pix e vê o valor entrar no
   total **somente** depois da confirmação do provedor.
2. O mesmo webhook entregue 5 vezes, fora de ordem ou depois da expiração
   resulta em exatamente uma confirmação e um conjunto de lançamentos.
3. Σ débitos = Σ créditos no ledger em todos os testes; nenhum lançamento é
   editável.
4. Organizador não consegue editar campanha de outro, nem ativar a própria
   sem aprovação; doador não acessa rotas de moderação.
5. Campanha passa por todos os estados permitidos e transições inválidas são
   recusadas com erro claro.
6. Páginas públicas renderizam no servidor e não expõem dados pessoais.
7. Com `PAYMENTS_PROVIDER=dev`, o fluxo inteiro funciona localmente; com
   `asaas` em sandbox, idem (depende de credenciais).

## Fase 2 — Prestação de contas

- [x] Despesas com estados próprios (rascunho → enviada → em revisão → aprovada/recusada) e histórico só-inserção
- [x] Upload privado de documentos (XML, PDF, foto) com URL assinada; abertura pela equipe auditada
- [x] Leitura de XML de NF-e/NFC-e e de QR Code de NFC-e na foto; chave digitada para PDF
- [x] Chave de acesso validada (DV), documento único por chave, duplicidade de arquivo por SHA-256
- [x] Rateio de nota entre despesas com justificativa e limite garantido no banco
- [x] `FiscalVerificationProvider` com provedor honesto "sem integração" e simulado para dev
- [x] Alertas automáticos (fora do período, acima do orçamento, emitente ≠ fornecedor, homologação, sem protocolo, total declarado, duplicidade, rateio, sem comprovante)
- [x] Revisão pela moderação (assumir, aprovar/pedir ajustes/recusar, avaliar comprovante e entrega), sem revisar a própria campanha
- [x] Painel público de despesas com selos independentes; transparência por categoria (planejado × aprovado × em revisão)
- [x] Mascaramento: arquivos privados, sem chave de acesso e sem CPF na página pública
- [x] E-mail ao organizador nas decisões; e2e no navegador (desktop e celular)
- [ ] Consulta oficial de autenticidade (SEFAZ): **depende de certificado ICP-Brasil e de decisão de negócio**
- [ ] Verificação da assinatura XMLDSig do XML
- [ ] OCR/IA para foto sem QR e PDF (Fase 3)
- [ ] Hash perceptual de imagem; ONGs/organizações e beneficiários
- [ ] Versão pública mascarada de imagens de comprovantes (hoje só os dados extraídos são públicos)

## Fase 3 — IA e antifraude

- [x] `AiService` + `LlmProvider` desacoplado: adaptador Chat Completions (OpenAI/OpenRouter/Mistral) e simulado para dev
- [x] Análise de aderência com saída validada (Zod), nova tentativa e queda para revisão humana
- [x] Proteção contra prompt injection: dados isolados como JSON não confiável + pré-filtro determinístico (alerta)
- [x] Motor de risco versionado (`risco-v1`), fila de revisão ordenada por risco, painel da análise e reanálise
- [x] Contestação de recusa (uma vez; outra pessoa revisa; rateio conferido de novo)
- [x] Orçamento mensal de IA com alerta em 80% e corte em 100%; custo por chamada registrado
- [x] Avaliação automatizada (16 casos sintéticos, comando `ai-eval`)
- [x] Antifraude determinístico: assinatura XMLDSig, hash perceptual de imagens, chave lida do texto do PDF
- [ ] Rodar a avaliação com um modelo real (custa dinheiro; precisa de chave e autorização)
- [x] Validar a cadeia ICP-Brasil do certificado da assinatura (sem consulta de revogação)
- [x] OCR local (Tesseract) para foto sem QR e PDF escaneado — não medido com fotos reais
- [ ] Consulta de revogação (LCR/OCSP) dos certificados
- [x] Política de risco editável pela administração, com versões e auditoria

## Fase 4 — Financeiro avançado

Conciliação diária com extrato, múltiplos provedores, repasses, pagamento a
fornecedor e políticas de desembolso — **só com parceiro regulado, contrato e
parecer jurídico**.

## Fase 5 — Escala

Testes de carga, cache, réplicas, separação de workers, particionamento,
operação multi-instância.

## Pendências fora do código

- Conta sandbox do Asaas (chave de API, chave Pix, token de webhook)
- Decisão sobre certificado digital para consultas à SEFAZ
- Parecer jurídico: termos de uso, privacidade, papel da plataforma, custódia
- Domínio e VPS de homologação
- App Android (Capacitor) que existia no front antigo — reavaliar depois do MVP web
