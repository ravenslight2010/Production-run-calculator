#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v shellcheck >/dev/null 2>&1; then
  if [[ "${CI_PUBLIC_SOURCE:-}" == "1" || "${CI_PUBLIC_SOURCE:-}" == "true" ]]; then
    echo "shellcheck not installed; skipping under CI_PUBLIC_SOURCE" >&2
    exit 0
  fi
  echo "shellcheck is required for API-spec generated checks" >&2
  exit 127
fi
exec shellcheck ./check-generated.sh ./check-generated.test.sh ./check-typescript-7-bridge.sh
