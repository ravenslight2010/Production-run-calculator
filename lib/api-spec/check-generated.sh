#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
generated_root="$(mktemp -d "${TMPDIR:-/tmp}/workspace-api-generated-check.XXXXXX")"
trap 'rm -rf "$generated_root"' EXIT

mkdir -p "$generated_root/api-client-react" "$generated_root/api-zod"
cp "$repo_root/lib/api-client-react/src/custom-fetch.ts" \
  "$generated_root/api-client-react/custom-fetch.ts"

ORVAL_CHECK_OUTPUT_ROOT="$generated_root" \
  pnpm exec orval --config ./orval.config.ts

if ! diff -ru \
  "$generated_root/api-client-react/generated" \
  "$repo_root/lib/api-client-react/src/generated" >/dev/null ||
  ! diff -ru \
  "$generated_root/api-zod/generated" \
  "$repo_root/lib/api-zod/src/generated" >/dev/null; then
  cat >&2 <<'EOF'
Generated API client output is stale. Commit the regenerated files from
lib/api-client-react/src/generated and lib/api-zod/src/generated.
EOF
  exit 1
fi