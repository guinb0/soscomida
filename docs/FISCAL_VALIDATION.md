# Validação de documentos fiscais

> Estado: **planejado para a Fase 2.** Partes puras (estrutura e dígito
> verificador da chave de acesso) já existem em `@soscomida/shared` com testes.

## O que a plataforma afirma — e o que não afirma

Uma nota autêntica prova que uma venda foi registrada no fisco. Ela **não**
prova que o dinheiro da campanha pagou aquela venda, nem que o item foi usado
na causa. Por isso cada despesa tem verificações independentes, exibidas
separadamente:

| Verificação | Pergunta respondida | Fonte |
|---|---|---|
| Documento recebido/processado | o arquivo foi lido? | pipeline interno |
| Autenticidade fiscal | o fisco reconhece este documento como autorizado e não cancelado? | consulta oficial, quando automatizável |
| Pagamento conciliado | há comprovante de pagamento compatível (valor, data, favorecido)? | comprovante + extrato |
| Aderência à campanha | os itens fazem sentido para a finalidade e o orçamento? | regras + IA + revisão humana |
| Entrega comprovada | há evidência de que o bem/serviço chegou? | evidências do organizador |

## Documentos suportados (progressivo)

1. **NFC-e (modelo 65)** — QR Code impresso no cupom: caminho mais confiável
   para fotos de celular.
2. **NF-e (modelo 55)** — XML (preferencial) ou DANFE em PDF.
3. **NFS-e** — varia por município; com o padrão nacional (ADN) o caminho é
   consultar o ambiente nacional, onde o município aderiu.
4. Outros (recibos, cupons não fiscais) entram como **comprovante sem
   autenticidade fiscal**, sempre com revisão humana.

## Pipeline

**A. Identificação** — tipo real do arquivo (magic bytes), não a extensão.
XML, PDF e imagens (JPEG/PNG/WebP/HEIC) aceitos; demais rejeitados.

**B. Leitura, do mais confiável ao menos confiável**

1. XML: parse com limite de tamanho e entidades externas desligadas (XXE).
2. QR Code: decodificado da imagem; extrai chave de acesso e parâmetros.
3. PDF com texto: extração direta.
4. Imagem: OCR. O extrator de campos existente
   (`ExtratorNotaFiscal`, portado do projeto .NET com seus casos de teste)
   valida CNPJ e chave pelo dígito verificador.
5. IA multimodal: só quando os passos acima não obtiverem os campos mínimos.
   O resultado entra como "extraído por IA", com confiança menor, e nunca
   conta como autenticidade.

Campos extraídos ficam separados da evidência original. O organizador pode
corrigir um campo; a correção vira um novo registro com autor e motivo, e o
arquivo original não muda.

**C. Autenticidade** — interface `FiscalVerificationProvider`:

```ts
interface FiscalVerificationProvider {
  supports(doc: FiscalDocumentRef): boolean;   // tipo, UF, município
  verify(doc: FiscalDocumentRef): Promise<FiscalVerificationResult>;
}
type FiscalVerificationResult =
  | { status: 'AUTHORIZED'; evidence: Evidence }
  | { status: 'CANCELLED' | 'NOT_FOUND' | 'DIVERGENT'; evidence: Evidence; details: string }
  | { status: 'UNVERIFIABLE'; reason: 'REQUIRES_CERTIFICATE' | 'REQUIRES_CAPTCHA' | 'NO_INTEGRATION' | 'SOURCE_UNAVAILABLE' };
```

Antes de qualquer consulta, a chave de acesso passa pela verificação
estrutural (44 dígitos: cUF, AAMM, CNPJ, modelo, série, número, tipo de
emissão, código numérico, DV módulo 11) — já implementada em
`packages/shared/src/fiscal/access-key.ts`.

Restrições respeitadas:

- **Sem contorno de CAPTCHA** e sem raspagem de portais que proíbem. Se a
  consulta oficial exige CAPTCHA ou certificado digital, o resultado é
  `UNVERIFIABLE` e a despesa vai para revisão humana.
- Webservices da SEFAZ (ex.: consulta de protocolo) exigem certificado
  digital ICP-Brasil da empresa consulente. Usar essa via depende de a
  plataforma ter certificado próprio e de checar os termos de uso de cada UF.
  **Decisão pendente de negócio.**
- Agregadores comerciais de consulta fiscal são uma alternativa paga; entram
  como mais um `FiscalVerificationProvider`, se contratados.
- Cada tentativa grava provedor, método, horário, resultado e evidência
  (resposta oficial ou hash dela), em `fiscal_verifications`.

**D. Antiduplicidade** — chave de acesso (`UNIQUE` por documento), SHA-256 do
arquivo, hash perceptual de imagem (detecta a mesma foto reenviada com outra
compressão) e comparação de campos (CNPJ + número + série + valor). Rateio
entre despesas é permitido com justificativa, desde que
`Σ alocações ≤ valor elegível` (garantido com lock do documento e constraint
trigger).

**E. Consistência** — valor divergente, data fora do período da campanha,
documento cancelado, fornecedor em lista de risco, itens fora das categorias do
orçamento, despesa acima do orçamento da categoria, comprovante de pagamento
incompatível (valor, data, favorecido), ausência de evidência de entrega
quando a política exige. CNPJ ativo sozinho **não** é prova de nada.

## Limitações conhecidas (a mostrar ao público)

- Nem toda UF ou município oferece consulta automatizável; nesses casos o selo
  "documento fiscal autenticado" não aparece, mesmo que o documento seja
  legítimo.
- OCR de cupom térmico desbotado falha com frequência; o QR Code é o caminho
  preferido.
- A plataforma não audita estoque nem uso final dos bens.
