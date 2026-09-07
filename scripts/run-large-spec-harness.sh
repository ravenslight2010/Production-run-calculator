#!/usr/bin/env bash
# run-large-spec-harness.sh
#
# Convenience wrapper for the large-spec import verification harness.
# Runs the full 30×8 (240-profile) AI round-trip test that verifies the
# spec importer's chunk budget still works with the current model.
#
# USAGE
# ─────
#   # Full run (30×8 — required after any model change):
#   VERIFY_USERNAME=manager VERIFY_PASSWORD=secret \
#     bash scripts/run-large-spec-harness.sh
#
#   # Quick smoke run (~2 min):
#   BRANDS=4 FLAVORS=3 \
#   VERIFY_USERNAME=manager VERIFY_PASSWORD=secret \
#     bash scripts/run-large-spec-harness.sh
#
#   # Against a remote/staging API:
#   API_BASE=https://your-staging-url/api \
#   VERIFY_USERNAME=manager VERIFY_PASSWORD=secret \
#     bash scripts/run-large-spec-harness.sh
#
# ENVIRONMENT VARIABLES
# ─────────────────────
#   API_BASE           Where the API server is running. Defaults to the local API
#                      artifact's configured port (currently http://localhost:8080/api).
#                      The server must already be running when this script is called,
#                      unless you pass --start-server (see below).
#
#   VERIFY_USERNAME    Username of an account with manager (use-ai-tools) rights.
#   VERIFY_PASSWORD    Password for that account.
#                      When both are unset the harness tries to sign up a fresh user,
#                      which only works when the database is empty (first user = manager).
#
#   BRANDS             Number of synthetic brands (default 30; max 60).
#   FLAVORS            Number of flavors per brand (default 8; max 8).
#
# OPTIONS
# ───────
#   --start-server     Build and start the API server in the background, wait for it
#                      to become ready, then stop it on exit. Requires DATABASE_URL
#                      and the Gemini AI env vars to be set. Not needed when the
#                      server is already running (e.g. the dev workflow is active).
#
#   --smoke            Shorthand for BRANDS=4 FLAVORS=3 (a quick 2-minute smoke run).
#
#   -h / --help        Show this help and exit.
#
# EXIT CODE
# ─────────
#   0  All assertions passed, including exact raw recipe row values.
#   1  Data was lost, rescaled, or mismatched (see logged diffs above).
#      If the AI model recently changed, re-tune the chunk budget:
#        lib/spec-import/src/index.ts  →  DEFAULT_LIMITS.maxTotalChars
#        artifacts/api-server/src/routes/ai.ts  →  max_completion_tokens
#      See .agents/skills/spec-import-guard/SKILL.md §4 for full instructions.
#
# AUTOMATION
# ──────────
#   A GitHub Actions nightly workflow at .github/workflows/nightly-large-spec.yml
#   runs this harness automatically every night at 03:00 UTC so model-change
#   regressions are caught before a manager tries a real import.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

START_SERVER=false
SMOKE=false

for arg in "$@"; do
  case "$arg" in
    --start-server) START_SERVER=true ;;
    --smoke)        SMOKE=true ;;
    -h|--help)
      sed -n '/^# /s/^# \?//p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

if [ "$SMOKE" = "true" ]; then
  export BRANDS="${BRANDS:-4}"
  export FLAVORS="${FLAVORS:-3}"
fi

configured_api_base() {
  local artifact_config="${REPO_ROOT}/artifacts/api-server/.replit-artifact/artifact.toml"
  local configured_port=""

  if [ -f "$artifact_config" ]; then
    configured_port="$(
      sed -nE \
        's/^[[:space:]]*localPort[[:space:]]*=[[:space:]]*([0-9]+).*$/\1/p' \
        "$artifact_config" | head -n 1
    )"
  fi

  # Keep direct shell use working if the generated artifact metadata is absent.
  configured_port="${configured_port:-8080}"
  printf 'http://localhost:%s/api' "$configured_port"
}

export API_BASE="${API_BASE:-$(configured_api_base)}"
API_BASE="${API_BASE%/}"
export BRANDS="${BRANDS:-30}"
export FLAVORS="${FLAVORS:-8}"

