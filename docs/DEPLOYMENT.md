# Implantação, operação e custos

## Ambientes

| Ambiente | Onde | Dados | Pagamentos |
|---|---|---|---|
| desenvolvimento | máquina local, `infra/docker/compose.dev.yml` | seed fictício | `DevPaymentProvider` (não pagável) |
| homologação | VPS separada (ou mesma VPS, outro compose project) | fictícios | Asaas **sandbox** |
| produção | VPS própria | reais | Asaas produção — só após validação e autorização |

## Topologia inicial (estágio 1)

Uma VPS com Docker Compose e Traefik:

```
traefik (TLS Let's Encrypt)
 ├─ web      (Next.js, 1 réplica)
 ├─ api      (NestJS, 1–2 réplicas)
 └─ worker   (mesma imagem da api, comando diferente)
postgres 17  (volume local + backup externo)
redis 7      (AOF ligado — filas não podem sumir num restart)
S3           (externo: Cloudflare R2 ou Backblaze B2; MinIO só em dev)
```

## Deploy

CI (GitHub Actions) roda lint, tipagem, testes e build em todo push. Em tag
`v*`: monta imagens, publica no registry, e o deploy na VPS faz:

1. `docker compose pull`
2. `docker compose run --rm api node dist/infra/db/migrate.js` (migrações são
   sempre compatíveis com a versão anterior — expand/contract)
3. `docker compose up -d` (Traefik só manda tráfego quando o
   `/api/health/ready` responde)

**Rollback:** voltar a tag da imagem e `up -d`. Como as migrações são
expand/contract, a versão anterior continua funcionando com o banco novo.
Migração destrutiva só numa release posterior, depois que nenhuma versão em
uso depende da coluna.

## Backup e recuperação

- `pg_dump` diário comprimido e cifrado (age) para o bucket de backup em outro
  provedor; retenção de 30 diários + 12 mensais
  (`infra/scripts/backup-db.sh`).
- WAL archiving (PITR) a partir do estágio 2.
- **Teste de restauração mensal** em máquina descartável
  (`infra/scripts/restore-db.sh`) — backup que nunca foi restaurado não conta.
- Buckets S3 com versionamento ligado no bucket privado.

## Observabilidade

- Logs JSON (pino) com `requestId`, sem dados pessoais.
- `/api/health/live` (processo de pé) e `/api/health/ready` (banco e Redis).
- `/api/metrics` (Prometheus, só na rede interna): latência HTTP por rota,
  erros 5xx, filas (aguardando, falhas, DLQ), webhooks recebidos/ignorados,
  cobranças sem conciliação, duração de jobs.
- Alertas iniciais: 5xx > 1% em 5 min; DLQ > 0; cobrança `AWAITING_PAYMENT`
  há mais de 2 h com pagamento no provedor; backup diário ausente; disco > 80%.

## Estimativas por estágio

**Premissas (não são medições):** uso concentrado em horário comercial; 10% dos
usuários ativos por dia; páginas públicas com cache (ISR) de 60 s; documento
fiscal médio de 1,5 MB; uma análise de IA por despesa na Fase 3. Preços de
infraestrutura mudam — valores abaixo são ordem de grandeza para planejar e
devem ser reconferidos no momento da contratação. Todas as hipóteses de carga
precisam ser validadas com teste de carga (k6) antes de cada mudança de
estágio.

| | Estágio 1 | Estágio 2 | Estágio 3 |
|---|---|---|---|
| Usuários / campanhas ativas / documentos por mês | 1 mil / 100 / 1 mil | 50 mil / 5 mil / 50 mil | 1 mi / 100 mil / 500 mil |
| Pico estimado de requisições à API | < 5 req/s | ~50 req/s | ~500 req/s (picos de campanhas virais) |
| Jobs por mês (doc + IA + webhooks + notificações) | ~10 mil | ~500 mil | ~5 mi |
| Infra de aplicação | 1 VPS 2–4 vCPU / 8 GB | 2 VPS (app e banco separados), 4–8 vCPU / 16 GB cada | vários nós de app atrás de LB, Postgres gerenciado com réplica de leitura |
| Banco | mesma VPS, < 5 GB | dedicado, ~50 GB, PITR | gerenciado, ~500 GB, réplicas, particionamento de ledger e auditoria |
| Armazenamento de documentos | ~1,5 GB/mês | ~75 GB/mês | ~750 GB/mês (lifecycle para camada fria após 1 ano) |
| Cache | desnecessário (ISR do Next basta) | Redis para sessões quentes e projeções públicas | Redis dedicado + CDN para páginas públicas |
| Workers | dentro da mesma VPS | container de worker separado | workers de documentos e de IA escalados à parte |
| Ordem de grandeza mensal (infra) | R$ 50–150 | R$ 600–1.500 | R$ 8–25 mil |
| IA (US$ 0,0005–0,005 por documento) | < R$ 30 | R$ 150–1.500 | R$ 1,5–15 mil |

Gargalos esperados, em ordem:

1. **OCR e IA** (CPU e latência externa) → worker de documentos separado já
   no estágio 2.
2. **Leitura das páginas públicas de campanha** em pico viral → ISR + CDN; a
   projeção pública é uma tabela/visão materializada, não soma o ledger a
   cada acesso.
3. **Escrita no ledger e nos eventos** → índices certos e particionamento por
   ano no estágio 3; transações curtas.
4. **Webhooks em rajada** → resposta imediata após gravar; processamento em
   fila.

Extrações de serviço só com motivo operacional medido: worker de documentos
(estágio 2), pagamentos isolados (se exigência de segurança/compliance do
parceiro), API pública de leitura (estágio 3).
