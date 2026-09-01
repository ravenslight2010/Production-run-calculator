#!/bin/bash
set -e

# Artifact workflows are managed separately from this hook. During a merge,
# their old pnpm parents can outlive the workflow restart and leave the
# listener bound. Stop only the known artifact-dev process groups; never use
# broad port-owner killing because developers may have unrelated services.
node scripts/src/stop-artifact-workflows.mjs

# Replit's system pnpm can be older than the version pinned in package.json.
# Install Corepack's shim in the workspace-local bin directory that Replit puts
# ahead of the system package manager. This also keeps reconciled workflows and
# nested package scripts on the pinned version after this hook exits.
pnpm_shim_dir="$PWD/.config/npm/node_global/bin"
mkdir -p "$pnpm_shim_dir"
corepack enable --install-directory "$pnpm_shim_dir" pnpm

CI=true pnpm install --frozen-lockfile

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
