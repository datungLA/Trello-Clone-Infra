#!/bin/sh
set -eu

if [ "${TRELLO_VERIFY_ENV:-}" != dev ]; then
  printf '%s\n' 'Run only on the Dev VPS with TRELLO_VERIFY_ENV=dev.' >&2
  exit 1
fi

backend=${BACKEND_DIR:?Set BACKEND_DIR to the backend source directory}
frontend=${FRONTEND_DIR:?Set FRONTEND_DIR to the frontend source directory}
network=${DEV_NETWORK:-trello-dev_default}
postgres=${DEV_POSTGRES_CONTAINER:-trello-dev-postgres-1}
api=${DEV_API_CONTAINER:-trello-dev-api-1}
docker network inspect "$network" >/dev/null
test -f "$backend/package-lock.json"
test -f "$frontend/package-lock.json"
work=$(mktemp -d /tmp/trello-verify.XXXXXXXX)
suffix=$(basename "$work" | tr '[:upper:].' '[:lower:]_')
testdb="${suffix}_db"
redis="${suffix}-redis"

cleanup() {
  docker rm -f "$redis" >/dev/null 2>&1 || true
  docker exec "$postgres" dropdb -U trello --if-exists "$testdb" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM

mkdir "$work/backend" "$work/frontend"
cp -R "$backend/." "$work/backend/"
cp -R "$frontend/." "$work/frontend/"
docker exec "$postgres" createdb -U trello "$testdb"
docker run -d --name "$redis" --network "$network" --memory 48m redis:7-alpine redis-server --maxmemory 24mb --maxmemory-policy noeviction >/dev/null
TEST_DATABASE_URL=$(docker inspect "$api" --format '{{range .Config.Env}}{{println .}}{{end}}' | python3 -c 'import sys; from urllib.parse import urlsplit,urlunsplit; value=next(x.strip().split("=",1)[1] for x in sys.stdin if x.startswith("DATABASE_URL=")); u=urlsplit(value); print(urlunsplit((u.scheme,u.netloc,"/"+sys.argv[1],"","")))' "$testdb")
REDIS_URL="redis://$redis:6379"
export TEST_DATABASE_URL REDIS_URL

printf '%s\n' 'Installing backend dependencies in a temporary Dev workspace.'
docker run --rm --memory 384m -e NODE_OPTIONS=--max-old-space-size=192 -v "$work/backend:/app" -w /app node:24-alpine npm ci --ignore-scripts --no-audit --no-fund
printf '%s\n' 'Running backend integration checks against a disposable database and Redis.'
docker run --rm --network "$network" --memory 256m -e NODE_OPTIONS=--max-old-space-size=160 -e TEST_DATABASE_URL -e REDIS_URL -v "$work/backend:/app" -w /app node:24-alpine npm test
printf '%s\n' 'Installing frontend dependencies in a temporary Dev workspace.'
docker run --rm --memory 384m -e NODE_OPTIONS=--max-old-space-size=192 -v "$work/frontend:/app" -w /app node:24-alpine npm ci --no-audit --no-fund
printf '%s\n' 'Running frontend checks and compilation on Dev.'
docker run --rm --memory 256m -e NODE_OPTIONS=--max-old-space-size=160 -v "$work/frontend:/app" -w /app node:24-alpine sh -c 'npm test && npm run build'
printf '%s\n' 'PASS: isolated Dev integration tests, frontend tests, and compilation.'
