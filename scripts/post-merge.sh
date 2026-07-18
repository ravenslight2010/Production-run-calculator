#!/bin/bash
set -e
pnpm install --frozen-lockfile

# drizzle push can hit transient "too many clients already" on the dev DB
# (leftover backends from killed test/validation runs). Retry a few times.
attempts=0
until pnpm --filter db push-force; do
  attempts=$((attempts + 1))
  if [ "$attempts" -ge 4 ]; then
    echo "db push-force failed after $attempts attempts" >&2
    exit 1
  fi
  echo "db push-force failed (attempt $attempts), retrying in 15s..." >&2
  sleep 15
done
