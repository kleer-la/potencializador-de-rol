#!/bin/sh
# Backs up the database of the docker compose stack: pg_dump inside the `db`
# container, gzip-compressed, with bounded retention. Needs no credentials of
# its own: pg_dump runs inside the container with the container's own user.
#
# Manual use:     ./scripts/backup-db.sh
# Scheduled use:  see "Backups" in README.md
# Restore:        gunzip -c <file>.sql.gz | docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
set -eu

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${POTENCIALIZADOR_BACKUP_DIR:-$HOME/backups/potencializador}"
RETENTION_DAYS="${POTENCIALIZADOR_BACKUP_RETENTION_DAYS:-30}"

mkdir -p "$BACKUP_DIR"
cd "$REPO_DIR"

container="$(docker compose ps -q --status running db)"
if [ -z "$container" ]; then
  echo "[backup-db] The db service is not running. Aborting without a backup." >&2
  exit 1
fi

timestamp="$(date +%Y-%m-%d_%H%M%S)"
target="$BACKUP_DIR/potencializador_${timestamp}.sql.gz"
tmp="${target}.tmp"
trap 'rm -f "$tmp"' EXIT

echo "[backup-db] Dumping into $target"
# --clean --if-exists: the dump restores over an existing database.
docker exec "$container" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' | gzip > "$tmp"
# sh has no pipefail: a failed pg_dump still leaves a valid gzip, so check the
# trailer pg_dump writes only on success.
if ! gunzip -c "$tmp" | tail -n 5 | grep -q 'PostgreSQL database dump complete'; then
  echo "[backup-db] The dump is incomplete. Aborting without a backup." >&2
  exit 1
fi
mv "$tmp" "$target"

echo "[backup-db] Backup done: $target ($(du -h "$target" | cut -f1))"

find "$BACKUP_DIR" -name 'potencializador_*.sql.gz' -mtime "+${RETENTION_DAYS}" -print -delete \
  | sed 's/^/[backup-db] Deleted by retention: /'
