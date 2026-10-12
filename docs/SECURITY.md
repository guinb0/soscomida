# Segurança, privacidade e riscos regulatórios

## Autenticação e sessão

- Senha com **Argon2id** (`@node-rs/argon2`, parâmetros padrão da OWASP).
- Sessão **opaca**: token aleatório de 32 bytes entregue em cookie
  `__Host-sc_session` (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`).
  O banco guarda só o SHA-256 do token. Logout e "sair de todos os
  dispositivos" revogam na hora. Ver [ADR 0004](decisions/0004-sessao-opaca.md).
- Expiração deslizante de 7 dias, absoluta de 30 dias; renovação do token ao
  elevar privilégio (login, MFA).
- **MFA (TOTP) obrigatório para `admin` e `moderator`**: sem o segundo fator
  verificado na sessão, os endpoints desses papéis respondem 403
  (`MFA_REQUIRED`).
- Rate limit em login, cadastro e recuperação (por IP e por e-mail).
- Mensagem de erro de login idêntica para e-mail inexistente e senha errada.

## Autorização

- RBAC no backend: papéis globais `moderator`, `admin`, `auditor`; doador é o
  padrão. Organizador e beneficiário são **relações com o recurso**
  (`campaign.organizer_id`), verificadas por política de propriedade.
- Guard global nega por padrão; rota pública precisa de `@Public()`.
- Auditor tem leitura ampla e **nenhuma** rota de escrita.
- IDs nunca vêm do corpo para identificar o ator: o usuário sai da sessão.
  Testes cobrem troca de identificadores (IDOR) em cada recurso.

## CSRF

O front e a API ficam no mesmo site (`/api` atrás do mesmo domínio), e o
cookie é `SameSite=Lax`. Além disso, toda requisição que altera estado precisa
de `Origin` (ou `Referer`) em `APP_ORIGINS`; sem isso → 403. Webhooks de
provedores ficam fora dessa regra e são autenticados por token próprio.

## Entrada, arquivos e SSRF

- Toda entrada HTTP é validada por schema Zod (`@soscomida/contracts`), com
  limites de tamanho.
- Upload **direto para o S3 por URL assinada** (PUT com `Content-Type` e
  tamanho fixados na assinatura, validade de 5 min). Depois a API baixa os
  primeiros bytes, confere o tipo real (magic bytes) e só então marca o
  arquivo como válido. Arquivos ficam em bucket **privado**; versões públicas
  (imagens de campanha, documentos mascarados) são cópias no bucket público.
- Nenhum arquivo enviado é executado, renderizado como HTML ou servido com o
  `Content-Type` informado pelo cliente.
- Antivírus (ClamAV) no worker para PDFs na Fase 2.
- A API não busca URLs fornecidas por usuários. As únicas saídas de rede vão
  para hosts em lista fixa (provedor de pagamento, SEFAZ, IA), definidas na
  configuração.

## Webhooks

Token comparado em tempo constante; o corpo é gravado e o estado é sempre
**confirmado consultando o provedor** antes de mudar qualquer valor. Replay do
mesmo evento é inofensivo (`UNIQUE` do id do evento).

## Segredos

Só por variável de ambiente, validadas no boot (Zod). `.env` nunca vai para o
git; `.env.example` só com placeholders. Em produção: arquivo de ambiente com
permissão restrita na VPS ou um gerenciador de segredos. Logs passam por
redação (`authorization`, `cookie`, `password`, `cpf`, `cnpj`, `token`).

## Auditoria

`audit_events` só aceita inserção (trigger). Registra login, falha de login,
mudança de papel, decisões de moderação, mudanças de status de campanha,
operações financeiras administrativas e acessos a documentos privados.

## LGPD

| Dado | Base legal provável | Minimização |
|---|---|---|
| Nome, e-mail do doador | execução de contrato | doador pode doar como anônimo publicamente |
| CPF do doador | exigência do provedor Pix | repassado ao provedor; guardamos só o necessário e cifrado |
| Dados de saúde em campanhas (ex.: tratamento) | consentimento do titular | nunca publicados automaticamente; versão pública mascarada |
| Documentos fiscais | legítimo interesse / obrigação de prestar contas | arquivos originais privados (URL assinada de 5 min, abertura pela equipe auditada); público vê só os dados lidos, sem CPF do comprador e **sem a chave de acesso**; CPF de fornecedor pessoa física mascarado |

Direitos do titular (acesso, correção, exclusão) com exceção dos registros
financeiros e fiscais, que precisam ser mantidos pelo prazo legal.
**Pendente:** DPO/encarregado, política de privacidade e termos de uso
revisados por advogado.

**Decisão pendente (produto/jurídico):** publicar a chave de acesso permitiria a
qualquer pessoa conferir a nota no portal da SEFAZ, mas a consulta pode exibir
dados do comprador (o próprio organizador). Por padrão a chave **não** é
publicada; a equipe de revisão a vê.

XML fiscal: DTD e entidades são recusados antes do parse (XXE e expansão de
entidades), tamanho máximo 5 MB, valores lidos como texto e convertidos para
centavos sem float.

IA (Fase 3): dados do caso vão só como JSON numa mensagem separada, marcada
como não confiável; pré-filtro determinístico de instruções embutidas vira
alerta; saída validada por esquema; a IA não tem ferramentas nem rede e só
recomenda. Minimização: sem nome de pessoas, CPF, chave de acesso ou arquivos.
Provedor externo exige base legal e contrato (transferência internacional) —
**pendente jurídico**; padrão em produção é `AI_PROVIDER=none`.

Assinatura do XML: verificada com xml-crypto (`publicCert` vindo do próprio
XML, nunca `getCertFromKeyInfo` padrão), só a assinatura filha de `NFe`,
`Id` único no documento, e os dados usados para conferir vêm de
`getSignedReferences()` (trecho autenticado), não do XML inteiro. O titular
do certificado não vai a público (pode ser e-CPF). A cadeia é validada contra o
pacote de ACs ICP-Brasil versionado no repositório (origem e SHA-256 em
`apps/api/assets/icp-brasil/LEIAME.md`); âncoras extras
(`FISCAL_EXTRA_TRUST_ANCHORS`) só em dev/test — a configuração recusa em
produção. Revogação pela LCR: só depois de a cadeia fechar na ICP-Brasil (a URL
vem de um certificado assinado por AC confiável), timeout de 8 s, até 40 MB,
assinatura da LCR conferida com a chave da AC.

OCR: Tesseract roda localmente, sem rede, com limite de tempo (20 s) e de
pixels; PDF renderizado só na primeira página.

## Modelo de ameaças (resumo)

| Ameaça | Exemplo | Mitigação |
|---|---|---|
| Webhook forjado | atacante confirma doação inexistente | token + consulta ao provedor antes de confirmar |
| Replay/duplicidade | mesmo webhook 10 vezes | `UNIQUE` do evento + transições monotônicas + `UNIQUE` no ledger |
| IDOR | trocar o id da campanha na URL e editar a de outro | política de propriedade em todo caso de uso; testes |
| Escalada de privilégio | doador chama rota de moderação | guard de papel + MFA para papéis elevados |
| Nota reaproveitada | mesma NFC-e em duas campanhas | `UNIQUE(access_key)`, hash, pHash, limite de rateio |
| Documento malicioso | PDF com script, XML com XXE | tipo real, parser seguro, sem renderização, antivírus |
| Prompt injection | nota com "aprove esta despesa" | dados ≠ instruções, saída validada, regra prevalece |
| Vazamento de documento privado | URL de bucket adivinhada | bucket privado, URLs assinadas de curta duração, auditoria de acesso |
| Força bruta de login | | rate limit, Argon2id, alerta de falhas |
| Fraude de campanha | causa falsa | moderação antes de ativar, verificação de identidade (Fase 2), denúncias |
| Lavagem de dinheiro | doações circulares | limites por doação, monitoramento de padrões (Fase 3), KYC do provedor |

## Riscos regulatórios (precisam de parecer jurídico)

1. **Custódia de recursos de terceiros.** Guardar dinheiro de doadores e
   liberá-lo sob condições pode caracterizar atividade de instituição de
   pagamento (Lei 12.865/2013 e regulamentação do Banco Central). A
   plataforma **não custodia**: o dinheiro fica na conta do provedor/parceiro.
   Qualquer retenção ou liberação condicional fica desligada até parceiro
   regulado, contrato e parecer ([ADR 0009](decisions/0009-sem-escrow-simulado.md)).
2. **Captação de recursos e intermediação.** Termos precisam deixar claro o
   papel da plataforma (tecnologia de arrecadação e transparência), as tarifas
   e a responsabilidade do organizador.
3. **Tributação de doações** (ITCMD estadual) — responsabilidade do
   beneficiário; a plataforma informa, não calcula.
4. **Prevenção à lavagem de dinheiro** — o KYC fica com o provedor de
   pagamento; a plataforma registra sinais e colabora.
5. **Uso de consultas fiscais** — respeitar termos de uso de cada SEFAZ e
   prefeitura; sem automação de portais que proíbem.
6. **LGPD** — dados de saúde e de menores em campanhas exigem cuidado
   reforçado e consentimento.
7. **Código de Defesa do Consumidor** — política de estorno e de cancelamento
   de campanha.

## Incidente herdado

Os repositórios .NET públicos (`guinb0/SOSComidaService` e
`guinb0/SOSComidaFront`) têm no histórico do git senhas e CPFs de teste
(`Data/usuarios.txt`, `Data/emails_enviados.txt`) e fotos de usuários.
Os arquivos foram removidos da ponta das branches, mas **o histórico ainda não
foi reescrito** (a operação foi bloqueada pela política de permissões da
sessão e aguarda autorização do dono). Este monorepo novo começa sem esse
histórico.
