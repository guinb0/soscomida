# Certificados FICTÍCIOS de teste

Gerados com `openssl` só para os testes de assinatura XML
(`test/fiscal-fixtures.ts` → `assinarNfe`). Não são ICP-Brasil, não valem
para nada fora dos testes e as chaves privadas são públicas de propósito.

- `ac-teste.pem`: AC de teste (a chave privada foi descartada).
- `emitente.pem` / `.key`: "SUPERMERCADO EXEMPLO LTDA:11222333000181", emitido pela AC de teste.
- `autoassinado.pem` / `.key`: mesmo CN, autoassinado.
