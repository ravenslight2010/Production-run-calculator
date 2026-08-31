#!/bin/bash
set -e

# Artifact workflows are managed separately from this hook. During a merge,
# their old pnpm parents can outlive the workflow restart and leave the
# listener bound. Stop only the known artifact-dev process groups; never use
# broad port-owner killing because developers may have unrelated services.
node scripts/src/stop-artifact-workflows.mjs

# The Replit-provided pnpm launcher can try to self-install the version from
# package.json before running a command. Post-merge runs with stdin closed and
# can also overlap with resource-heavy validation jobs, so that bootstrap may
# abort before the real install starts. Use the installed pnpm binary for this
# hook; the lockfile remains authoritative for workspace dependencies.
pnpm --config.manage-package-manager-versions=false install --frozen-lockfile

# drizzle push can hit transient "too many clients already" on the dev DB
# (leftover backends from killed test/validation runs). Retry a few times.
attempts=0
until pnpm --config.manage-package-manager-versions=false --filter db push-force; do
  attempts=$((attempts + 1))
  if [ "$attempts" -ge 4 ]; then
    echo "db push-force failed after $attempts attempts" >&2
    exit 1
  fi
  echo "db push-force failed (attempt $attempts), retrying in 15s..." >&2
  sleep 15
done
