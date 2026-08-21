#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
generated_root="$repo_root/lib/api-spec/.generated-check"
trap 'rm -rf "$generated_root"' EXIT

mkdir -p "$generated_root/api-client-react" "$generated_root/api-zod"
cp -R "$repo_root/lib/api-client-react/src/generated" "$generated_root/api-client-react/"
cp -R "$repo_root/lib/api-zod/src/generated" "$generated_root/api-zod/"

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