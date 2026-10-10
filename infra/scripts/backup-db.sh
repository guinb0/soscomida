#!/usr/bin/env sh
# Backup diário do PostgreSQL: pg_dump comprimido, cifrado com age e enviado
# ao bucket de backup (outro provedor). Agendar via cron na VPS:
#   15 3 * * * /opt/soscomida/infra/scripts/backup-db.sh
#
# Variáveis: AGE_RECIPIENT (chave pública age), BACKUP_S3_URI (ex.: s3://soscomida-backup/db),
# e credenciais do AWS CLI para o bucket de backup.
set -eu

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
FILE="/tmp/soscomida-${STAMP}.sql.gz.age"

docker compose -f "$(dirname "$0")/../docker/compose.prod.yml" exec -T postgres \
  pg_dump -U soscomida --format=custom soscomida \
  | gzip -9 \
  | age -r "${AGE_RECIPIENT}" > "${FILE}"

aws s3 cp "${FILE}" "${BACKUP_S3_URI}/daily/${STAMP}.sql.gz.age"
rm -f "${FILE}"
echo "backup ${STAMP} enviado"
