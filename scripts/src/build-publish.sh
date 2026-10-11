#!/bin/bash
set -e

# Deployment builds must use the same pinned Node runtime as source preparation
# and release evidence, not whichever Node 24 patch happens to be on PATH.
if [[ "${REPLIT_PINNED_NODE_READY:-}" != "1" ]]; then
  exec bash scripts/src/run-release-node.sh env REPLIT_PINNED_NODE_READY=1 bash scripts/src/build-publish.sh
fi
node scripts/src/check-routine-node-version.mjs

# This only builds and seals the source prepared for an owner-initiated Replit
# Publish action. Published-source/readiness evidence is collected after that
# action, against Replit's current deployment metadata.
# Reuse the independently prepared record. If source changed after preparation,
# fail closed and require the agent to refresh it before the owner publishes.
pnpm run prepare:publish --reuse-current
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/run-calculator run build
node scripts/src/finalize-build-identity.mjs
