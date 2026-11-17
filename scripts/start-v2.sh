#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck source=./src/select-replit-shell-node.sh
source "$ROOT/scripts/src/select-replit-shell-node.sh"
EXPECTED_NODE_VERSION="$(tr -d '[:space:]' < "$ROOT/.nvmrc")"
ACTUAL_NODE_VERSION="$(node --version)"
if [[ "$ACTUAL_NODE_VERSION" != "v${EXPECTED_NODE_VERSION}" ]]; then
  echo "V2 requires Node v${EXPECTED_NODE_VERSION}; selected ${ACTUAL_NODE_VERSION}." >&2
  exit 1
fi

if [[ -z "${V2_DATABASE_URL:-}" ]]; then
  if [[ "${V2_USE_PROJECT_DATABASE:-}" != "true" ]]; then
    echo "V2_DATABASE_URL is required unless V2_USE_PROJECT_DATABASE=true." >&2
    exit 1
  fi
  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "The project database connection is unavailable." >&2
    exit 1
  fi
  export V2_DATABASE_URL="$DATABASE_URL"
fi

export PORT="${PORT:-5000}"
export V2_WORKER_HEALTH_PORT="${V2_WORKER_HEALTH_PORT:-3001}"
export V2_API_DB_POOL_MAX="${V2_API_DB_POOL_MAX:-3}"
export V2_WORKER_DB_POOL_MAX="${V2_WORKER_DB_POOL_MAX:-2}"

exec process-compose \
  --config process-compose.yaml \
  --disable-dotenv \
  --no-server \
  --ordered-shutdown \
  up \
  --tui=false
