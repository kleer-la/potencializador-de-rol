#!/usr/bin/env bash
# First deploy only, run from the developer's machine. Idempotent: what already exists is kept.
#   - ~/potencializador/.env on the server, from deploy/.env.example, with both database passwords
#     generated there (they never travel or show in a process list).
#   - Role `potencializador` (login, createrole, not superuser) and database
#     potencializador_production, owned by it, in the shared `postgres` container.
#   - A line in ~/backups/databases.conf, so the nightly backup (local and S3) includes the database.
# See README, "Deploy".
set -euo pipefail

SERVER=${DEPLOY_SERVER:-appuser@5.78.92.152}
cd "$(dirname "$0")"

ssh "$SERVER" 'mkdir -p ~/potencializador && chmod 700 ~/potencializador'
scp -q .env.example "$SERVER":potencializador/.env.example

ssh "$SERVER" bash -s <<'REMOTE'
set -euo pipefail
cd ~/potencializador

if [ -f .env ]; then
  echo '.env: exists, left as is'
else
  umask 077
  owner=$(openssl rand -hex 24)
  app=$(openssl rand -hex 24)
  sed -e "s/^OWNER_DB_PASSWORD=.*/OWNER_DB_PASSWORD=$owner/" \
      -e "s/^APP_DB_PASSWORD=.*/APP_DB_PASSWORD=$app/" .env.example > .env
  echo '.env: created, with generated database passwords'
fi
set -a; . ./.env; set +a

# Without -i: this script arrives on stdin, and `docker exec -i` would swallow the rest of it.
psql() { docker exec postgres psql -U postgres -v ON_ERROR_STOP=1 -qAt "$@"; }

if [ "$(psql -c "select count(*) from pg_roles where rolname = 'potencializador'")" = 1 ]; then
  echo 'role potencializador: exists, left as is'
else
  # printf is a builtin: the password goes through stdin, never through a command line.
  printf "create role potencializador login createrole password '%s';\n" "$OWNER_DB_PASSWORD" \
    | docker exec -i postgres psql -U postgres -v ON_ERROR_STOP=1 -qAt
  echo 'role potencializador: created'
fi

if [ "$(psql -c "select count(*) from pg_database where datname = 'potencializador_production'")" = 1 ]; then
  echo 'database potencializador_production: exists'
else
  psql -c 'create database potencializador_production owner potencializador'
  echo 'database potencializador_production: created'
fi

if grep -q '^potencializador:' ~/backups/databases.conf; then
  echo 'backup: already configured'
else
  echo 'potencializador:potencializador_production' >> ~/backups/databases.conf
  echo 'backup: added to ~/backups/databases.conf'
fi
REMOTE

echo
echo "Still to do by hand on the server (ssh $SERVER, edit ~/potencializador/.env):"
echo '  SUPER_ADMIN_EMAILS and at least one way to sign in (Google, Microsoft or SMTP).'
