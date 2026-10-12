# Certificados das ACs ICP-Brasil

`acs-icp-brasil.pem`: raízes e ACs intermediárias da ICP-Brasil, usadas para
validar a cadeia do certificado que assina o XML das notas
(`src/modules/fiscal/domain/icp-chain.ts`).

- Fonte oficial (ITI): https://acraiz.icpbrasil.gov.br/credenciadas/CertificadosAC-ICP-Brasil/ACcompactado.zip
- Baixado em 2026-10-12. SHA-256 do zip: `d7f977c68fed76090dc58c32684716f4a8863bb94cb2d9fd663328c01eeaaf7d`
- 180 certificados no pacote; 179 encadeiam até as raízes v5, v6, v10, v11 e
  v12. A raiz v7 ficou de fora: a chave dela não é lida pelo OpenSSL do Node.
- Só ficam no arquivo os certificados cuja assinatura foi conferida até uma
  raiz autoassinada "Autoridade Certificadora Raiz Brasileira".

Atualizar (o ITI publica ACs novas e as antigas vencem): baixar o zip,
extrair numa pasta própria e rodar
`node scripts/montar-acs-icp-brasil.mjs <pasta> assets/icp-brasil/acs-icp-brasil.pem`.
A revogação (LCR) não é consultada.
