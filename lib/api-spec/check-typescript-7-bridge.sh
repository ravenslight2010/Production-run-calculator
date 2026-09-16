#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
before_status="$(git -C "$repo_root" status --porcelain=v1 --untracked-files=all)"
temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/workspace-typescript-7-bridge.XXXXXX")"
checkout="$temporary_root/repository"

finish() {
  local exit_status=$?
  rm -rf "$temporary_root"

  local after_status
  after_status="$(git -C "$repo_root" status --porcelain=v1 --untracked-files=all)"
  if [[ "$before_status" != "$after_status" ]]; then
    printf '%s\n' \
      "TypeScript 7 bridge changed the authoritative workspace." >&2
    printf '\nBefore:\n%s\n' "${before_status:-<clean>}" >&2
    printf '\nAfter:\n%s\n' "${after_status:-<clean>}" >&2
    exit_status=1
  fi

  exit "$exit_status"
}
trap finish EXIT

mkdir -p "$checkout"
(
  cd "$repo_root"
  tar \
    --exclude='*/node_modules' \
    --exclude='*/dist' \
    --exclude='*/test-results' \
    --exclude='*/playwright-report' \
    --exclude='*.tsbuildinfo' \
    -cf - \
    package.json \
    pnpm-lock.yaml \
    pnpm-workspace.yaml \
    tsconfig.json \
    tsconfig.base.json \
    lib \
    artifacts \
    scripts
) | tar -x -C "$checkout"

(
  cd "$checkout"
  pnpm install --frozen-lockfile --strict-peer-dependencies
)

typescript_6="$checkout/lib/api-spec/node_modules/typescript/bin/tsc"
typescript_7="$checkout/node_modules/typescript-native/bin/tsc"

if [[ ! -x "$typescript_6" || ! -x "$typescript_7" ]]; then
  printf '%s\n' \
    "The disposable checkout did not install both compiler binaries." >&2
  exit 1
fi

typescript_6_version="$(node "$typescript_6" --version)"
typescript_7_version="$(node "$typescript_7" --version)"

printf 'API-spec compiler: %s (%s)\n' "$typescript_6_version" "$typescript_6"
printf 'Root candidate compiler: %s (%s)\n' "$typescript_7_version" "$typescript_7"

if [[ "$typescript_6_version" != "Version 6.0.3" ]]; then
  printf 'Expected the API-spec compiler to remain TypeScript 6.0.3.\n' >&2
  exit 1
fi
if [[ "$typescript_7_version" != "Version 7.0.2" ]]; then
  printf 'Expected the root candidate compiler to remain TypeScript 7.0.2.\n' >&2
  exit 1
fi

(
  cd "$checkout"
  pnpm --filter @workspace/api-spec run check:toolchain
  pnpm --filter @workspace/api-spec run check-generated
  node "$typescript_7" \
    --build \
    --force \
    --pretty false \
    lib/api-client-react/tsconfig.json \
    lib/api-zod/tsconfig.json
)

printf '%s\n' \
  "TypeScript 7 codegen bridge passed in a disposable checkout."