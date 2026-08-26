#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
client_generated="$repo_root/lib/api-client-react/src/generated"
zod_generated="$repo_root/lib/api-zod/src/generated"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/workspace-api-generated-test.XXXXXX")"
original_client_api="$test_root/api.ts"

cleanup() {
  if [[ -f "$original_client_api" ]]; then
    cp "$original_client_api" "$client_generated/api.ts"
  fi
  rm -rf "$test_root"
}
trap cleanup EXIT

mkdir -p "$test_root/before/client" "$test_root/before/zod" "$test_root/logs"
cp -R "$client_generated" "$test_root/before/client/"
cp -R "$zod_generated" "$test_root/before/zod/"
cp "$client_generated/api.ts" "$original_client_api"

run_check() {
  local name="$1"
  pnpm --filter @workspace/api-spec run check-generated \
    >"$test_root/logs/$name.log" 2>&1
}

first_status=0
second_status=0
run_check first &
first_pid=$!
run_check second &
second_pid=$!
wait "$first_pid" || first_status=$?
wait "$second_pid" || second_status=$?

if [[ "$first_status" -ne 0 || "$second_status" -ne 0 ]]; then
  echo "Concurrent generated-client checks failed." >&2
  cat "$test_root"/logs/*.log >&2
  exit 1
fi

diff -ru "$test_root/before/client/generated" "$client_generated" >/dev/null
diff -ru "$test_root/before/zod/generated" "$zod_generated" >/dev/null

# A real mismatch must still be reported after generation moved off the
# checked-in tree.
printf '\n// intentional generated-contract mismatch\n' >>"$client_generated/api.ts"
stale_output="$test_root/stale.log"
stale_status=0
pnpm --filter @workspace/api-spec run check-generated >"$stale_output" 2>&1 ||
  stale_status=$?
if [[ "$stale_status" -eq 0 ]]; then
  echo "A stale generated contract unexpectedly passed." >&2
  cat "$stale_output" >&2
  exit 1
fi
grep -Fq "Generated API client output is stale." "$stale_output"

echo "Generated-client isolation tests passed (concurrent checks and stale output)."