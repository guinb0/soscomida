-- [manual] O hash perceptual passou de dHash para pHash (DCT). Os valores
-- antigos não são comparáveis com os novos e gerariam alertas aleatórios.
-- Imagens enviadas antes desta migração deixam de entrar na busca por
-- fotos parecidas (o SHA-256 continua pegando cópias idênticas).
UPDATE "stored_files" SET "perceptual_hash" = NULL WHERE "perceptual_hash" IS NOT NULL;
