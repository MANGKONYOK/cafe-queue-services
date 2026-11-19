#!/bin/sh
set -e

# When running locally under Docker Compose, rewrite localhost/127.0.0.1 in
# DATABASE_URL to the Compose db service hostname without duplicating secrets
# in docker-compose.yml (no-op on Cloud Run where COMPOSE_DB_HOST is unset).
if [ -n "${COMPOSE_DB_HOST:-}" ] && [ -n "${DATABASE_URL:-}" ]; then
  DATABASE_URL="$(printf '%s' "$DATABASE_URL" | sed -E "s/@(localhost|127\.0\.0\.1)(:[0-9]+)?\//@${COMPOSE_DB_HOST}:5432\//")"
  export DATABASE_URL
fi

exec "$@"