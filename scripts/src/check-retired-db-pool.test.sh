#!/usr/bin/env bash

# Regression tests for the shared-pool production boundary guard.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
GUARD_SCRIPT="${SCRIPT_DIR}/check-retired-db-pool.sh"
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

make_workspace() {
  local name="$1"
  local workspace="${TEST_ROOT}/${name}"

  mkdir -p \
    "${workspace}/scripts/src" \
    "${workspace}/artifacts/api-server/src/lib"
  cp "$GUARD_SCRIPT" "${workspace}/scripts/src/check-retired-db-pool.sh"
  cat > \
    "${workspace}/artifacts/api-server/src/lib/aiResultCache.integration.test.ts" \
    <<'EOF'
type DbModule = typeof import("@workspace/db");
it("rejects a queued checkout after the pool deadline and recovers afterward", () => {});
expect(pool.waitingCount).toBe(0);
EOF

  printf '%s\n' "$workspace"
}

run_check() {
  local workspace="$1"
  set +e
  CHECK_OUTPUT=$(bash \
    "${workspace}/scripts/src/check-retired-db-pool.sh" 2>&1)
  CHECK_STATUS=$?
  set -e
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  if [[ "$haystack" != *"$needle"* ]]; then
    printf 'Expected output to contain: %s\nActual output:\n%s\n' \
      "$needle" "$haystack" >&2
    return 1
  fi
}

test_accepts_removed_retired_pool() {
  local workspace
  workspace=$(make_workspace no-caller)
  run_check "$workspace"
  [[ "$CHECK_STATUS" -eq 0 ]] || {
    printf 'Expected no production caller to pass. Output:\n%s\n' \
      "$CHECK_OUTPUT" >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" \
    "retired database pool is removed"
  echo "PASS: accepts removed retired pool"
}

test_rejects_retired_pool_file() {
  local workspace
  workspace=$(make_workspace retired-file)
  cat > "${workspace}/artifacts/api-server/src/lib/dbResilience.ts" <<'EOF'
export function createResilientPool() {
  return {};
}
EOF
  run_check "$workspace"
  [[ "$CHECK_STATUS" -eq 1 ]] || {
    printf 'Expected the retired pool file to fail. Output:\n%s\n' \
      "$CHECK_OUTPUT" >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" \
    "artifacts/api-server/src/lib/dbResilience.ts"
  echo "PASS: rejects retired pool file"
}

test_rejects_production_import() {
  local workspace
  workspace=$(make_workspace production-import)
  cat > "${workspace}/artifacts/api-server/src/app.ts" <<'EOF'
import { createResilientPool } from "./lib/dbResilience";

export const pool = createResilientPool();
EOF
  run_check "$workspace"
  [[ "$CHECK_STATUS" -eq 1 ]] || {
    printf 'Expected a production import to fail. Output:\n%s\n' \
      "$CHECK_OUTPUT" >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" \
    "artifacts/api-server/src/app.ts:1:import"
  assert_contains "$CHECK_OUTPUT" "aiResultCache.integration.test.ts"
  echo "PASS: rejects production import of retired pool"
}

test_rejects_production_invocation() {
  local workspace
  workspace=$(make_workspace production-invocation)
  cat > "${workspace}/artifacts/api-server/src/app.ts" <<'EOF'
const pool = createResilientPool();
export { pool };
EOF
  run_check "$workspace"
  [[ "$CHECK_STATUS" -eq 1 ]] || {
    printf 'Expected a production invocation to fail. Output:\n%s\n' \
      "$CHECK_OUTPUT" >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" \
    "artifacts/api-server/src/app.ts:1:const pool = createResilientPool();"
  echo "PASS: rejects production invocation of retired pool"
}

test_ignores_test_and_admin_pools() {
  local workspace
  workspace=$(make_workspace test-and-admin)
  cat > \
    "${workspace}/artifacts/api-server/src/lib/admin.integration.test.ts" \
    <<'EOF'
import { createResilientPool } from "./dbResilience";
const adminPool = createResilientPool();
export { adminPool };
EOF
  cat > \
    "${workspace}/artifacts/api-server/src/lib/database.test.ts" \
    <<'EOF'
import pg from "pg";
const adminPool = new pg.Pool({ connectionTimeoutMillis: 15_000 });
export { adminPool };
EOF
  run_check "$workspace"
  [[ "$CHECK_STATUS" -eq 0 ]] || {
    printf 'Expected test/admin pools to be excluded. Output:\n%s\n' \
      "$CHECK_OUTPUT" >&2
    return 1
  }
  echo "PASS: excludes test/admin database pools"
}

test_requires_shared_pool_coverage() {
  local workspace
  workspace=$(make_workspace missing-coverage)
  sed -i '/rejects a queued checkout/d' \
    "${workspace}/artifacts/api-server/src/lib/aiResultCache.integration.test.ts"
  run_check "$workspace"
  [[ "$CHECK_STATUS" -eq 1 ]] || {
    printf 'Expected missing shared-pool coverage to fail. Output:\n%s\n' \
      "$CHECK_OUTPUT" >&2
    return 1
  }
  assert_contains "$CHECK_OUTPUT" \
    "requires the shared-pool checkout regression"
  echo "PASS: requires shared-pool checkout regression coverage"
}

test_accepts_removed_retired_pool
test_rejects_retired_pool_file
test_rejects_production_import
test_rejects_production_invocation
test_ignores_test_and_admin_pools
test_requires_shared_pool_coverage