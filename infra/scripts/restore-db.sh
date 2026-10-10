#!/usr/bin/env sh
# Restaura um backup num Postgres DESCARTÁVEL para o teste mensal de
# recuperação. Nunca rode contra produção.
#   ./restore-db.sh s3://soscomida-backup/db/daily/20261010T031500Z.sql.gz.age
# Requer AGE_IDENTITY (arquivo da chave privada age).
set -eu

SOURCE="$1"
docker run -d --rm --name soscomida-restore-test -e POSTGRES_PASSWORD=restore -p 127.0.0.1:55432:5432 postgres:17-alpine
sleep 5
aws s3 cp "${SOURCE}" - | age -d -i "${AGE_IDENTITY}" | gunzip \
  | docker exec -i soscomida-restore-test pg_restore -U postgres -d postgres --create --no-owner
docker exec soscomida-restore-test psql -U postgres -d soscomida -c "select count(*) as lancamentos from ledger_entries;"
echo "Restauração concluída. Confira os números e depois: docker stop soscomida-restore-test"
