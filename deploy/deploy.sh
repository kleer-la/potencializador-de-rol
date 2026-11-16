#!/usr/bin/env bash
# Deploys the current commit to the shared server. Run from the developer's machine (WSL).
#   1. Builds both images here and pushes them to the local registry (127.0.0.1:5555, the one
#      kamal also uses). Nothing is built on the server: a build there once took production down.
#   2. The server pulls them through an SSH reverse tunnel to that registry.
#   3. Applies migrations, starts api and web, and points kamal-proxy at web; kamal-proxy waits
#      for /api/health (web, api and database) before sending traffic.
# First time: deploy/setup-server.sh. See README, "Deploy".
set -euo pipefail

SERVER=${DEPLOY_SERVER:-appuser@5.78.92.152}
APP_HOST=potencializador-de-rol.lab.kleer.la
REGISTRY=localhost:5555
REGISTRY_CONTAINER=kamal-docker-registry
KEEP_RELEASES=3

cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then
  echo 'Uncommitted changes: deploy only committed code, the image tag is the commit.' >&2
  exit 1
fi
TAG=$(git rev-parse --short=12 HEAD)
API_IMAGE=$REGISTRY/potencializador-api
WEB_IMAGE=$REGISTRY/potencializador-web

if ! ssh "$SERVER" 'test -f ~/potencializador/.env'; then
  echo "No ~/potencializador/.env on $SERVER: run deploy/setup-server.sh first." >&2
  exit 1
fi

echo "==> Local registry"
if [ "$(docker inspect -f '{{.State.Running}}' "$REGISTRY_CONTAINER" 2>/dev/null)" != true ]; then
  docker start "$REGISTRY_CONTAINER" >/dev/null 2>&1 \
    || docker run -d --name "$REGISTRY_CONTAINER" -p 127.0.0.1:5555:5000 registry:3 >/dev/null
fi

echo "==> Build $TAG"
docker build --platform linux/amd64 -f apps/api/Dockerfile -t "$API_IMAGE:$TAG" .
docker build --platform linux/amd64 -f apps/web/Dockerfile -t "$WEB_IMAGE:$TAG" .
docker push -q "$API_IMAGE:$TAG"
docker push -q "$WEB_IMAGE:$TAG"

echo "==> Server"
scp -q deploy/compose.yml "$SERVER":potencializador/compose.yml
ssh -o ExitOnForwardFailure=yes -R 5555:localhost:5555 "$SERVER" \
  TAG="$TAG" API_IMAGE="$API_IMAGE" WEB_IMAGE="$WEB_IMAGE" APP_HOST="$APP_HOST" KEEP_RELEASES="$KEEP_RELEASES" \
  bash -s <<'REMOTE'
set -euo pipefail
cd ~/potencializador
export TAG

docker compose --profile migrate pull -q
# -T and /dev/null: the rest of this script arrives on stdin, and `run` would read it.
docker compose run --rm -T potencializador-migrate </dev/null
docker compose up -d --remove-orphans

# `current` is what plain `docker compose ...` uses on the server (logs, ps, restarts by hand).
docker tag "$API_IMAGE:$TAG" "$API_IMAGE:current"
docker tag "$WEB_IMAGE:$TAG" "$WEB_IMAGE:current"

docker exec kamal-proxy kamal-proxy deploy potencializador \
  --target potencializador-web:80 --host "$APP_HOST" --tls --health-check-path /api/health

# Keep the last releases for a rollback (TAG=<commit> docker compose up -d); drop older ones.
for image in "$API_IMAGE" "$WEB_IMAGE"; do
  docker images --format '{{.Tag}}' "$image" | grep -vx current | tail -n +$((KEEP_RELEASES + 1)) \
    | while read -r old; do docker rmi -f "$image:$old" >/dev/null; done
done
REMOTE

echo "==> Deployed $TAG: https://$APP_HOST"
