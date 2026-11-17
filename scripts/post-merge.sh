#!/bin/bash
set -e

current_phase=""
phase_started_seconds=0

log_phase_start() {
  local name="$1"
  [[ "$name" =~ ^[a-z0-9-]+$ ]] || return 2
  current_phase="$name"
  phase_started_seconds=$SECONDS
  printf 'post-merge phase=start name=%s timestamp_utc=%s\n' \
    "$name" "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" >&2
}

run_phase() {
  local name="$1"
  shift
  local status
  local elapsed

  log_phase_start "$name" || return $?
  if "$@"; then
    status=0
  else
    status=$?
  fi
  elapsed=$((SECONDS - phase_started_seconds))
  printf \
    'post-merge phase=end name=%s outcome=%s elapsed_seconds=%s exit_code=%s timestamp_utc=%s\n' \
    "$current_phase" "$([[ "$status" -eq 0 ]] && printf success || printf failure)" \
    "$elapsed" "$status" "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" >&2
  current_phase=""
  return "$status"
}

run_phase_or_exit() {
  local status
  if run_phase "$@"; then
    return 0
  else
    status=$?
    exit "$status"
  fi
}

# Replit's nodejs-24 module can lag the patch pinned for release evidence.
# Re-enter with the pinned executable ahead of PATH before running Corepack,
# pnpm or any child scripts. The launcher checks the evidence contract first.
if [[ "${REPLIT_PINNED_NODE_READY:-}" != "1" ]]; then
  exec bash scripts/src/run-release-node.sh env REPLIT_PINNED_NODE_READY=1 bash scripts/post-merge.sh
fi
run_phase_or_exit node-version-check node scripts/src/check-routine-node-version.mjs

# Artifact workflows are managed separately from this hook. During a merge,
# their old pnpm parents can outlive the workflow restart and leave the
# listener bound. Stop only the known artifact-dev process groups; never use
# broad port-owner killing because developers may have unrelated services.
run_phase_or_exit stop-artifact-workflows node scripts/src/stop-artifact-workflows.mjs

# Route direct and nested package-manager calls through the project pin before
# running any post-merge package scripts.
run_phase_or_exit pnpm-selection bash scripts/src/run-project-pnpm.sh --version

run_phase_or_exit frozen-install env CI=true bash scripts/src/run-project-pnpm.sh install --frozen-lockfile

# V1's app and database are archived. Do not push its schema or prepare a V1
# deployment as a side effect of merging V2 source changes. The isolated V2
# pilot owns its own database and deployment setup.
run_phase_or_exit v2-source-syntax node --check v2/server/main.mjs
