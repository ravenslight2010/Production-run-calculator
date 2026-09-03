#!/usr/bin/env bash

# Keep the API's retired resilient pool from becoming a second production pool.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "${SCRIPT_DIR}/../.." && pwd)
API_SRC="${REPO_ROOT}/artifacts/api-server/src"
RETIRED_POOL="${API_SRC}/lib/dbResilience.ts"
CHECKOUT_TEST="${API_SRC}/lib/aiResultCache.integration.test.ts"

relative_path() {
  local path="$1"
  printf '%s\n' "${path#"${REPO_ROOT}"/}"
}

if [[ ! -f "$RETIRED_POOL" ]]; then
  printf 'Retired database pool guard could not find %s.\n' \
    "$(relative_path "$RETIRED_POOL")" >&2
  exit 1
fi

if [[ ! -f "$CHECKOUT_TEST" ]]; then
  printf 'Retired database pool guard could not find shared-pool coverage: %s.\n' \
    "$(relative_path "$CHECKOUT_TEST")" >&2
  exit 1
fi

if ! grep -Fq \
  'it("rejects a queued checkout after the pool deadline and recovers afterward"' \
  "$CHECKOUT_TEST" ||
  ! grep -Fq '@workspace/db' "$CHECKOUT_TEST" ||
  ! grep -Fq 'expect(pool.waitingCount).toBe(0)' "$CHECKOUT_TEST"; then
  cat >&2 <<EOF
Retired database pool guard requires the shared-pool checkout regression
coverage in $(relative_path "$CHECKOUT_TEST").

Keep the queued-checkout deadline, waiter-cleanup, and recovery coverage in
that test before changing which pool handles production API traffic.
EOF
  exit 1
fi

mapfile -d '' production_sources < <(
  find "$API_SRC" -type f \
    \( -name '*.ts' -o -name '*.tsx' -o -name '*.mts' -o -name '*.cts' \) \
    ! -name '*.test.ts' \
    ! -name '*.test.tsx' \
    ! -name '*.integration.test.ts' \
    ! -name '*.integration.test.tsx' \
    ! -path "$RETIRED_POOL" \
    -print0 | sort -z
)

violations=()
for source in "${production_sources[@]}"; do
  while IFS=: read -r line_number line; do
    [[ -n "$line_number" ]] || continue

    # Ignore documentation comments. Test and admin database pools are already
    # excluded by the test-file filters above; this scan is for API production
    # source only.
    trimmed="${line#"${line%%[![:space:]]*}"}"
    case "$trimmed" in
      '//'*) continue ;;
      '/*'*) continue ;;
      '*'*) continue ;;
    esac

    if [[ "$line" == *dbResilience* ||
      "$line" =~ createResilientPool[[:space:]]*\( ]]; then
      violations+=("$(relative_path "$source"):${line_number}:${line}")
    fi
  done < <(
    grep -nE 'dbResilience|createResilientPool[[:space:]]*\(' "$source" || true
  )
done

if (( ${#violations[@]} > 0 )); then
  cat >&2 <<EOF
Retired database pool guard found production use of
$(relative_path "$RETIRED_POOL"):
EOF
printf '  %s\n' "${violations[@]}" >&2
cat >&2 <<EOF

Do not import or invoke this legacy factory for API production traffic. The
shared pool checkout contract is covered by
$(relative_path "$CHECKOUT_TEST"); extend that coverage before deliberately
changing the production pool boundary. Test/admin database pools remain
excluded from this check.
EOF
  exit 1
fi

printf \
  'PASS: retired database pool has no production callers; shared-pool checkout coverage is present.\n'