echo "═══════════════════════════════════════════════════════════"
echo "  Large-spec import harness  (${BRANDS}×${FLAVORS} dataset)"
echo "  API_BASE: ${API_BASE}"
echo "  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "═══════════════════════════════════════════════════════════"

API_SERVER_PID=""

api_health_url() {
  case "$1" in
    */api) printf '%s/healthz' "$1" ;;
    *)     printf '%s/api/healthz' "$1" ;;
  esac
}

api_port_from_base() {
  local base="$1"
  if [[ "$base" =~ ^https?://localhost:([0-9]+)(/|$) ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
  elif [[ "$base" =~ ^https?://127\.0\.0\.1:([0-9]+)(/|$) ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
  fi
}

API_HEALTH_URL="$(api_health_url "$API_BASE")"

# cleanup is invoked indirectly by the EXIT trap below.
# shellcheck disable=SC2317
cleanup() {
  if [ -n "$API_SERVER_PID" ]; then
    echo "Stopping API server (PID $API_SERVER_PID)…"
    kill "$API_SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if [ "$START_SERVER" = "true" ]; then
  echo ""
  echo "Building API server…"
  (cd "$REPO_ROOT" && pnpm --filter @workspace/api-server run build)

  API_SERVER_PORT="${API_PORT:-$(api_port_from_base "$API_BASE")}"
  API_SERVER_PORT="${API_SERVER_PORT:-8080}"
  echo "Starting API server on port ${API_SERVER_PORT}…"
  (cd "$REPO_ROOT" && PORT="$API_SERVER_PORT" pnpm --filter @workspace/api-server run start \
    > /tmp/large-spec-api-server.log 2>&1) &
  API_SERVER_PID=$!

  echo "Waiting for API server to be ready…"
  for i in $(seq 1 30); do
    if curl --fail --silent --show-error --connect-timeout 3 --max-time 5 \
      "$API_HEALTH_URL" > /dev/null 2>&1; then
      echo "API server ready (attempt $i)."
      break
    fi
    if [ "$i" -eq 30 ]; then
      echo "ERROR: API readiness failure — server at ${API_BASE} did not become ready within 60 s." >&2
      echo "       No AI parse was attempted. Check the API workflow/port or set API_BASE explicitly." >&2
      echo "--- API server log ---" >&2
      cat /tmp/large-spec-api-server.log >&2
      exit 1
    fi
    sleep 2
  done
else
  if ! curl --fail --silent --show-error --connect-timeout 3 --max-time 5 \
    "$API_HEALTH_URL" > /dev/null 2>&1; then
    echo "ERROR: API readiness failure — cannot reach ${API_BASE} (${API_HEALTH_URL})." >&2
    echo "       No AI parse was attempted. Start the API workflow or set API_BASE explicitly." >&2
    exit 1
  fi
  echo "API server ready at ${API_BASE}."
fi

echo ""
START_TS=$(date +%s)

cd "$REPO_ROOT"
pnpm --filter @workspace/scripts run verify-large-spec-import
EXIT_CODE=$?

END_TS=$(date +%s)
ELAPSED=$(( END_TS - START_TS ))
MINS=$(( ELAPSED / 60 ))
SECS=$(( ELAPSED % 60 ))

echo ""
echo "═══════════════════════════════════════════════════════════"
if [ "$EXIT_CODE" -eq 0 ]; then
  echo "  PASS  — elapsed ${MINS}m ${SECS}s"
else
  echo "  FAIL  — elapsed ${MINS}m ${SECS}s  (exit code ${EXIT_CODE})"
  echo ""
  echo "  Data was lost or corrupted.  Next steps:"
  echo "  1. Check whether the AI model changed in:"
  echo "       lib/integrations-openai-ai-server/src/models.ts"
  echo "  2. Re-tune chunk budget if needed:"
  echo "       lib/spec-import/src/index.ts  →  DEFAULT_LIMITS.maxTotalChars"
  echo "       artifacts/api-server/src/routes/ai.ts  →  max_completion_tokens"
  echo "  3. Bump SPEC_PARSE_VERSION in:"
  echo "       artifacts/run-calculator/src/specImport.ts"
  echo "  See .agents/skills/spec-import-guard/SKILL.md §4 for full details."
fi
echo "═══════════════════════════════════════════════════════════"

exit "$EXIT_CODE"
