#!/usr/bin/env bash

# Regression tests for the release Node launcher. Most cases use temporary
# fake executables; the TLS case uses real npx with a loopback-only fixture
# registry and temporary package data.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
LAUNCHER="${SCRIPT_DIR}/run-release-node.sh"
HISTORY_VIEWER="${SCRIPT_DIR}/show-release-lock-history.sh"
REAL_TIMEOUT_BIN=$(command -v timeout)
REAL_NODE_BIN=$(command -v node)
REAL_NODE_BIN_DIR=$(dirname "$REAL_NODE_BIN")
REAL_NPM_BIN=$(command -v npm)
REAL_NPX_BIN=$(command -v npx)
REAL_PNPM_BIN=$(command -v pnpm)
REAL_PNPM_VERSION=$("$REAL_PNPM_BIN" --version)
REAL_PYTHON_BIN=$(command -v python3)
OPENSSL_BIN=$(command -v openssl)
TAR_BIN=$(command -v tar)
export SYNC_REAL_TIMEOUT="$REAL_TIMEOUT_BIN"
TEST_ROOT=$(mktemp -d)
TLS_SERVER_PID=""
ACTIVE_RUNNER_PIDS=()
SYNTHETIC_HISTORY_FILES=()

cleanup_test_root() {
  local pid
  for pid in "${ACTIVE_RUNNER_PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  if [[ -n "$TLS_SERVER_PID" ]]; then
    kill "$TLS_SERVER_PID" 2>/dev/null || true
    wait "$TLS_SERVER_PID" 2>/dev/null || true
  fi
  for history_file in "${SYNTHETIC_HISTORY_FILES[@]}"; do
    rm -f -- "$history_file"
  done
  rm -rf "$TEST_ROOT"
}
trap cleanup_test_root EXIT

REQUIRED_NODE_VERSION="24.20.0"
REQUIRED_PNPM_VERSION="12.8.1"

assert_contains() {
  local haystack="$1"
  local needle="$2"
  if [[ "$haystack" != *"$needle"* ]]; then
    printf 'Expected output to contain: %s\nActual output:\n%s\n' \
      "$needle" "$haystack" >&2
    return 1
  fi
}

assert_not_contains() {
  local haystack="$1"
  local needle="$2"
  if [[ "$haystack" == *"$needle"* ]]; then
    printf 'Expected output not to contain: %s\nActual output:\n%s\n' \
      "$needle" "$haystack" >&2
    return 1
  fi
}

make_workspace() {
  local name="$1"
  local workspace="${TEST_ROOT}/${name}"

  mkdir -p "${workspace}/scripts/src" "${workspace}/bin" "${workspace}/pinned-bin"
  cp "$LAUNCHER" "${workspace}/scripts/src/run-release-node.sh"
  cp "${SCRIPT_DIR}/run-release-command.py" \
    "${workspace}/scripts/src/run-release-command.py"
  cp "${SCRIPT_DIR}/release-node-https-only.cjs" \
    "${workspace}/scripts/src/release-node-https-only.cjs"
  cp "$HISTORY_VIEWER" "${workspace}/scripts/src/show-release-lock-history.sh"
  printf '%s\n' "$REQUIRED_NODE_VERSION" >"${workspace}/.nvmrc"
  printf '{"packageManager":"pnpm@%s"}\n' "$REQUIRED_PNPM_VERSION" \
    >"${workspace}/package.json"

  cat >"${workspace}/bin/release-child" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

printf 'child-node=%s\n' "$(node --version)" >>"$RUN_LOG"
printf 'node-options=%s\n' "${NODE_OPTIONS:-unset}" >>"$RUN_LOG"
printf 'node-system-ca=%s\n' "${NODE_USE_SYSTEM_CA:-unset}" >>"$RUN_LOG"
printf 'ssl-cert-file-readable=%s\n' \
  "$([[ -r "${SSL_CERT_FILE:-}" && -s "${SSL_CERT_FILE:-}" ]] && echo yes || echo no)" >>"$RUN_LOG"
printf 'ssl-cert-dir-readable=%s\n' \
  "$([[ -d "${SSL_CERT_DIR:-}" && -r "${SSL_CERT_DIR:-}" ]] && echo yes || echo no)" >>"$RUN_LOG"
pnpm --filter @workspace/scripts exec node --version
EOF
  cat >"${workspace}/bin/pnpm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

printf 'package-child-node=%s\n' "$(node --version)" >>"$RUN_LOG"
EOF
  chmod +x "${workspace}/bin/release-child" "${workspace}/bin/pnpm"

  printf '%s\n' "$workspace"
}

lock_history_path() {
  local workspace="$1"
  local digest
  local key
  digest=$(printf '%s' "$workspace" | sha256sum)
  key=${digest%% *}
  printf '/tmp/replit-release-runner-%s/%s.wait-history.jsonl\n' \
    "${UID:-$(id -u)}" "$key"
}

prepare_synthetic_history() {
  local workspace="$1"
  local history_file
  local history_dir
  history_file=$(lock_history_path "$workspace")
  history_dir=$(dirname "$history_file")
  mkdir -p "$history_dir"
  chmod 700 -- "$history_dir"
  : >"$history_file"
  chmod 600 -- "$history_file"
  SYNTHETIC_HISTORY_FILES+=("$history_file")
  printf '%s\n' "$history_file"
}

test_release_runner_lock_history_viewer_handles_missing_and_malformed_history() {
  local workspace
  local history_file
  local output
  workspace=$(make_workspace lock-history-viewer-missing)

  output=$(bash "${workspace}/scripts/src/show-release-lock-history.sh")
  assert_contains "$output" "No local lock-wait history found for this workspace."
  assert_contains "$output" \
    "This local history does not include Replit-managed task-runner waits."

  workspace=$(make_workspace lock-history-viewer-malformed)
  history_file=$(prepare_synthetic_history "$workspace")
  {
    printf '%s\n' '{"malformed":"LOCAL_VIEWER_SECRET_SENTINEL"}'
    printf '%s\n' \
      '{"timestamp_utc":"2026-01-01T00:00:00Z","elapsed_wait_seconds":8,"outcome":"acquired","owner_pid":"123","owner_started_at":"2026-01-01T00:00:00Z","command":"LOCAL_VIEWER_SECRET_SENTINEL"}'
    printf '%s\n' '{"timestamp_utc":"truncated'
  } >"$history_file"

  output=$(bash "${workspace}/scripts/src/show-release-lock-history.sh")
  assert_contains "$output" "No valid local lock-wait history records found."
  assert_not_contains "$output" "LOCAL_VIEWER_SECRET_SENTINEL"
  assert_not_contains "$output" '"command"'
  assert_contains "$output" \
    "This local history does not include Replit-managed task-runner waits."
  echo "PASS: lock-history viewer handles missing and malformed history without exposing raw lines"
}

test_release_runner_lock_history_viewer_shows_only_recent_safe_fields() {
  local workspace
  local history_file
  local before_hash
  local after_hash
  local output
  local attempt
  local row_count
  workspace=$(make_workspace lock-history-viewer-normal)
  history_file=$(prepare_synthetic_history "$workspace")

  for ((attempt = 1; attempt <= 22; attempt++)); do
    printf \
      '{"timestamp_utc":"2026-01-01T00:00:00Z","elapsed_wait_seconds":%s,"outcome":"acquired","owner_pid":"%s","owner_started_at":"2026-01-01T00:00:00Z"}\n' \
      "$attempt" "$((1000 + attempt))" >>"$history_file"
  done
  before_hash=$(sha256sum "$history_file")
  output=$(bash "${workspace}/scripts/src/show-release-lock-history.sh")
  after_hash=$(sha256sum "$history_file")

  [[ "$before_hash" == "$after_hash" ]] || {
    printf 'Lock-history viewer modified the history file.\n' >&2
    return 1
  }
  assert_contains "$output" \
    $'2026-01-01T00:00:00Z\t3\tacquired\t1003\t2026-01-01T00:00:00Z'
  assert_contains "$output" \
    $'2026-01-01T00:00:00Z\t22\tacquired\t1022\t2026-01-01T00:00:00Z'
  assert_not_contains "$output" $'2026-01-01T00:00:00Z\t1\t'
  row_count=$(grep -c $'\t' <<<"$output")
  [[ "$row_count" -eq 21 ]] || {
    printf 'Expected one table header and 20 retained rows, got %s.\n' \
      "$row_count" >&2
    return 1
  }
  assert_contains "$output" \
    "This local history does not include Replit-managed task-runner waits."
  echo "PASS: lock-history viewer displays only the newest 20 safe fields and leaves history unchanged"
}

test_release_runner_lock_history_viewer_rejects_symlinked_history_without_reading_or_modifying_target() {
  local workspace
  local history_file
  local target_file
  local before_hash
  local after_hash
  local before_link
  local after_link
  local output
  local status=0
  workspace=$(make_workspace lock-history-viewer-symlink)
  history_file=$(prepare_synthetic_history "$workspace")
  target_file="${workspace}/symlink-target.jsonl"
  printf '%s\n' \
    '{"timestamp_utc":"2026-01-01T00:00:00Z","elapsed_wait_seconds":8,"outcome":"acquired","owner_pid":"123","owner_started_at":"2026-01-01T00:00:00Z","command":"LOCAL_SYMLINK_TARGET_SENTINEL"}' \
    >"$target_file"
  chmod 600 -- "$target_file"
  rm -f -- "$history_file"
  ln -s -- "$target_file" "$history_file"
  before_hash=$(sha256sum "$target_file")
  before_link=$(readlink -- "$history_file")

  output=$(bash "${workspace}/scripts/src/show-release-lock-history.sh" 2>&1) ||
    status=$?
  [[ "$status" -eq 1 ]] || {
    printf 'Expected symlinked history rejection, got status %s.\n' "$status" >&2
    return 1
  }
  [[ "$output" == *"its file is unavailable."* ]] || {
    printf 'Symlinked history was not rejected with the expected diagnostic.\n' >&2
    return 1
  }
  [[ "$output" != *"LOCAL_SYMLINK_TARGET_SENTINEL"* ]] || {
    printf 'Viewer exposed the symlink target contents.\n' >&2
    return 1
  }

  after_hash=$(sha256sum "$target_file")
  after_link=$(readlink -- "$history_file")
  [[ "$before_hash" == "$after_hash" && "$before_link" == "$after_link" &&
    -L "$history_file" ]] || {
    printf 'Viewer changed the symlink or its target.\n' >&2
    return 1
  }
  echo "PASS: lock-history viewer rejects symlinked history without exposing or changing its target"
}

test_release_runner_lock_history_viewer_rejects_broad_history_permissions_without_reading_or_modifying_file() {
  local workspace
  local history_file
  local before_hash
  local after_hash
  local before_mode
  local after_mode
  local output
  local status=0
  workspace=$(make_workspace lock-history-viewer-broad-permissions)
  history_file=$(prepare_synthetic_history "$workspace")
  printf '%s\n' \
    '{"timestamp_utc":"2026-01-01T00:00:00Z","elapsed_wait_seconds":8,"outcome":"acquired","owner_pid":"123","owner_started_at":"2026-01-01T00:00:00Z","command":"LOCAL_BROAD_PERMISSION_SENTINEL"}' \
    >"$history_file"
  chmod 644 -- "$history_file"
  before_hash=$(sha256sum "$history_file")
  before_mode=$(stat -c '%a' -- "$history_file")

  output=$(bash "${workspace}/scripts/src/show-release-lock-history.sh" 2>&1) ||
    status=$?
  [[ "$status" -eq 1 ]] || {
    printf 'Expected broadly permissioned history rejection, got status %s.\n' \
      "$status" >&2
    return 1
  }
  [[ "$output" == *"its file is unavailable."* ]] || {
    printf 'Broadly permissioned history was not rejected with the expected diagnostic.\n' >&2
    return 1
  }
  [[ "$output" != *"LOCAL_BROAD_PERMISSION_SENTINEL"* ]] || {
    printf 'Viewer exposed the broadly permissioned history contents.\n' >&2
    return 1
  }

  after_hash=$(sha256sum "$history_file")
  after_mode=$(stat -c '%a' -- "$history_file")
  [[ "$before_hash" == "$after_hash" && "$before_mode" == "$after_mode" ]] || {
    printf 'Viewer changed the broadly permissioned history file.\n' >&2
    return 1
  }
  echo "PASS: lock-history viewer rejects broad file permissions without exposing or changing history"
}

point_history_viewer_at_test_directory() {
  local workspace="$1"
  local viewer="${workspace}/scripts/src/show-release-lock-history.sh"

  sed -i "s|^lock_dir=.*\$|lock_dir=\"\${TEST_LOCK_DIR}\"|" "$viewer"
}

test_release_runner_lock_history_viewer_rejects_symlinked_history_directory_without_reading_or_modifying_target() {
  local workspace
  local original_history_file
  local history_name
  local history_dir
  local target_dir
  local target_file
  local before_hash
  local after_hash
  local before_link
  local after_link
  local before_dir_mode
  local after_dir_mode
  local before_file_mode
  local after_file_mode
  local output
  local status=0
  workspace=$(make_workspace lock-history-viewer-symlink-directory)
  original_history_file=$(lock_history_path "$workspace")
  history_name=$(basename "$original_history_file")
  history_dir="${workspace}/lock-history-path"
  target_dir="${workspace}/lock-history-target"
  target_file="${target_dir}/${history_name}"
  mkdir -m 700 -- "$target_dir"
  printf '%s\n' \
    '{"timestamp_utc":"2026-01-01T00:00:00Z","elapsed_wait_seconds":8,"outcome":"acquired","owner_pid":"123","owner_started_at":"2026-01-01T00:00:00Z","command":"LOCAL_SYMLINK_DIRECTORY_SENTINEL"}' \
    >"$target_file"
  chmod 600 -- "$target_file"
  before_hash=$(sha256sum "$target_file")
  before_dir_mode=$(stat -c '%a' -- "$target_dir")
  before_file_mode=$(stat -c '%a' -- "$target_file")
  ln -s -- "$target_dir" "$history_dir"
  before_link=$(readlink -- "$history_dir")
  point_history_viewer_at_test_directory "$workspace"

  output=$(TEST_LOCK_DIR="$history_dir" \
    bash "${workspace}/scripts/src/show-release-lock-history.sh" 2>&1) || status=$?
  [[ "$status" -eq 1 ]] || {
    printf 'Expected symlinked history directory rejection, got status %s.\n' \
      "$status" >&2
    return 1
  }
  [[ "$output" == *"its private directory is unavailable."* ]] || {
    printf 'Symlinked history directory was not rejected with the expected diagnostic.\n' >&2
    return 1
  }
  assert_not_contains "$output" "LOCAL_SYMLINK_DIRECTORY_SENTINEL"

  after_hash=$(sha256sum "$target_file")
  after_link=$(readlink -- "$history_dir")
  after_dir_mode=$(stat -c '%a' -- "$target_dir")
  after_file_mode=$(stat -c '%a' -- "$target_file")
  [[ -L "$history_dir" && "$before_link" == "$after_link" &&
    "$before_hash" == "$after_hash" &&
    "$before_dir_mode" == "$after_dir_mode" &&
    "$before_file_mode" == "$after_file_mode" ]] || {
    printf 'Viewer changed the symlinked history directory or its target.\n' >&2
    return 1
  }
  rm -f -- "$history_dir"
  echo "PASS: lock-history viewer rejects symlinked history directories without exposing or changing their targets"
}

test_release_runner_lock_history_viewer_rejects_broad_history_directory_permissions_without_reading_or_modifying_contents() {
  local workspace
  local original_history_file
  local history_name
  local history_file
  local history_dir
  local before_hash
  local after_hash
  local before_dir_mode
  local after_dir_mode
  local before_file_mode
  local after_file_mode
  local output
  local status=0
  workspace=$(make_workspace lock-history-viewer-broad-directory-permissions)
  original_history_file=$(lock_history_path "$workspace")
  history_name=$(basename "$original_history_file")
  history_dir="${workspace}/private-lock-history"
  history_file="${history_dir}/${history_name}"
  mkdir -m 700 -- "$history_dir"
  printf '%s\n' \
    '{"timestamp_utc":"2026-01-01T00:00:00Z","elapsed_wait_seconds":8,"outcome":"acquired","owner_pid":"123","owner_started_at":"2026-01-01T00:00:00Z","command":"LOCAL_BROAD_DIRECTORY_PERMISSION_SENTINEL"}' \
    >"$history_file"
  chmod 600 -- "$history_file"
  chmod 755 -- "$history_dir"
  before_hash=$(sha256sum "$history_file")
  before_dir_mode=$(stat -c '%a' -- "$history_dir")
  before_file_mode=$(stat -c '%a' -- "$history_file")
  point_history_viewer_at_test_directory "$workspace"

  output=$(TEST_LOCK_DIR="$history_dir" \
    bash "${workspace}/scripts/src/show-release-lock-history.sh" 2>&1) || status=$?
  [[ "$status" -eq 1 ]] || {
    printf 'Expected broadly permissioned history directory rejection, got status %s.\n' \
      "$status" >&2
    return 1
  }
  [[ "$output" == *"its private directory is unavailable."* ]] || {
    printf 'Broadly permissioned history directory was not rejected with the expected diagnostic.\n' >&2
    return 1
  }
  assert_not_contains "$output" "LOCAL_BROAD_DIRECTORY_PERMISSION_SENTINEL"

  after_hash=$(sha256sum "$history_file")
  after_dir_mode=$(stat -c '%a' -- "$history_dir")
  after_file_mode=$(stat -c '%a' -- "$history_file")
  [[ -d "$history_dir" && ! -L "$history_dir" &&
    "$before_hash" == "$after_hash" &&
    "$before_dir_mode" == "$after_dir_mode" &&
    "$before_file_mode" == "$after_file_mode" ]] || {
    printf 'Viewer changed the broadly permissioned history directory or its contents.\n' >&2
    return 1
  }
  echo "PASS: lock-history viewer rejects broad directory permissions without exposing or changing history"
}

write_node() {
  local node_path="$1"
  local node_version="$2"

  cat >"$node_path" <<EOF
#!/usr/bin/env bash
set -euo pipefail

if [[ "\${1:-}" == "--version" ]]; then
  printf '%s\n' 'v${node_version}'
  exit 0
fi

if [[ "\${1:-}" == *check-routine-node-version.mjs ]]; then
  printf 'preflight-node=%s\n' 'v${node_version}' >>"\$RUN_LOG"
  exit 0
fi

printf 'Unexpected fake node invocation: %s\n' "\$*" >&2
exit 1
EOF
  chmod +x "$node_path"
}

write_failing_npx() {
  local npx_path="$1"

  cat >"$npx_path" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

printf 'npx-invoked\n' >>"$RUN_LOG"
exit 1
EOF
  chmod +x "$npx_path"
}

write_resolution_failure_npx() {
  local npx_path="$1"

  cat >"$npx_path" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

printf 'npx-invoked\n' >>"$RUN_LOG"
printf 'simulated npx package resolution failure\n' >&2
exit 1
EOF
  chmod +x "$npx_path"
}

write_pinned_npx() {
  local npx_path="$1"
  local pinned_node_bin="$2"

  cat >"$npx_path" <<EOF
#!/usr/bin/env bash
set -euo pipefail

printf 'npx-invoked\n' >>"\$RUN_LOG"
printf 'npx-node-options=%s\n' "\${NODE_OPTIONS:-unset}" >>"\$RUN_LOG"
printf 'npx-node-system-ca=%s\n' "\${NODE_USE_SYSTEM_CA:-unset}" >>"\$RUN_LOG"
printf 'npx-registry=%s\n' "\${npm_config_registry:-unset}" >>"\$RUN_LOG"
fallback_dir=\$(dirname "\$RELEASE_NODE_FALLBACK_MARKER")
if [[ "\${npm_config_cache:-}" == "\$fallback_dir/npm-cache" &&
  -d "\${npm_config_cache:-}" ]]; then
  printf 'npx-cache-isolated=yes\n' >>"\$RUN_LOG"
else
  printf 'npx-cache-isolated=no\n' >>"\$RUN_LOG"
fi

args=("\$@")
  separator=-1
for ((index = 0; index < \${#args[@]}; index++)); do
  if [[ "\${args[index]}" == "--" ]]; then
      separator="\$index"
    break
  fi
done

if (( separator < 0 )); then
  printf 'Expected npx arguments to contain --.\n' >&2
  exit 1
fi

export PATH="${pinned_node_bin}:\$PATH"
command_args=("\${args[@]:\$((separator + 1))}")
exec "\${command_args[@]}"
EOF
  chmod +x "$npx_path"
}

write_wrong_version_npx() {
  local npx_path="$1"
  local wrong_node_bin="$2"

  cat >"$npx_path" <<EOF
#!/usr/bin/env bash
set -euo pipefail

printf 'npx-invoked\n' >>"\$RUN_LOG"

args=("\$@")
separator=-1
for ((index = 0; index < \${#args[@]}; index++)); do
  if [[ "\${args[index]}" == "--" ]]; then
    separator="\$index"
    break
  fi
done

if (( separator < 0 )); then
  printf 'Expected npx arguments to contain --.\n' >&2
  exit 1
fi

export PATH="${wrong_node_bin}:\$PATH"
command_args=("\${args[@]:\$((separator + 1))}")
exec "\${command_args[@]}"
EOF
  chmod +x "$npx_path"
}

run_launcher() {
  local workspace="$1"
  local log_path="$2"
  local path_value="$3"
  local output_path="${workspace}/output"
  local -a node_options_env=(-u NODE_OPTIONS)
  local -a registry_env=()
  if (( $# >= 4 )); then
    node_options_env=("NODE_OPTIONS=$4")
  fi
  if (( $# >= 5 )); then
    registry_env=("RELEASE_NODE_NPM_REGISTRY=$5")
  fi

  set +e
  env "${node_options_env[@]}" \
    npm_config_registry="http://package-firewall.replit.internal/npm/" \
    "${registry_env[@]}" \
    SSL_CERT_FILE="${workspace}/missing-ca.pem" \
    SSL_CERT_DIR="${workspace}/missing-ca-dir" \
    RUN_LOG="$log_path" PATH="$path_value" \
    bash "${workspace}/scripts/src/run-release-node.sh" release-child \
    >"$output_path" 2>&1
  RUN_STATUS=$?
  set -e
  RUN_OUTPUT=$(cat "$output_path")
}

path_without_npx() {
  local path_entry
  local filtered_path=""
  local path_entries=()

  IFS=: read -r -a path_entries <<<"$PATH"
  for path_entry in "${path_entries[@]}"; do
    [[ -x "${path_entry}/npx" ]] && continue
    if [[ -n "$filtered_path" ]]; then
      filtered_path+=":"
    fi
    filtered_path+="$path_entry"
  done

  printf '%s\n' "$filtered_path"
}

test_matching_node_skips_npx() {
  local workspace
  local log_path
  workspace=$(make_workspace matching)
  log_path="${workspace}/events"

  write_node "${workspace}/bin/node" "$REQUIRED_NODE_VERSION"
  write_failing_npx "${workspace}/bin/npx"

  run_launcher "$workspace" "$log_path" \
    "${workspace}/bin:${PATH}"

  [[ "$RUN_STATUS" -eq 0 ]] || {
    printf 'Matching Node path failed. Output:\n%s\n' "$RUN_OUTPUT" >&2
    return 1
  }
  local events
  events=$(cat "$log_path")
  assert_contains "$events" "preflight-node=v${REQUIRED_NODE_VERSION}"
  assert_contains "$events" "child-node=v${REQUIRED_NODE_VERSION}"
  assert_contains "$events" \
    "node-options=--require=\"${workspace}/scripts/src/release-node-https-only.cjs\""
  assert_contains "$events" "node-system-ca=0"
  assert_contains "$events" "ssl-cert-file-readable=yes"
  assert_contains "$events" "ssl-cert-dir-readable=yes"
  assert_contains "$events" "package-child-node=v${REQUIRED_NODE_VERSION}"
  assert_not_contains "$events" "npx-invoked"
  echo "PASS: matching Node path runs preflight, skips npx, and preserves Node for the child"
}

test_pinned_pnpm_bootstrap_uses_package_manager_pin_and_cleans_cache() {
  local workspace
  local log_path
  local output_path
  local cache_path
  local cache_count
  local status
  workspace=$(make_workspace pinned-pnpm-bootstrap)
  log_path="${workspace}/events"
  output_path="${workspace}/output"

  write_node "${workspace}/bin/node" "$REQUIRED_NODE_VERSION"
  cat >"${workspace}/bin/npm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

[[ "${1:-}" == "exec" &&
  "${2:-}" == "--yes" &&
  "${3:-}" == "--package=pnpm@${PINNED_PNPM_VERSION}" &&
  "${4:-}" == "--" &&
  "${5:-}" == "pnpm" ]] || {
  printf 'Unexpected npm package-manager bootstrap arguments: %s\n' "$*" >&2
  exit 2
}
[[ "${npm_config_registry:-}" == "https://registry.npmjs.org/" ]] || {
  printf 'Pinned pnpm bootstrap did not use the HTTPS registry.\n' >&2
  exit 2
}
[[ "${NODE_USE_SYSTEM_CA:-}" == "0" &&
  "${NODE_OPTIONS:-}" == *release-node-https-only.cjs* ]] || {
  printf 'Pinned pnpm bootstrap lost the Node or HTTPS safeguards.\n' >&2
  exit 2
}
[[ -n "${npm_config_cache:-}" && "${npm_config_cache:-}" != *"/workspace/"* ]] || {
  printf 'Pinned pnpm bootstrap cache was not isolated from the repository.\n' >&2
  exit 2
}
printf 'pnpm-bootstrap-cache=%s\n' "$npm_config_cache" >>"$RUN_LOG"
printf 'pnpm-bootstrap-registry=%s\n' "$npm_config_registry" >>"$RUN_LOG"
mkdir -p -- "$npm_config_cache"
printf 'temporary-tool-cache\n' >"${npm_config_cache}/fixture"
shift 5
exec "$PINNED_PNPM_BIN" "$@"
EOF
  cat >"${workspace}/bin/pinned-pnpm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

printf 'selected-pnpm=%s\n' "$PINNED_PNPM_VERSION" >>"$RUN_LOG"
if [[ "${1:-}" == "--version" ]]; then
  printf '%s\n' "$PINNED_PNPM_VERSION"
elif [[ "${1:-}" == "exec" ]]; then
  shift
  exec "$@"
else
  printf 'Unexpected pinned pnpm command: %s\n' "$*" >&2
  exit 2
fi
EOF
  cat >"${workspace}/bin/pnpm-child" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

printf 'pnpm-child-executed node=%s\n' "$(node --version)" >>"$RUN_LOG"
EOF
  chmod +x "${workspace}/bin/npm" "${workspace}/bin/pinned-pnpm" \
    "${workspace}/bin/pnpm-child"

  set +e
  RUN_LOG="$log_path" \
    PINNED_PNPM_BIN="${workspace}/bin/pinned-pnpm" \
    PINNED_PNPM_VERSION="$REQUIRED_PNPM_VERSION" \
    PATH="${workspace}/bin:${PATH}" \
    bash "${workspace}/scripts/src/run-release-node.sh" pnpm --version \
    >"$output_path" 2>&1
  status=$?
  set -e
  [[ "$status" -eq 0 ]] || {
    printf 'Pinned pnpm version command failed (status %s):\n' "$status" >&2
    cat "$output_path" >&2
    return 1
  }
  [[ "$(cat "$output_path")" == "$REQUIRED_PNPM_VERSION" ]] || {
    printf 'Pinned pnpm reported the wrong version:\n' >&2
    cat "$output_path" >&2
    return 1
  }

  set +e
  RUN_LOG="$log_path" \
    PINNED_PNPM_BIN="${workspace}/bin/pinned-pnpm" \
    PINNED_PNPM_VERSION="$REQUIRED_PNPM_VERSION" \
    PATH="${workspace}/bin:${PATH}" \
    bash "${workspace}/scripts/src/run-release-node.sh" \
    pnpm exec "${workspace}/bin/pnpm-child" \
    >"$output_path" 2>&1
  status=$?
  set -e
  [[ "$status" -eq 0 ]] || {
    printf 'Pinned pnpm child command failed (status %s):\n' "$status" >&2
    cat "$output_path" >&2
    return 1
  }

  assert_contains "$(cat "$log_path")" "selected-pnpm=${REQUIRED_PNPM_VERSION}"
  assert_contains "$(cat "$log_path")" \
    "pnpm-child-executed node=v${REQUIRED_NODE_VERSION}"
  assert_contains "$(cat "$log_path")" \
    "pnpm-bootstrap-registry=https://registry.npmjs.org/"
  cache_count=$(grep -c '^pnpm-bootstrap-cache=' "$log_path")
  [[ "$cache_count" -eq 2 ]] || {
    printf 'Expected two isolated pnpm caches to be recorded, got %s.\n' \
      "$cache_count" >&2
    return 1
  }
  while IFS= read -r cache_path; do
    [[ -n "$cache_path" && ! -e "$(dirname "$cache_path")" ]] || {
      printf 'Pinned pnpm temporary cache was not cleaned: %s\n' "$cache_path" >&2
      return 1
    }
  done < <(sed -n 's/^pnpm-bootstrap-cache=//p' "$log_path")
  echo "PASS: pnpm uses the packageManager pin, runs children with pinned Node, and removes its isolated cache"
}

test_mismatching_node_uses_npx() {
  local workspace
  local log_path
  workspace=$(make_workspace mismatching)
  log_path="${workspace}/events"

  write_node "${workspace}/bin/node" "24.19.0"
  write_node "${workspace}/pinned-bin/node" "$REQUIRED_NODE_VERSION"
  write_pinned_npx "${workspace}/bin/npx" "${workspace}/pinned-bin"

  run_launcher "$workspace" "$log_path" \
    "${workspace}/bin:${PATH}" "--trace-warnings"

  [[ "$RUN_STATUS" -eq 0 ]] || {
    printf 'Mismatching Node path failed. Output:\n%s\n' "$RUN_OUTPUT" >&2
    return 1
  }
  local events
  events=$(cat "$log_path")
  assert_contains "$events" "npx-invoked"
  assert_contains "$events" "npx-node-system-ca=0"
  assert_contains "$events" "node-system-ca=0"
  assert_contains "$events" \
    "npx-node-options=--trace-warnings --require=\"${workspace}/scripts/src/release-node-https-only.cjs\""
  assert_contains "$events" "npx-registry=https://registry.npmjs.org/"
  assert_contains "$events" "npx-cache-isolated=yes"
  assert_contains "$events" "preflight-node=v${REQUIRED_NODE_VERSION}"
  assert_contains "$events" "child-node=v${REQUIRED_NODE_VERSION}"
  assert_contains "$events" \
    "node-options=--trace-warnings --require=\"${workspace}/scripts/src/release-node-https-only.cjs\""
  assert_contains "$events" "package-child-node=v${REQUIRED_NODE_VERSION}"
  echo "PASS: mismatching Node path invokes npx, runs preflight, and keeps the HTTPS-only guard for the child"
}

test_concurrent_fallbacks_use_private_npm_caches() {
  local workspace_a
  local workspace_b
  local shared_home="${TEST_ROOT}/concurrent-shared-home"
  local shared_cache="${shared_home}/.npm"
  local shared_config="${shared_home}/.npmrc"
  local temp_root="${TEST_ROOT}/concurrent-tmp"
  local barrier="${TEST_ROOT}/concurrent-npx-barrier"
  local shared_cache_hash_before
  local shared_cache_hash_after
  local config_hash_before
  local config_hash_after
  local cache_a
  local cache_b
  local fallback_dir_a
  local fallback_dir_b
  local launcher_pid_a
  local launcher_pid_b
  local status_a=0
  local status_b=0
  local output_a
  local output_b
  local attempt
  local workspace
  local capture
  local events
  local path

  workspace_a=$(make_workspace concurrent-fallback-a)
  workspace_b=$(make_workspace concurrent-fallback-b)
  mkdir -p -- "$shared_home" "$shared_cache" "$temp_root" "$barrier"
  chmod 700 -- "$shared_home" "$shared_cache" "$temp_root" "$barrier"
  printf '%s\n' \
    'registry=http://shared-config.invalid/npm/' \
    "cache=${shared_cache}" >"$shared_config"
  printf 'shared-cache-sentinel\n' >"${shared_cache}/sentinel"
  chmod 600 -- "$shared_config" "${shared_cache}/sentinel"
  shared_cache_hash_before=$(sha256sum "$shared_cache/sentinel")
  config_hash_before=$(sha256sum "$shared_config")

  write_node "${workspace_a}/bin/node" "24.19.0"
  write_node "${workspace_b}/bin/node" "24.19.0"
  write_node "${workspace_a}/pinned-bin/node" "$REQUIRED_NODE_VERSION"
  write_node "${workspace_b}/pinned-bin/node" "$REQUIRED_NODE_VERSION"

  for workspace in "$workspace_a" "$workspace_b"; do
    cat >"${workspace}/bin/npx" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

: "${RUN_LOG:?}"
: "${NPX_CAPTURE:?}"
: "${NPX_BARRIER:?}"
: "${PINNED_NODE_BIN:?}"

fallback_dir=$(dirname "$RELEASE_NODE_FALLBACK_MARKER")
{
  printf 'home=%s\n' "$HOME"
  printf 'userconfig=%s\n' "${npm_config_userconfig:-unset}"
  printf 'inherited-cache=%s\n' "$EXPECTED_SHARED_CACHE"
  printf 'registry=%s\n' "${npm_config_registry:-unset}"
  printf 'fallback-marker=%s\n' "$RELEASE_NODE_FALLBACK_MARKER"
  printf 'fallback-dir=%s\n' "$fallback_dir"
  printf 'fallback-dir-mode=%s\n' "$(stat -c '%a' "$fallback_dir")"
  printf 'private-cache=%s\n' "${npm_config_cache:-unset}"
  printf 'private-cache-mode=%s\n' "$(stat -c '%a' "$npm_config_cache")"
} >"$NPX_CAPTURE"
grep -Fx "cache=${EXPECTED_SHARED_CACHE}" "$npm_config_userconfig" >/dev/null
grep -Fx "registry=http://shared-config.invalid/npm/" \
  "$npm_config_userconfig" >/dev/null

touch "${NPX_BARRIER}/$(basename "$NPX_CAPTURE").ready"
for ((attempt = 0; attempt < 200; attempt++)); do
  [[ -f "${NPX_BARRIER}/npx-a.ready" &&
    -f "${NPX_BARRIER}/npx-b.ready" ]] && break
  sleep 0.05
done
if [[ ! -f "${NPX_BARRIER}/npx-a.ready" ||
  ! -f "${NPX_BARRIER}/npx-b.ready" ]]; then
  printf 'Concurrent fallback barrier timed out.\n' >&2
  exit 1
fi

args=("$@")
separator=-1
for ((index = 0; index < ${#args[@]}; index++)); do
  if [[ "${args[index]}" == "--" ]]; then
    separator="$index"
    break
  fi
done
if (( separator < 0 )); then
  printf 'Expected npx arguments to contain --.\n' >&2
  exit 1
fi

export PATH="${PINNED_NODE_BIN}:$PATH"
command_args=("${args[@]:$((separator + 1))}")
exec "${command_args[@]}"
EOF
    chmod +x "${workspace}/bin/npx"
  done

  (
    env -u NODE_OPTIONS \
      HOME="$shared_home" \
      TMPDIR="$temp_root" \
      npm_config_userconfig="$shared_config" \
      npm_config_cache="$shared_cache" \
      npm_config_registry="http://inherited-config.invalid/npm/" \
      RELEASE_NODE_NPM_REGISTRY="https://registry.npmjs.org/" \
      RUN_LOG="${workspace_a}/events" \
      NPX_CAPTURE="${TEST_ROOT}/npx-a" \
      NPX_BARRIER="$barrier" \
      EXPECTED_SHARED_CACHE="$shared_cache" \
      PINNED_NODE_BIN="${workspace_a}/pinned-bin" \
      PATH="${workspace_a}/bin:${PATH}" \
      bash "${workspace_a}/scripts/src/run-release-node.sh" release-child \
      >"${workspace_a}/output" 2>&1
  ) &
  launcher_pid_a=$!
  ACTIVE_RUNNER_PIDS+=("$launcher_pid_a")

  (
    env -u NODE_OPTIONS \
      HOME="$shared_home" \
      TMPDIR="$temp_root" \
      npm_config_userconfig="$shared_config" \
      npm_config_cache="$shared_cache" \
      npm_config_registry="http://inherited-config.invalid/npm/" \
      RELEASE_NODE_NPM_REGISTRY="https://registry.npmjs.org/" \
      RUN_LOG="${workspace_b}/events" \
      NPX_CAPTURE="${TEST_ROOT}/npx-b" \
      NPX_BARRIER="$barrier" \
      EXPECTED_SHARED_CACHE="$shared_cache" \
      PINNED_NODE_BIN="${workspace_b}/pinned-bin" \
      PATH="${workspace_b}/bin:${PATH}" \
      bash "${workspace_b}/scripts/src/run-release-node.sh" release-child \
      >"${workspace_b}/output" 2>&1
  ) &
  launcher_pid_b=$!
  ACTIVE_RUNNER_PIDS+=("$launcher_pid_b")

  if wait "$launcher_pid_a"; then
    status_a=0
  else
    status_a=$?
  fi
  if wait "$launcher_pid_b"; then
    status_b=0
  else
    status_b=$?
  fi
  output_a=$(cat "${workspace_a}/output")
  output_b=$(cat "${workspace_b}/output")
  if (( status_a != 0 || status_b != 0 )); then
    printf 'Concurrent fallback runs failed (a=%s, b=%s).\nRun A:\n%s\nRun B:\n%s\n' \
      "$status_a" "$status_b" "$output_a" "$output_b" >&2
    return 1
  fi

  for capture in "${TEST_ROOT}/npx-a" "${TEST_ROOT}/npx-b"; do
    [[ -f "$capture" ]] || {
      printf 'Missing concurrent npx capture: %s\n' "$capture" >&2
      return 1
    }
    assert_contains "$(cat "$capture")" "home=${shared_home}"
    assert_contains "$(cat "$capture")" "userconfig=${shared_config}"
    assert_contains "$(cat "$capture")" "inherited-cache=${shared_cache}"
    assert_contains "$(cat "$capture")" \
      "registry=https://registry.npmjs.org/"
    assert_contains "$(cat "$capture")" "fallback-dir-mode=700"
    assert_contains "$(cat "$capture")" "private-cache-mode=700"
    assert_contains "$(cat "$capture")" \
      "private-cache=$(sed -n 's/^fallback-dir=//p' "$capture")/npm-cache"
  done

  cache_a=$(sed -n 's/^private-cache=//p' "${TEST_ROOT}/npx-a")
  cache_b=$(sed -n 's/^private-cache=//p' "${TEST_ROOT}/npx-b")
  fallback_dir_a=$(sed -n 's/^fallback-dir=//p' "${TEST_ROOT}/npx-a")
  fallback_dir_b=$(sed -n 's/^fallback-dir=//p' "${TEST_ROOT}/npx-b")
  [[ "$cache_a" != "$cache_b" && "$fallback_dir_a" != "$fallback_dir_b" ]] || {
    printf 'Concurrent fallback invocations shared a private temporary cache.\n' >&2
    return 1
  }

  for workspace in "$workspace_a" "$workspace_b"; do
    events=$(cat "${workspace}/events")
    assert_contains "$events" "preflight-node=v${REQUIRED_NODE_VERSION}"
    assert_contains "$events" "child-node=v${REQUIRED_NODE_VERSION}"
    assert_contains "$events" "package-child-node=v${REQUIRED_NODE_VERSION}"
    assert_contains "$events" \
      "node-options=--require=\"${workspace}/scripts/src/release-node-https-only.cjs\""
  done

  for path in "$cache_a" "$cache_b" "$fallback_dir_a" "$fallback_dir_b"; do
    [[ ! -e "$path" ]] || {
      printf 'Completed fallback left temporary cache data behind: %s\n' "$path" >&2
      return 1
    }
  done
  shared_cache_hash_after=$(sha256sum "$shared_cache/sentinel")
  config_hash_after=$(sha256sum "$shared_config")
  [[ "$shared_cache_hash_before" == "$shared_cache_hash_after" &&
    "$config_hash_before" == "$config_hash_after" &&
    "$(find "$shared_cache" -mindepth 1 -maxdepth 1 -type f | wc -l)" -eq 1 ]] || {
    printf 'Concurrent fallback modified the shared npm cache or inherited config.\n' >&2
    return 1
  }

  # Verify both runners entered npx before either was allowed to continue.
  for ((attempt = 0; attempt < 200; attempt++)); do
    [[ -f "${barrier}/npx-a.ready" && -f "${barrier}/npx-b.ready" ]] && break
    sleep 0.05
  done
  [[ -f "${barrier}/npx-a.ready" && -f "${barrier}/npx-b.ready" ]] || {
    printf 'The fallback invocations did not overlap inside npx.\n' >&2
    return 1
  }

  echo "PASS: concurrent pinned-Node fallbacks use distinct private caches, run the exact Node version, and clean up without changing shared npm state"
}

test_invalid_npx_registry_fails_before_package_acquisition() {
  local workspace
  local log_path
  local status
  local invalid_registry
  local -a invalid_registries=(
    "http://registry.example.test/"
    "https://[not-ipv6]:443/"
    "https://[::1/"
    "https://::1:443/"
    "https://[::1]suffix/"
    "https://[::1]:not-a-port/"
    "https://[::::]/"
  )
  workspace=$(make_workspace invalid-npx-registry)

  write_node "${workspace}/bin/node" "24.19.0"
  write_pinned_npx "${workspace}/bin/npx" "${workspace}/pinned-bin"

  for invalid_registry in "${invalid_registries[@]}"; do
    log_path="${workspace}/events-${#invalid_registry}"
    set +e
    env \
      -u NODE_OPTIONS \
      npm_config_registry="http://package-firewall.replit.internal/npm/" \
      RELEASE_NODE_NPM_REGISTRY="$invalid_registry" \
      RUN_LOG="$log_path" \
      PATH="${workspace}/bin:${PATH}" \
      bash "${workspace}/scripts/src/run-release-node.sh" release-child \
      >"${workspace}/output" 2>&1
    status=$?
    set -e

    [[ "$status" -ne 0 ]] || {
      printf 'Invalid Node-acquisition registry unexpectedly succeeded: %s\n' \
        "$invalid_registry" >&2
      cat "${workspace}/output" >&2
      return 1
    }
    assert_contains "$(cat "${workspace}/output")" \
      "Release runner requires a valid HTTPS npm registry for pinned Node acquisition."
    [[ ! -s "$log_path" ]] || {
      printf 'Invalid npm registry reached npx package acquisition: %s\n' \
        "$invalid_registry" >&2
      cat "$log_path" >&2
      return 1
    }
  done
  echo "PASS: cleartext and malformed registries are rejected before npx package acquisition"
}

test_ipv6_npx_registry_url_is_forwarded() {
  local workspace
  local log_path
  local registry_url
  local -a registry_urls=(
    "https://[2001:db8::1]/registry/"
    "https://[::1]:8443/npm/registry/"
  )
  workspace=$(make_workspace ipv6-npx-registry-url)
  log_path="${workspace}/events"

  write_node "${workspace}/bin/node" "24.19.0"
  write_node "${workspace}/pinned-bin/node" "$REQUIRED_NODE_VERSION"
  write_pinned_npx "${workspace}/bin/npx" "${workspace}/pinned-bin"

  for registry_url in "${registry_urls[@]}"; do
    : >"$log_path"
    run_launcher "$workspace" "$log_path" \
      "${workspace}/bin:${PATH}" "" "$registry_url"

    [[ "$RUN_STATUS" -eq 0 ]] || {
      printf 'Pinned Node launcher rejected valid IPv6 registry URL %s:\n%s\n' \
        "$registry_url" "$RUN_OUTPUT" >&2
      return 1
    }
    assert_contains "$(cat "$log_path")" "npx-registry=${registry_url}"
    assert_contains "$(cat "$log_path")" \
      "child-node=v${REQUIRED_NODE_VERSION}"
  done
  echo "PASS: pinned Node launcher forwards bracketed IPv6 HTTPS registry URLs with and without ports"
}

test_wrong_fallback_node_version_fails_before_release_commands() {
  local workspace
  local log_path
  workspace=$(make_workspace wrong-fallback-version)
  log_path="${workspace}/events"

  write_node "${workspace}/bin/node" "24.19.0"
  write_node "${workspace}/pinned-bin/node" "24.19.0"
  write_wrong_version_npx "${workspace}/bin/npx" "${workspace}/pinned-bin"

  run_launcher "$workspace" "$log_path" \
    "${workspace}/bin:${PATH}"

  [[ "$RUN_STATUS" -ne 0 ]] || {
    printf 'Wrong fallback Node version unexpectedly succeeded. Output:\n%s\n' \
      "$RUN_OUTPUT" >&2
    return 1
  }
  assert_contains "$RUN_OUTPUT" \
    "Release runner resolved Node v24.19.0; expected v${REQUIRED_NODE_VERSION}."
  assert_not_contains "$RUN_OUTPUT" "could not make pinned Node package"
  local events
  events=$(cat "$log_path")
  assert_contains "$events" "npx-invoked"
  assert_not_contains "$events" "preflight-node="
  assert_not_contains "$events" "child-node="
  assert_not_contains "$events" "package-child-node="
  echo "PASS: wrong fallback Node version fails before preflight or child execution"
}

test_npx_package_resolution_failure_fails_before_release_commands() {
  local workspace
  local log_path
  workspace=$(make_workspace package-resolution-failure)
  log_path="${workspace}/events"

  write_node "${workspace}/bin/node" "24.19.0"
  write_resolution_failure_npx "${workspace}/bin/npx"

  run_launcher "$workspace" "$log_path" \
    "${workspace}/bin:${PATH}"

  [[ "$RUN_STATUS" -ne 0 ]] || {
    printf 'Package resolution failure unexpectedly succeeded. Output:\n%s\n' \
      "$RUN_OUTPUT" >&2
    return 1
  }
  assert_contains "$RUN_OUTPUT" "simulated npx package resolution failure"
  assert_contains "$RUN_OUTPUT" \
    "Release runner could not make pinned Node package node@${REQUIRED_NODE_VERSION} available via npx; refusing to run release command."
  local events
  events=$(cat "$log_path")
  assert_contains "$events" "npx-invoked"
  assert_not_contains "$events" "preflight-node="
  assert_not_contains "$events" "child-node="
  echo "PASS: npx package resolution failure reports the fallback boundary before release commands"
}

test_missing_node_selector_fails_before_release_commands() {
  local workspace
  local log_path
  workspace=$(make_workspace missing-selector)
  log_path="${workspace}/events"

  rm "${workspace}/.nvmrc"
  : >"$log_path"
  write_node "${workspace}/bin/node" "$REQUIRED_NODE_VERSION"
  write_failing_npx "${workspace}/bin/npx"

  run_launcher "$workspace" "$log_path" \
    "${workspace}/bin:${PATH}"

  [[ "$RUN_STATUS" -ne 0 ]] || {
    printf 'Missing Node selector unexpectedly succeeded. Output:\n%s\n' \
      "$RUN_OUTPUT" >&2
    return 1
  }
  assert_contains "$RUN_OUTPUT" \
    "Release Node selector is missing: ${workspace}/.nvmrc"
  local events
  events=$(cat "$log_path")
  assert_not_contains "$events" "npx-invoked"
  assert_not_contains "$events" "preflight-node="
  assert_not_contains "$events" "child-node="
  echo "PASS: missing Node selector fails before npx, preflight, or child execution"
}

test_empty_node_selector_fails_before_release_commands() {
  local workspace
  local log_path
  workspace=$(make_workspace empty-selector)
  log_path="${workspace}/events"

  : >"${workspace}/.nvmrc"
  : >"$log_path"
  write_node "${workspace}/bin/node" "$REQUIRED_NODE_VERSION"
  write_failing_npx "${workspace}/bin/npx"

  run_launcher "$workspace" "$log_path" \
    "${workspace}/bin:${PATH}"

  [[ "$RUN_STATUS" -ne 0 ]] || {
    printf 'Empty Node selector unexpectedly succeeded. Output:\n%s\n' \
      "$RUN_OUTPUT" >&2
    return 1
  }
  assert_contains "$RUN_OUTPUT" \
    "Release Node selector is empty: ${workspace}/.nvmrc"
  local events
  events=$(cat "$log_path")
  assert_not_contains "$events" "npx-invoked"
  assert_not_contains "$events" "preflight-node="
  assert_not_contains "$events" "child-node="
  echo "PASS: empty Node selector fails before npx, preflight, or child execution"
}

test_missing_npx_fails_before_release_commands() {
  local workspace
  local log_path
  workspace=$(make_workspace missing-npx)
  log_path="${workspace}/events"

  write_node "${workspace}/bin/node" "24.19.0"

  run_launcher "$workspace" "$log_path" \
    "${workspace}/bin:$(path_without_npx)"

  [[ "$RUN_STATUS" -ne 0 ]] || {
    printf 'Missing npx unexpectedly succeeded. Output:\n%s\n' \
      "$RUN_OUTPUT" >&2
    return 1
  }
  assert_contains "$RUN_OUTPUT" \
    "Release runner could not find npx; cannot make pinned Node package node@${REQUIRED_NODE_VERSION} available via npx; refusing to run release command."
  assert_not_contains "$RUN_OUTPUT" "command not found"
  if [[ -e "$log_path" ]]; then
    local events
    events=$(cat "$log_path")
    assert_not_contains "$events" "preflight-node="
    assert_not_contains "$events" "child-node="
  fi
  echo "PASS: missing npx reports the tooling boundary before preflight or child execution"
}

test_release_dependency_installs_use_https_guard() {
  local release_check="${SCRIPT_DIR}/../../.github/workflows/release-check.yml"
  local concurrency_calibration="${SCRIPT_DIR}/../../.github/workflows/release-concurrency-calibration.yml"
  local guarded_install='run: bash scripts/src/run-release-node.sh pnpm install --frozen-lockfile'
  local release_check_count
  local calibration_count

  release_check_count=$(grep -Fc "$guarded_install" "$release_check" || true)
  calibration_count=$(grep -Fc "$guarded_install" "$concurrency_calibration" || true)
  [[ "$release_check_count" -eq 2 ]] || {
    printf 'Expected both release-check dependency installs to use the HTTPS guard; found %s.\n' \
      "$release_check_count" >&2
    return 1
  }
  [[ "$calibration_count" -eq 1 ]] || {
    printf 'Expected release-concurrency calibration install to use the HTTPS guard; found %s.\n' \
      "$calibration_count" >&2
    return 1
  }
  echo "PASS: release workflow dependency installs use the HTTPS-only release runner"
}

test_release_runner_verifies_local_tls_certificates() {
  local workspace="${TEST_ROOT}/tls-verification"
  local cert_dir="${TEST_ROOT}/tls-certificates"
  local server_dir="${TEST_ROOT}/tls-server"
  local wrong_node_dir="${workspace}/wrong-node"
  local node_version
  local registry_port_file="${server_dir}/registry-port"
  local tarball_port_file="${server_dir}/tarball-port"
  local expired_port_file="${server_dir}/expired-port"
  local ipv6_port_file="${server_dir}/ipv6-port"
  local ipv6_proxy_port_file="${server_dir}/ipv6-proxy-port"
  local future_port_file="${server_dir}/future-port"
  local http_tarball_port_file="${server_dir}/http-tarball-port"
  local server_output="${server_dir}/output"
  local client_script="${workspace}/https-client.cjs"
  local package_root="${workspace}/package"
  local package_tarball="${workspace}/fixture.tgz"
  local altered_package_tarball="${workspace}/altered-fixture.tgz"
  local tarball_mode_file="${workspace}/tarball-mode"
  local metadata_mode_file="${workspace}/metadata-mode"
  local trusted_output="${workspace}/trusted-output"
  local untrusted_output="${workspace}/untrusted-output"
  local trusted_npx_output="${workspace}/trusted-npx-output"
  local untrusted_npx_output="${workspace}/untrusted-npx-output"
  local integrity_npx_output="${workspace}/integrity-npx-output"
  local redirect_integrity_npx_output="${workspace}/redirect-integrity-npx-output"
  local downgrade_npx_output="${workspace}/downgrade-npx-output"
  local shasum_npx_output="${workspace}/shasum-npx-output"
  local lifecycle_control_npm_output="${workspace}/lifecycle-control-npm-output"
  local lifecycle_rejected_npm_output="${workspace}/lifecycle-rejected-npm-output"
  local release_install_npm_output="${workspace}/release-install-npm-output"
  local release_downgrade_npm_output="${workspace}/release-downgrade-npm-output"
  local lifecycle_redirected_npm_output="${workspace}/lifecycle-redirected-npm-output"
  local ipv6_npx_output="${workspace}/ipv6-npx-output"
  local ipv6_npx_mismatch_output="${workspace}/ipv6-npx-mismatch-output"
  local ipv6_npm_output="${workspace}/ipv6-npm-output"
  local ipv6_npm_mismatch_output="${workspace}/ipv6-npm-mismatch-output"
  local lifecycle_control_marker="${workspace}/lifecycle-control-marker"
  local lifecycle_rejected_marker="${workspace}/lifecycle-rejected-marker"
  local lifecycle_redirected_marker="${workspace}/lifecycle-redirected-marker"
  local registry_requests="${workspace}/registry-requests"
  local ipv6_proxy_requests="${workspace}/ipv6-proxy-requests"
  local tarball_requests="${workspace}/tarball-requests"
  local http_tarball_requests="${workspace}/http-tarball-requests"
  local redirect_mode_file="${workspace}/redirect-mode"
  local npx_log="${workspace}/npx-log"
  local package_name="replit-release-runner-tls-fixture"
  local package_version="1.0.0"
  local ip_mismatch_output="${workspace}/ip-mismatch-output"
  local ipv6_mismatch_output="${workspace}/ipv6-mismatch-output"
  local hostname_mismatch_output="${workspace}/hostname-mismatch-output"
  local expired_certificate_output="${workspace}/expired-certificate-output"
  local future_certificate_output="${workspace}/future-certificate-output"
  local url
  local trusted_name_url
  local mismatched_ip_url
  local mismatched_url
  local expired_certificate_url
  local future_certificate_url
  local ipv6_url
  local ipv6_path_url
  local mismatched_ipv6_url
  local ipv6_proxy_url
  local attempt
  local status

  mkdir -p "${workspace}/scripts/src" "$wrong_node_dir" "$cert_dir" "$server_dir"
  cp "$LAUNCHER" "${workspace}/scripts/src/run-release-node.sh"
  cp "${SCRIPT_DIR}/run-release-command.py" \
    "${workspace}/scripts/src/run-release-command.py"
  cp "${SCRIPT_DIR}/release-node-https-only.cjs" \
    "${workspace}/scripts/src/release-node-https-only.cjs"
  node_version=$("$REAL_NODE_BIN" --version)
  printf '%s\n' "${node_version#v}" >"${workspace}/.nvmrc"
  cat >"${workspace}/scripts/src/check-routine-node-version.mjs" <<'EOF'
process.exit(0);
EOF
  write_node "${wrong_node_dir}/node" "deliberately-mismatched"
  cat >"${wrong_node_dir}/npx" <<EOF
#!/usr/bin/env bash
set -euo pipefail

printf 'npx-invoked\\n' >>"\$RUN_LOG"
args=("\$@")
separator=-1
for ((index = 0; index < \${#args[@]}; index++)); do
  if [[ "\${args[index]}" == "--" ]]; then
    separator="\$index"
    break
  fi
done

if (( separator < 0 )); then
  printf 'Expected npx arguments to contain --.\\n' >&2
  exit 1
fi

expected_package="--package=node@${node_version#v}"
package_found=false
for argument in "\${args[@]}"; do
  if [[ "\$argument" == "\$expected_package" ]]; then
    package_found=true
    break
  fi
done
if [[ "\$package_found" != true ]]; then
  printf 'Expected npx to select %s.\\n' "\$expected_package" >&2
  exit 1
fi

export PATH="${REAL_NODE_BIN_DIR}:\$PATH"
command_args=("\${args[@]:\$((separator + 1))}")
exec "\${command_args[@]}"
EOF
  chmod +x "${wrong_node_dir}/npx"

  "$OPENSSL_BIN" req -x509 -newkey rsa:2048 -nodes \
    -keyout "${cert_dir}/test-ca.key" \
    -out "${cert_dir}/test-ca.pem" \
    -days 36500 \
    -subj "/CN=Release Runner Temporary Test CA" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    >"${cert_dir}/openssl-output" 2>&1 || {
      printf 'Could not create the temporary TLS test CA.\n' >&2
      cat "${cert_dir}/openssl-output" >&2
      return 1
    }
  "$OPENSSL_BIN" req -new -newkey rsa:2048 -nodes \
    -keyout "${cert_dir}/server.key" \
    -out "${cert_dir}/server.csr" \
    -subj "/CN=localhost" \
    >>"${cert_dir}/openssl-output" 2>&1 || {
      printf 'Could not create the temporary TLS server key and request.\n' >&2
      cat "${cert_dir}/openssl-output" >&2
      return 1
    }
  cat >"${cert_dir}/server-extensions.cnf" <<'EOF'
[server_cert]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:localhost,IP:127.0.0.1
EOF
  "$OPENSSL_BIN" x509 -req \
    -in "${cert_dir}/server.csr" \
    -CA "${cert_dir}/test-ca.pem" \
    -CAkey "${cert_dir}/test-ca.key" \
    -CAcreateserial \
    -out "${cert_dir}/server.pem" \
    -days 2 \
    -extfile "${cert_dir}/server-extensions.cnf" \
    -extensions server_cert \
    >>"${cert_dir}/openssl-output" 2>&1 || {
      printf 'Could not sign the temporary TLS server certificate.\n' >&2
      cat "${cert_dir}/openssl-output" >&2
      return 1
    }
  mkdir -p "${cert_dir}/newcerts"
  : >"${cert_dir}/index.txt"
  printf '1000\n' >"${cert_dir}/serial"
  cat >"${cert_dir}/ca.cnf" <<EOF
[ ca ]
default_ca = test_ca

[ test_ca ]
database = ${cert_dir}/index.txt
new_certs_dir = ${cert_dir}/newcerts
certificate = ${cert_dir}/test-ca.pem
private_key = ${cert_dir}/test-ca.key
serial = ${cert_dir}/serial
default_md = sha256
policy = policy_any
x509_extensions = server_cert

[ policy_any ]
commonName = supplied

[ server_cert ]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = DNS:localhost,IP:127.0.0.1,DNS:expired-name.invalid,DNS:future-name.invalid
EOF
  "$OPENSSL_BIN" ca -batch \
    -config "${cert_dir}/ca.cnf" \
    -in "${cert_dir}/server.csr" \
    -out "${cert_dir}/server-expired.pem" \
    -startdate 20200101000000Z \
    -enddate 20210101000000Z \
    -extensions server_cert \
    >>"${cert_dir}/openssl-output" 2>&1 || {
      printf 'Could not create the deterministically expired TLS server certificate.\n' >&2
      cat "${cert_dir}/openssl-output" >&2
      return 1
    }
  "$OPENSSL_BIN" req -new -newkey rsa:2048 -nodes \
    -keyout "${cert_dir}/server-future.key" \
    -out "${cert_dir}/server-future.csr" \
    -subj "/CN=future-name.invalid" \
    >>"${cert_dir}/openssl-output" 2>&1 || {
      printf 'Could not create the temporary future-dated TLS server key and request.\n' >&2
      cat "${cert_dir}/openssl-output" >&2
      return 1
    }
  "$OPENSSL_BIN" ca -batch \
    -config "${cert_dir}/ca.cnf" \
    -in "${cert_dir}/server-future.csr" \
    -out "${cert_dir}/server-future.pem" \
    -startdate 20990101000000Z \
    -enddate 21000101000000Z \
    -extensions server_cert \
    >>"${cert_dir}/openssl-output" 2>&1 || {
      printf 'Could not create the deterministically future-dated TLS server certificate.\n' >&2
      cat "${cert_dir}/openssl-output" >&2
      return 1
    }
  cat >"${cert_dir}/ipv6-server-extensions.cnf" <<'EOF'
[server_cert]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=IP:::1
EOF
  "$OPENSSL_BIN" x509 -req \
    -in "${cert_dir}/server.csr" \
    -CA "${cert_dir}/test-ca.pem" \
    -CAkey "${cert_dir}/test-ca.key" \
    -CAcreateserial \
    -out "${cert_dir}/server-ipv6.pem" \
    -days 2 \
    -extfile "${cert_dir}/ipv6-server-extensions.cnf" \
    -extensions server_cert \
    >>"${cert_dir}/openssl-output" 2>&1 || {
      printf 'Could not sign the temporary IPv6 TLS server certificate.\n' >&2
      cat "${cert_dir}/openssl-output" >&2
      return 1
    }

  mkdir -p \
    "${package_root}/bin" \
    "${workspace}/home" \
    "${workspace}/tmp" \
    "${workspace}/xdg-config"
  cat >"${package_root}/package.json" <<EOF
{
  "name": "${package_name}",
  "version": "${package_version}",
  "scripts": {
    "preinstall": "node -e \\"if (process.env.PREINSTALL_MARKER) require('node:fs').writeFileSync(process.env.PREINSTALL_MARKER, 'preinstall ran')\\""
  },
  "bin": {
    "local-npx-tls-fixture": "bin/run.cjs"
  }
}
EOF
  cat >"${package_root}/bin/run.cjs" <<'EOF'
#!/usr/bin/env node
console.log("local npx package resolved over verified TLS");
EOF
  chmod +x "${package_root}/bin/run.cjs"
  "$TAR_BIN" -czf "$package_tarball" -C "$workspace" package
  cp "$package_tarball" "$altered_package_tarball"
  printf 'altered package bytes\n' >>"$altered_package_tarball"
  printf 'matching\n' >"$tarball_mode_file"
  printf 'direct\n' >"$redirect_mode_file"
  printf 'integrity\n' >"$metadata_mode_file"
  : >"$registry_requests"
  : >"$tarball_requests"
  : >"$http_tarball_requests"
  : >"$ipv6_proxy_requests"
  : >"${workspace}/empty-user.npmrc"
  : >"${workspace}/empty-global.npmrc"

  cat >"${server_dir}/https-server.cjs" <<'EOF'
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");

const [
  keyPath,
  certPath,
  registryPortPath,
  tarballPortPath,
  expiredPortPath,
  ipv6PortPath,
  expiredCertPath,
  futurePortPath,
  futureCertPath,
  futureKeyPath,
  httpTarballPortPath,
  ipv6CertPath,
  ipv6ProxyPortPath,
  ipv6ProxyRequestLogPath,
  packageTarballPath,
  alteredPackageTarballPath,
  packageManifestPath,
  tarballModePath,
  redirectModePath,
  metadataModePath,
  requestLogPath,
  tarballRequestLogPath,
  httpTarballRequestLogPath,
] = process.argv.slice(2);
const packageName = "replit-release-runner-tls-fixture";
const packageVersion = "1.0.0";
const packageTarball = fs.readFileSync(packageTarballPath);
const alteredPackageTarball = fs.readFileSync(alteredPackageTarballPath);
const packageManifest = JSON.parse(fs.readFileSync(packageManifestPath, "utf8"));
const tlsOptions = {
  key: fs.readFileSync(keyPath),
  cert: fs.readFileSync(certPath),
};
const expiredTlsOptions = {
  key: fs.readFileSync(keyPath),
  cert: fs.readFileSync(expiredCertPath),
};
const futureTlsOptions = {
  key: fs.readFileSync(futureKeyPath),
  cert: fs.readFileSync(futureCertPath),
};
const ipv6TlsOptions = {
  key: fs.readFileSync(keyPath),
  cert: fs.readFileSync(ipv6CertPath),
};
const registryServer = https.createServer(
  tlsOptions,
  (request, response) => {
    fs.appendFileSync(requestLogPath, `${request.method} ${request.url}\n`);
    const requestUrl = new URL(request.url, "https://127.0.0.1");

    if (
      request.method === "GET" &&
      (requestUrl.pathname === `/${packageName}` ||
        requestUrl.pathname === `/npm/${packageName}`)
    ) {
      const integrity =
        "sha512-" +
        crypto.createHash("sha512").update(packageTarball).digest("base64");
      const shasum = crypto.createHash("sha1").update(packageTarball).digest("hex");
      const metadataMode = fs.readFileSync(metadataModePath, "utf8").trim();
      const redirectMode = fs.readFileSync(redirectModePath, "utf8").trim();
      const dist = {
        tarball:
          redirectMode === "redirect"
            ? `https://127.0.0.1:${registryServer.address().port}/redirect.tgz`
            : redirectMode === "http-downgrade"
              ? `https://127.0.0.1:${registryServer.address().port}/downgrade.tgz`
              : `https://127.0.0.1:${registryServer.address().port}/fixture.tgz`,
        shasum,
      };
      if (metadataMode === "integrity") {
        dist.integrity = integrity;
      } else if (metadataMode !== "shasum-only") {
        throw new Error(`Unknown registry metadata mode: ${metadataMode}`);
      }
      const metadata = {
        name: packageName,
        "dist-tags": { latest: packageVersion },
        versions: {
          [packageVersion]: {
            ...packageManifest,
            dist,
          },
        },
      };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(metadata));
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/redirect.tgz") {
      response.writeHead(302, {
        location: `https://127.0.0.1:${tarballServer.address().port}/fixture.tgz`,
      });
      response.end();
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/downgrade.tgz") {
      // Target 127.0.0.2 rather than 127.0.0.1: the HTTPS-only guard
      // deliberately exempts same-host loopback cleartext requests, so the
      // downgrade must use a non-exempt loopback address to prove the guard
      // blocks the cleartext fetch before any bytes leave the process.
      response.writeHead(302, {
        location: `http://127.0.0.2:${httpTarballServer.address().port}/fixture.tgz`,
      });
      response.end();
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/fixture.tgz") {
      const tarball =
        fs.readFileSync(tarballModePath, "utf8").trim() === "altered"
          ? alteredPackageTarball
          : packageTarball;
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": tarball.length,
      });
      response.end(tarball);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("verified local TLS fixture");
      return;
    }

    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
  },
);

const tarballServer = https.createServer(tlsOptions, (request, response) => {
  fs.appendFileSync(tarballRequestLogPath, `${request.method} ${request.url}\n`);
  const requestUrl = new URL(request.url, "https://127.0.0.1");

  if (request.method === "GET" && requestUrl.pathname === "/fixture.tgz") {
    response.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": alteredPackageTarball.length,
    });
    response.end(alteredPackageTarball);
    return;
  }

  response.writeHead(404, { "content-type": "text/plain" });
  response.end("not found");
});

const expiredServer = https.createServer(expiredTlsOptions, (_request, response) => {
  response.writeHead(200, { "content-type": "text/plain" });
  response.end("expired TLS fixture");
});
const futureServer = https.createServer(futureTlsOptions, (_request, response) => {
  response.writeHead(200, { "content-type": "text/plain" });
  response.end("future-dated TLS fixture");
});
const ipv6Server = https.createServer(ipv6TlsOptions, (request, response) => {
  fs.appendFileSync(requestLogPath, `${request.method} ${request.url}\n`);
  const requestUrl = new URL(request.url, "https://[::1]");
  if (
    request.method === "GET" &&
    (requestUrl.pathname === `/${packageName}` ||
      requestUrl.pathname === `/npm/${packageName}`)
  ) {
    const integrity =
      "sha512-" +
      crypto.createHash("sha512").update(packageTarball).digest("base64");
    const shasum = crypto.createHash("sha1").update(packageTarball).digest("hex");
    const metadata = {
      name: packageName,
      "dist-tags": { latest: packageVersion },
      versions: {
        [packageVersion]: {
          ...packageManifest,
          dist: {
            tarball: `https://127.0.0.1:${registryServer.address().port}/fixture.tgz`,
            shasum,
            integrity,
          },
        },
      },
    };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(metadata));
    return;
  }
  if (request.method === "GET" && requestUrl.pathname === "/") {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("verified local TLS fixture");
    return;
  }
  response.writeHead(404, { "content-type": "text/plain" });
  response.end("not found");
});
const ipv6ProxyServer = http.createServer();
ipv6ProxyServer.on("connect", (request, clientSocket, head) => {
  fs.appendFileSync(ipv6ProxyRequestLogPath, `${request.url}\n`);
  const ipv6Target = /^\[(::1|::2)\]:(\d+)$/.exec(request.url ?? "");
  const nameTarget = /^ipv6-mismatch\.invalid:(\d+)$/.exec(request.url ?? "");
  const ipv4Target = /^127\.0\.0\.1:(\d+)$/.exec(request.url ?? "");
  const targetPort = Number(
    ipv6Target?.[2] ?? nameTarget?.[1] ?? ipv4Target?.[1],
  );
  if (
    !targetPort ||
    ((ipv6Target || nameTarget) &&
      targetPort !== ipv6Server.address()?.port) ||
    (ipv4Target && targetPort !== registryServer.address()?.port) ||
    (!ipv6Target && !nameTarget && !ipv4Target)
  ) {
    clientSocket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    return;
  }

  const upstream = net.connect(
    { host: ipv6Target || nameTarget ? "::1" : "127.0.0.1", port: targetPort },
    () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      clientSocket.pipe(upstream);
      upstream.pipe(clientSocket);
    },
  );
  upstream.on("error", () => clientSocket.destroy());
  clientSocket.on("error", () => upstream.destroy());
});

const httpTarballServer = http.createServer((request, response) => {
  fs.appendFileSync(httpTarballRequestLogPath, `${request.method} ${request.url}\n`);
  if (
    request.method === "GET" &&
    new URL(request.url, "http://127.0.0.1").pathname === "/fixture.tgz"
  ) {
    response.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": packageTarball.length,
    });
    response.end(packageTarball);
    return;
  }
  response.writeHead(404, { "content-type": "text/plain" });
  response.end("not found");
});

httpTarballServer.listen(0, "127.0.0.1", () => {
  fs.writeFileSync(httpTarballPortPath, String(httpTarballServer.address().port));
  tarballServer.listen(0, "127.0.0.1", () => {
    fs.writeFileSync(tarballPortPath, String(tarballServer.address().port));
    registryServer.listen(0, "127.0.0.1", () => {
      fs.writeFileSync(registryPortPath, String(registryServer.address().port));
      expiredServer.listen(0, "127.0.0.1", () => {
        fs.writeFileSync(expiredPortPath, String(expiredServer.address().port));
        futureServer.listen(0, "127.0.0.1", () => {
          fs.writeFileSync(futurePortPath, String(futureServer.address().port));
          ipv6Server.listen(0, "::1", () => {
            fs.writeFileSync(ipv6PortPath, String(ipv6Server.address().port));
            ipv6ProxyServer.listen(0, "127.0.0.1", () => {
              fs.writeFileSync(
                ipv6ProxyPortPath,
                String(ipv6ProxyServer.address().port),
              );
            });
          });
        });
      });
    });
  });
});
EOF
  cat >"$client_script" <<'EOF'
const https = require("node:https");
const net = require("node:net");
const tls = require("node:tls");

const url = new URL(process.argv[2]);
const requestOptions = {
  lookup: (hostname, options, callback) => {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    const normalizedHostname = hostname.replace(/^\[|\]$/g, "");
    if (
      normalizedHostname !== "localhost" &&
      normalizedHostname !== "mismatched-name.invalid" &&
      normalizedHostname !== "expired-name.invalid" &&
      normalizedHostname !== "future-name.invalid" &&
      normalizedHostname !== "::1" &&
      normalizedHostname !== "::2"
    ) {
      callback(new Error(`Unexpected TLS fixture hostname: ${hostname}`));
      return;
    }
    if (normalizedHostname === "::1" || normalizedHostname === "::2") {
      callback(null, normalizedHostname, 6);
      return;
    }
    if (options.all) {
      callback(null, [{ address: "127.0.0.1", family: 4 }]);
      return;
    }
    callback(null, "127.0.0.1", 4);
  },
};

if (url.hostname === "127.0.0.2") {
  // Keep the HTTPS listener bound only to loopback while testing a different
  // IP-literal URL. TLS still checks the URL host against the certificate SAN.
  const agent = new https.Agent();
  agent.createConnection = (options) =>
    tls.connect({
      ...options,
      socket: net.connect({ host: "127.0.0.1", port: options.port }),
    });
  requestOptions.agent = agent;
}

if (url.hostname === "[::2]") {
  // Route the mismatched IPv6 URL literal to the same ::1 HTTPS listener.
  // TLS still checks the original URL host against the certificate IP SAN.
  const agent = new https.Agent();
  agent.createConnection = (options) =>
    tls.connect({
      ...options,
      socket: net.connect({ host: "::1", port: options.port }),
    });
  requestOptions.agent = agent;
}

const request = https.get(
  url,
  requestOptions,
  (response) => {
    let body = "";
    response.setEncoding("utf8");
    response.on("data", (chunk) => {
      body += chunk;
    });
    response.on("end", () => {
      if (response.statusCode !== 200 || body !== "verified local TLS fixture") {
        console.error(`Unexpected HTTPS response: ${response.statusCode} ${body}`);
        process.exitCode = 1;
        return;
      }
      console.log(body);
    });
  },
);

request.setTimeout(5000, () => request.destroy(new Error("HTTPS request timed out")));
request.on("error", (error) => {
  console.error(`HTTPS request failed: ${error.code ?? error.message}`);
  process.exitCode = 1;
});
EOF

  "$REAL_NODE_BIN" "${server_dir}/https-server.cjs" \
    "${cert_dir}/server.key" "${cert_dir}/server.pem" \
    "$registry_port_file" "$tarball_port_file" "$expired_port_file" \
    "$ipv6_port_file" \
    "${cert_dir}/server-expired.pem" "$future_port_file" \
    "${cert_dir}/server-future.pem" "${cert_dir}/server-future.key" \
    "$http_tarball_port_file" \
    "${cert_dir}/server-ipv6.pem" \
    "$ipv6_proxy_port_file" "$ipv6_proxy_requests" \
    "$package_tarball" "$altered_package_tarball" \
    "${package_root}/package.json" "$tarball_mode_file" \
    "$redirect_mode_file" "$metadata_mode_file" \
    "$registry_requests" "$tarball_requests" "$http_tarball_requests" \
    >"$server_output" 2>&1 &
  TLS_SERVER_PID=$!
  for ((attempt = 0; attempt < 100; attempt++)); do
    [[ -s "$registry_port_file" && -s "$tarball_port_file" &&
      -s "$expired_port_file" && -s "$future_port_file" &&
      -s "$http_tarball_port_file" && -s "$ipv6_port_file" &&
      -s "$ipv6_proxy_port_file" ]] && break
    if ! kill -0 "$TLS_SERVER_PID" 2>/dev/null; then
      printf 'Local HTTPS fixture server exited before becoming ready.\n' >&2
      cat "$server_output" >&2
      return 1
    fi
    sleep 0.05
  done
  if [[ ! -s "$registry_port_file" || ! -s "$tarball_port_file" ||
    ! -s "$expired_port_file" || ! -s "$future_port_file" ||
    ! -s "$http_tarball_port_file" || ! -s "$ipv6_port_file" ||
    ! -s "$ipv6_proxy_port_file" ]]; then
    printf 'Local HTTPS fixture server did not become ready in time.\n' >&2
    cat "$server_output" >&2
    return 1
  fi
  url="https://127.0.0.1:$(cat "$registry_port_file")/"
  trusted_name_url="https://localhost:$(cat "$registry_port_file")/"
  mismatched_ip_url="https://127.0.0.2:$(cat "$registry_port_file")/"
  mismatched_url="https://mismatched-name.invalid:$(cat "$registry_port_file")/"
  expired_certificate_url="https://expired-name.invalid:$(cat "$expired_port_file")/"
  future_certificate_url="https://future-name.invalid:$(cat "$future_port_file")/"
  ipv6_url="https://[::1]:$(cat "$ipv6_port_file")/"
  ipv6_path_url="https://[::1]:$(cat "$ipv6_port_file")/npm/"
  mismatched_ipv6_url="https://[::2]:$(cat "$ipv6_port_file")/"
  # npm's bundled https-proxy-agent omits servername for IP-literal targets
  # and drops host when upgrading the CONNECT tunnel, so Node skips hostname
  # verification entirely for https://[::2] through a proxy. The proxied
  # npm/npx mismatch cases therefore use a DNS hostname mismatch, which proxy
  # agents verify correctly; the direct [::2] client case above still covers
  # IP SAN identity without a proxy.
  mismatched_ipv6_name_url="https://ipv6-mismatch.invalid:$(cat "$ipv6_port_file")/"
  mismatched_ipv6_name_path_url="https://ipv6-mismatch.invalid:$(cat "$ipv6_port_file")/npm/"
  ipv6_proxy_url="http://127.0.0.1:$(cat "$ipv6_proxy_port_file")"

  set +e
  env \
    -u NODE_OPTIONS \
    -u NODE_EXTRA_CA_CERTS \
    -u NODE_TLS_REJECT_UNAUTHORIZED \
    RELEASE_NODE_NPM_REGISTRY="$url" \
    PATH="${wrong_node_dir}:${REAL_NODE_BIN_DIR}:${PATH}" \
    RUN_LOG="$npx_log" \
    SSL_CERT_FILE="${workspace}/missing-ca.pem" \
    SSL_CERT_DIR="${workspace}/missing-ca-dir" \
    NODE_EXTRA_CA_CERTS="${cert_dir}/test-ca.pem" \
    bash "${workspace}/scripts/src/run-release-node.sh" \
    node "$client_script" "$url" >"$trusted_output" 2>&1
  status=$?
  set -e
  if [[ "$status" -ne 0 ]] ||
    [[ "$(cat "$trusted_output")" != *"verified local TLS fixture"* ]]; then
    printf 'Pinned runner did not accept the matching IP certificate SAN (status %s):\n' \
      "$status" >&2
    cat "$trusted_output" >&2
    return 1
  fi
  assert_contains "$(cat "$npx_log")" "npx-invoked"

  set +e
  env \
    -u NODE_OPTIONS \
    -u NODE_EXTRA_CA_CERTS \
    -u NODE_TLS_REJECT_UNAUTHORIZED \
    RELEASE_NODE_NPM_REGISTRY="$url" \
    PATH="${wrong_node_dir}:${REAL_NODE_BIN_DIR}:${PATH}" \
    RUN_LOG="$npx_log" \
    SSL_CERT_FILE="${workspace}/missing-ca.pem" \
    SSL_CERT_DIR="${workspace}/missing-ca-dir" \
    NODE_EXTRA_CA_CERTS="${cert_dir}/test-ca.pem" \
    bash "${workspace}/scripts/src/run-release-node.sh" \
    node "$client_script" "$ipv6_url" >"$trusted_output" 2>&1
  status=$?
  set -e
  if [[ "$status" -ne 0 ]] ||
    [[ "$(cat "$trusted_output")" != *"verified local TLS fixture"* ]]; then
    printf 'Pinned runner did not accept the matching IPv6 certificate SAN (status %s):\n' \
      "$status" >&2
    cat "$trusted_output" >&2
    return 1
  fi

  set +e
  env \
    -u NODE_OPTIONS \
    -u NODE_EXTRA_CA_CERTS \
    -u NODE_TLS_REJECT_UNAUTHORIZED \
    RELEASE_NODE_NPM_REGISTRY="$url" \
    PATH="${wrong_node_dir}:${REAL_NODE_BIN_DIR}:${PATH}" \
    RUN_LOG="$npx_log" \
    SSL_CERT_FILE="${workspace}/missing-ca.pem" \
    SSL_CERT_DIR="${workspace}/missing-ca-dir" \
    NODE_EXTRA_CA_CERTS="${cert_dir}/test-ca.pem" \
    bash "${workspace}/scripts/src/run-release-node.sh" \
    node "$client_script" "$mismatched_ipv6_url" \
    >"$ipv6_mismatch_output" 2>&1
  status=$?
  set -e
  local ipv6_mismatch_result
  ipv6_mismatch_result=$(cat "$ipv6_mismatch_output")
  if [[ "$status" -eq 0 ]] ||
    [[ "$ipv6_mismatch_result" != *"ERR_TLS_CERT_ALTNAME_INVALID"* ]]; then
    printf 'Trusted TLS with a mismatched IPv6 address did not fail certificate-name validation (status %s):\n%s\n' \
      "$status" "$ipv6_mismatch_result" >&2
    return 1
  fi
  assert_not_contains "$ipv6_mismatch_result" "ECONNREFUSED"
  assert_not_contains "$ipv6_mismatch_result" "ECONNRESET"

  set +e
  env \
    -u NODE_OPTIONS \
    -u NODE_EXTRA_CA_CERTS \
    -u NODE_TLS_REJECT_UNAUTHORIZED \
    RELEASE_NODE_NPM_REGISTRY="$url" \
    PATH="${wrong_node_dir}:${REAL_NODE_BIN_DIR}:${PATH}" \
    RUN_LOG="$npx_log" \
    SSL_CERT_FILE="${workspace}/missing-ca.pem" \
    SSL_CERT_DIR="${workspace}/missing-ca-dir" \
    NODE_EXTRA_CA_CERTS="${cert_dir}/test-ca.pem" \
    bash "${workspace}/scripts/src/run-release-node.sh" \
    node "$client_script" "$trusted_name_url" >"$trusted_output" 2>&1
  status=$?
  set -e
  if [[ "$status" -ne 0 ]] ||
    [[ "$(cat "$trusted_output")" != *"verified local TLS fixture"* ]]; then
    printf 'Pinned runner did not trust the explicitly supplied test CA (status %s):\n' \
      "$status" >&2
    cat "$trusted_output" >&2
    return 1
  fi
  assert_contains "$(cat "$npx_log")" "npx-invoked"

  set +e
  env \
    -u NODE_OPTIONS \
    -u NODE_EXTRA_CA_CERTS \
    -u NODE_TLS_REJECT_UNAUTHORIZED \
    RELEASE_NODE_NPM_REGISTRY="$url" \
    PATH="${wrong_node_dir}:${REAL_NODE_BIN_DIR}:${PATH}" \
    RUN_LOG="$npx_log" \
    SSL_CERT_FILE="${workspace}/missing-ca.pem" \
    SSL_CERT_DIR="${workspace}/missing-ca-dir" \
    NODE_EXTRA_CA_CERTS="${cert_dir}/test-ca.pem" \
    bash "${workspace}/scripts/src/run-release-node.sh" \
    node "$client_script" "$mismatched_ip_url" >"$ip_mismatch_output" 2>&1
  status=$?
  set -e
  local ip_mismatch_result
  ip_mismatch_result=$(cat "$ip_mismatch_output")
  if [[ "$status" -eq 0 ]] ||
    [[ "$ip_mismatch_result" != *"ERR_TLS_CERT_ALTNAME_INVALID"* ]]; then
    printf 'Trusted TLS with a mismatched IP address did not fail certificate-name validation (status %s):\n%s\n' \
      "$status" "$ip_mismatch_result" >&2
    return 1
  fi

  set +e
  env \
    -u NODE_OPTIONS \
    -u NODE_EXTRA_CA_CERTS \
    -u NODE_TLS_REJECT_UNAUTHORIZED \
    RELEASE_NODE_NPM_REGISTRY="$url" \
    PATH="${wrong_node_dir}:${REAL_NODE_BIN_DIR}:${PATH}" \
    RUN_LOG="$npx_log" \
    SSL_CERT_FILE="${workspace}/missing-ca.pem" \
    SSL_CERT_DIR="${workspace}/missing-ca-dir" \
    NODE_EXTRA_CA_CERTS="${cert_dir}/test-ca.pem" \
    bash "${workspace}/scripts/src/run-release-node.sh" \
    node "$client_script" "$mismatched_url" >"$hostname_mismatch_output" 2>&1
  status=$?
  set -e
  local hostname_mismatch_result
  hostname_mismatch_result=$(cat "$hostname_mismatch_output")
  if [[ "$status" -eq 0 ]] ||
    [[ "$hostname_mismatch_result" != *"ERR_TLS_CERT_ALTNAME_INVALID"* ]]; then
    printf 'Trusted TLS with a mismatched hostname did not fail certificate-name validation (status %s):\n%s\n' \
      "$status" "$hostname_mismatch_result" >&2
    return 1
  fi

  set +e
  env \
    -u NODE_OPTIONS \
    -u NODE_EXTRA_CA_CERTS \
    -u NODE_TLS_REJECT_UNAUTHORIZED \
    RELEASE_NODE_NPM_REGISTRY="$url" \
    PATH="${wrong_node_dir}:${REAL_NODE_BIN_DIR}:${PATH}" \
    RUN_LOG="$npx_log" \
    SSL_CERT_FILE="${workspace}/missing-ca.pem" \
    SSL_CERT_DIR="${workspace}/missing-ca-dir" \
    NODE_EXTRA_CA_CERTS="${cert_dir}/test-ca.pem" \
    bash "${workspace}/scripts/src/run-release-node.sh" \
    node "$client_script" "$expired_certificate_url" \
    >"$expired_certificate_output" 2>&1
  status=$?
  set -e
  local expired_certificate_result
  expired_certificate_result=$(cat "$expired_certificate_output")
  if [[ "$status" -eq 0 ]] ||
    [[ "$expired_certificate_result" != *"CERT_HAS_EXPIRED"* ]]; then
    printf 'Trusted TLS with an expired server certificate did not fail certificate-validity validation (status %s):\n%s\n' \
      "$status" "$expired_certificate_result" >&2
    return 1
  fi
  assert_not_contains "$expired_certificate_result" "ECONNREFUSED"
  assert_not_contains "$expired_certificate_result" "ECONNRESET"

  set +e
  env \
    -u NODE_OPTIONS \
    -u NODE_EXTRA_CA_CERTS \
    -u NODE_TLS_REJECT_UNAUTHORIZED \
    RELEASE_NODE_NPM_REGISTRY="$url" \
    PATH="${wrong_node_dir}:${REAL_NODE_BIN_DIR}:${PATH}" \
    RUN_LOG="$npx_log" \
    SSL_CERT_FILE="${workspace}/missing-ca.pem" \
    SSL_CERT_DIR="${workspace}/missing-ca-dir" \
    NODE_EXTRA_CA_CERTS="${cert_dir}/test-ca.pem" \
    bash "${workspace}/scripts/src/run-release-node.sh" \
    node "$client_script" "$future_certificate_url" \
    >"$future_certificate_output" 2>&1
  status=$?
  set -e
  local future_certificate_result
  future_certificate_result=$(cat "$future_certificate_output")
  if [[ "$status" -eq 0 ]] ||
    [[ "$future_certificate_result" != *"CERT_NOT_YET_VALID"* ]]; then
    printf 'Trusted TLS with a future-dated server certificate did not fail not-yet-valid validation (status %s):\n%s\n' \
      "$status" "$future_certificate_result" >&2
    return 1
  fi
  assert_not_contains "$future_certificate_result" "CERT_HAS_EXPIRED"
  assert_not_contains "$future_certificate_result" "ECONNREFUSED"
  assert_not_contains "$future_certificate_result" "ECONNRESET"

  set +e
  env \
    -u NODE_OPTIONS \
    -u NODE_EXTRA_CA_CERTS \
    -u NODE_TLS_REJECT_UNAUTHORIZED \
    PATH="${REAL_NODE_BIN_DIR}:${PATH}" \
    SSL_CERT_FILE="${workspace}/missing-ca.pem" \
    SSL_CERT_DIR="${workspace}/missing-ca-dir" \
    bash "${workspace}/scripts/src/run-release-node.sh" \
    node "$client_script" "$url" >"$untrusted_output" 2>&1
  status=$?
  set -e
  if [[ "$status" -eq 0 ]]; then
    printf 'Pinned runner accepted a server certificate signed by the untrusted test CA.\n' >&2
    cat "$untrusted_output" >&2
    return 1
  fi
  local untrusted_result
  untrusted_result=$(cat "$untrusted_output")
  if [[ "$untrusted_result" != *"UNABLE_TO_GET_ISSUER_CERT_LOCALLY"* &&
    "$untrusted_result" != *"UNABLE_TO_VERIFY_LEAF_SIGNATURE"* &&
    "$untrusted_result" != *"DEPTH_ZERO_SELF_SIGNED_CERT"* ]]; then
    printf 'Untrusted TLS failed for a reason other than certificate validation:\n%s\n' \
      "$untrusted_result" >&2
    return 1
  fi
  assert_contains "$(cat "$npx_log")" "npx-invoked"

  run_local_npx() {
    local cafile="$1"
    local cache_dir="$2"
    local output_path="$3"
    local registry_url="${4:-$url}"
    local https_proxy_url="${5:-}"
    local -a npm_environment=(
      "PATH=${REAL_NODE_BIN_DIR}:$(dirname "$REAL_NPX_BIN"):/usr/bin:/bin"
      "HOME=${workspace}/home"
      "TMPDIR=${workspace}/tmp"
      "XDG_CONFIG_HOME=${workspace}/xdg-config"
      "npm_config_registry=${registry_url}"
      "npm_config_cache=${cache_dir}"
      "npm_config_userconfig=${workspace}/empty-user.npmrc"
      "npm_config_globalconfig=${workspace}/empty-global.npmrc"
      "npm_config_audit=false"
      "npm_config_fund=false"
      "npm_config_update_notifier=false"
      "npm_config_fetch_retries=0"
      "npm_config_fetch_timeout=10000"
      "npm_config_strict_ssl=true"
      "NODE_OPTIONS=--require=\"${workspace}/scripts/src/release-node-https-only.cjs\""
      "npm_config_ignore_scripts=false"
      "SSL_CERT_FILE=${workspace}/missing-ca.pem"
      "SSL_CERT_DIR=${workspace}/missing-ca-dir"
    )

    if [[ -n "$cafile" ]]; then
      npm_environment+=("npm_config_cafile=${cafile}")
    fi
    if [[ -n "$https_proxy_url" ]]; then
      npm_environment+=(
        "npm_config_https_proxy=${https_proxy_url}"
        "npm_config_noproxy=none.invalid"
      )
    fi

    (
      cd "$workspace"
      env -i "${npm_environment[@]}" \
        "$REAL_NPX_BIN" --yes \
        --package="${package_name}@${package_version}" \
        -- local-npx-tls-fixture
    ) >"$output_path" 2>&1
  }

  run_local_npm_install() {
    local project_dir="$1"
    local cache_dir="$2"
    local output_path="$3"
    local preinstall_marker="$4"
    local registry_url="${5:-$url}"
    local https_proxy_url="${6:-}"
    local -a npm_environment=(
      "PATH=${REAL_NODE_BIN_DIR}:$(dirname "$REAL_NPM_BIN"):/usr/bin:/bin"
      "HOME=${workspace}/home"
      "TMPDIR=${workspace}/tmp"
      "XDG_CONFIG_HOME=${workspace}/xdg-config"
      "npm_config_registry=${registry_url}"
      "npm_config_cache=${cache_dir}"
      "npm_config_userconfig=${workspace}/empty-user.npmrc"
      "npm_config_globalconfig=${workspace}/empty-global.npmrc"
      "npm_config_audit=false"
      "npm_config_fund=false"
      "npm_config_update_notifier=false"
      "npm_config_fetch_retries=0"
      "npm_config_fetch_timeout=10000"
      "npm_config_strict_ssl=true"
      "npm_config_ignore_scripts=false"
      "npm_config_cafile=${cert_dir}/test-ca.pem"
      "PREINSTALL_MARKER=${preinstall_marker}"
      "SSL_CERT_FILE=${workspace}/missing-ca.pem"
      "SSL_CERT_DIR=${workspace}/missing-ca-dir"
    )
    if [[ -n "$https_proxy_url" ]]; then
      npm_environment+=(
        "npm_config_https_proxy=${https_proxy_url}"
        "npm_config_noproxy=none.invalid"
      )
    fi

    mkdir -p "$project_dir"
    cat >"${project_dir}/package.json" <<'EOF'
{
  "name": "lifecycle-hook-check",
  "version": "1.0.0",
  "private": true
}
EOF
    (
      cd "$project_dir"
      env -i "${npm_environment[@]}" \
        "$REAL_NPM_BIN" install \
        --no-save \
        --package-lock=false \
        --ignore-scripts=false \
        --no-audit \
        --no-fund \
        "${package_name}@${package_version}"
    ) >"$output_path" 2>&1
  }

  run_release_pnpm_install() {
    local project_dir="$1"
    local cache_dir="$2"
    local store_dir="$3"
    local output_path="$4"
    local -a npm_environment=(
      "PATH=${REAL_NODE_BIN_DIR}:$(dirname "$REAL_PNPM_BIN"):$(dirname "$REAL_PYTHON_BIN"):/usr/bin:/bin"
      "HOME=${workspace}/home"
      "TMPDIR=${workspace}/tmp"
      "XDG_CONFIG_HOME=${workspace}/xdg-config"
      "COREPACK_HOME=${SCRIPT_DIR}/../../.cache/node/corepack"
      "npm_config_registry=${url}"
      "npm_config_cache=${cache_dir}"
      "pnpm_config_store_dir=${store_dir}"
      "npm_config_userconfig=${workspace}/empty-user.npmrc"
      "npm_config_globalconfig=${workspace}/empty-global.npmrc"
      "npm_config_audit=false"
      "npm_config_fund=false"
      "npm_config_update_notifier=false"
      "npm_config_fetch_retries=0"
      "npm_config_fetch_timeout=10000"
      "npm_config_strict_ssl=true"
      "npm_config_ignore_scripts=false"
      "npm_config_cafile=${cert_dir}/test-ca.pem"
      "NODE_EXTRA_CA_CERTS=${cert_dir}/test-ca.pem"
      "CI=true"
      "SSL_CERT_FILE=${workspace}/missing-ca.pem"
      "SSL_CERT_DIR=${workspace}/missing-ca-dir"
    )

    mkdir -p "$project_dir"
    cat >"${project_dir}/package.json" <<EOF
{
  "name": "release-runner-https-policy-check",
  "version": "1.0.0",
  "packageManager": "pnpm@${REAL_PNPM_VERSION}",
  "private": true,
  "dependencies": {
    "replit-release-runner-tls-fixture": "1.0.0"
  }
}
EOF
    (
      cd "$project_dir"
      env -i "${npm_environment[@]}" \
        bash "${workspace}/scripts/src/run-release-node.sh" \
        "$REAL_PNPM_BIN" install \
        --no-lockfile \
        --registry "$url" \
        --store-dir "$store_dir" \
        --ignore-scripts
    ) >"$output_path" 2>&1
  }

  set +e
  run_local_npx "${cert_dir}/test-ca.pem" \
    "${workspace}/trusted-npm-cache" "$trusted_npx_output"
  status=$?
  set -e
  if [[ "$status" -ne 0 ]] ||
    [[ "$(cat "$trusted_npx_output")" != *"local npx package resolved over verified TLS"* ]]; then
    printf 'Installed npx did not resolve the fixture with its temporary CA (status %s):\n' \
      "$status" >&2
    cat "$trusted_npx_output" >&2
    return 1
  fi

  : >"$registry_requests"
  : >"$ipv6_proxy_requests"
  set +e
  run_local_npx "${cert_dir}/test-ca.pem" \
    "${workspace}/ipv6-npx-cache" "$ipv6_npx_output" \
    "$ipv6_path_url" "$ipv6_proxy_url"
  status=$?
  set -e
  if [[ "$status" -ne 0 ]] ||
    [[ "$(cat "$ipv6_npx_output")" != *"local npx package resolved over verified TLS"* ]]; then
    printf 'Installed npx did not accept the matching IPv6 registry certificate (status %s):\n' \
      "$status" >&2
    cat "$ipv6_npx_output" >&2
    return 1
  fi
  assert_contains "$(cat "$registry_requests")" "GET /npm/${package_name}"
  assert_contains "$(cat "$ipv6_proxy_requests")" \
    "[::1]:$(cat "$ipv6_port_file")"

  : >"$registry_requests"
  : >"$ipv6_proxy_requests"
  set +e
  run_local_npx "${cert_dir}/test-ca.pem" \
    "${workspace}/ipv6-npx-mismatch-cache" "$ipv6_npx_mismatch_output" \
    "$mismatched_ipv6_name_path_url" "$ipv6_proxy_url"
  status=$?
  set -e
  local ipv6_npx_mismatch_result
  ipv6_npx_mismatch_result=$(cat "$ipv6_npx_mismatch_output")
  if [[ "$status" -eq 0 ]] ||
    [[ "$ipv6_npx_mismatch_result" != *"ERR_TLS_CERT_ALTNAME_INVALID"* ]]; then
    printf 'Installed npx did not reject the mismatched registry certificate hostname identity (status %s):\n%s\n' \
      "$status" "$ipv6_npx_mismatch_result" >&2
    return 1
  fi
  assert_not_contains "$ipv6_npx_mismatch_result" "ECONNREFUSED"
  assert_not_contains "$ipv6_npx_mismatch_result" "ECONNRESET"
  assert_contains "$(cat "$ipv6_proxy_requests")" \
    "ipv6-mismatch.invalid:$(cat "$ipv6_port_file")"
  assert_not_contains "$(cat "$registry_requests")" "GET /${package_name}"

  : >"$registry_requests"
  : >"$ipv6_proxy_requests"
  set +e
  run_local_npm_install \
    "${workspace}/ipv6-npm-project" \
    "${workspace}/ipv6-npm-cache" "$ipv6_npm_output" \
    "${workspace}/ipv6-npm-marker" "$ipv6_url" "$ipv6_proxy_url"
  status=$?
  set -e
  if [[ "$status" -ne 0 ]] ||
    [[ ! -f "${workspace}/ipv6-npm-project/node_modules/${package_name}/package.json" ]]; then
    printf 'Installed npm did not accept the matching IPv6 registry certificate (status %s):\n' \
      "$status" >&2
    cat "$ipv6_npm_output" >&2
    return 1
  fi
  assert_contains "$(cat "$registry_requests")" "GET /${package_name}"
  assert_contains "$(cat "$ipv6_proxy_requests")" \
    "[::1]:$(cat "$ipv6_port_file")"

  : >"$registry_requests"
  : >"$ipv6_proxy_requests"
  set +e
  run_local_npm_install \
    "${workspace}/ipv6-npm-mismatch-project" \
    "${workspace}/ipv6-npm-mismatch-cache" "$ipv6_npm_mismatch_output" \
    "${workspace}/ipv6-npm-mismatch-marker" "$mismatched_ipv6_name_url" \
    "$ipv6_proxy_url"
  status=$?
  set -e
  local ipv6_npm_mismatch_result
  ipv6_npm_mismatch_result=$(cat "$ipv6_npm_mismatch_output")
  if [[ "$status" -eq 0 ]] ||
    [[ "$ipv6_npm_mismatch_result" != *"ERR_TLS_CERT_ALTNAME_INVALID"* ]]; then
    printf 'Installed npm did not reject the mismatched registry certificate hostname identity (status %s):\n%s\n' \
      "$status" "$ipv6_npm_mismatch_result" >&2
    return 1
  fi
  assert_not_contains "$ipv6_npm_mismatch_result" "ECONNREFUSED"
  assert_not_contains "$ipv6_npm_mismatch_result" "ECONNRESET"
  assert_contains "$(cat "$ipv6_proxy_requests")" \
    "ipv6-mismatch.invalid:$(cat "$ipv6_port_file")"
  assert_not_contains "$(cat "$registry_requests")" "GET /${package_name}"

  set +e
  run_local_npx "" \
    "${workspace}/untrusted-npm-cache" "$untrusted_npx_output"
  status=$?
  set -e
  if [[ "$status" -eq 0 ]]; then
    printf 'Installed npx accepted the registry certificate without the temporary CA.\n' >&2
    cat "$untrusted_npx_output" >&2
    return 1
  fi
  local untrusted_npx_result
  untrusted_npx_result=$(cat "$untrusted_npx_output")
  if [[ "$untrusted_npx_result" != *"UNABLE_TO_GET_ISSUER_CERT_LOCALLY"* &&
    "$untrusted_npx_result" != *"UNABLE_TO_VERIFY_LEAF_SIGNATURE"* &&
    "$untrusted_npx_result" != *"SELF_SIGNED_CERT_IN_CHAIN"* &&
    "$untrusted_npx_result" != *"DEPTH_ZERO_SELF_SIGNED_CERT"* ]]; then
    printf 'Untrusted npx registry request failed for a reason other than certificate validation:\n%s\n' \
      "$untrusted_npx_result" >&2
    return 1
  fi
  # Certificate validation fails during the TLS handshake, before any HTTP
  # request bytes are sent, so the registry must not log the package fetch;
  # the npm error above already proves the attempt reached the registry URL.
  assert_not_contains "$(cat "$registry_requests")" "GET /${package_name}"
  assert_not_contains "$(cat "$registry_requests")" "GET /fixture.tgz"

  printf 'altered\n' >"$tarball_mode_file"
  set +e
  run_local_npx "${cert_dir}/test-ca.pem" \
    "${workspace}/integrity-npm-cache" "$integrity_npx_output"
  status=$?
  set -e
  if [[ "$status" -eq 0 ]]; then
    printf 'Installed npx accepted altered tarball bytes with the original integrity metadata.\n' >&2
    cat "$integrity_npx_output" >&2
    return 1
  fi
  local integrity_npx_result
  integrity_npx_result=$(cat "$integrity_npx_output")
  if [[ "$integrity_npx_result" != *"EINTEGRITY"* &&
    "$integrity_npx_result" != *"integrity checksum failed"* ]]; then
    printf 'Altered tarball failed for a reason other than npm integrity validation:\n%s\n' \
      "$integrity_npx_result" >&2
    return 1
  fi
  assert_not_contains "$integrity_npx_result" \
    "local npx package resolved over verified TLS"
  assert_contains "$(cat "$registry_requests")" "GET /${package_name}"
  assert_contains "$(cat "$registry_requests")" "GET /fixture.tgz"

  printf 'redirect\n' >"$redirect_mode_file"
  set +e
  run_local_npx "${cert_dir}/test-ca.pem" \
    "${workspace}/redirect-integrity-npm-cache" "$redirect_integrity_npx_output"
  status=$?
  set -e
  if [[ "$status" -eq 0 ]]; then
    printf 'Installed npx accepted altered tarball bytes after following a registry redirect.\n' >&2
    cat "$redirect_integrity_npx_output" >&2
    return 1
  fi
  local redirect_integrity_npx_result
  redirect_integrity_npx_result=$(cat "$redirect_integrity_npx_output")
  if [[ "$redirect_integrity_npx_result" != *"EINTEGRITY"* &&
    "$redirect_integrity_npx_result" != *"integrity checksum failed"* ]]; then
    printf 'Redirected altered tarball failed for a reason other than npm integrity validation:\n%s\n' \
      "$redirect_integrity_npx_result" >&2
    return 1
  fi
  assert_not_contains "$redirect_integrity_npx_result" \
    "local npx package resolved over verified TLS"
  assert_contains "$(cat "$registry_requests")" "GET /redirect.tgz"
  assert_contains "$(cat "$tarball_requests")" "GET /fixture.tgz"

  printf 'http-downgrade\n' >"$redirect_mode_file"
  printf 'integrity\n' >"$metadata_mode_file"
  set +e
  run_local_npx "${cert_dir}/test-ca.pem" \
    "${workspace}/http-downgrade-npm-cache" "$downgrade_npx_output"
  status=$?
  set -e
  if [[ "$status" -eq 0 ]]; then
    printf 'Installed npx followed an HTTPS-to-HTTP tarball redirect:\n' >&2
    cat "$downgrade_npx_output" >&2
    if [[ -s "$http_tarball_requests" ]]; then
      printf 'Plain HTTP tarball requests observed:\n' >&2
      cat "$http_tarball_requests" >&2
    fi
    return 1
  fi
  local downgrade_npx_result
  downgrade_npx_result=$(cat "$downgrade_npx_output")
  assert_contains "$downgrade_npx_result" "ERR_RELEASE_RUNNER_HTTP_BLOCKED"
  assert_not_contains "$downgrade_npx_result" \
    "local npx package resolved over verified TLS"
  if [[ -s "$http_tarball_requests" ]]; then
    printf 'Installed npx requested the tarball over plain HTTP after an HTTPS redirect:\n' >&2
    cat "$http_tarball_requests" >&2
    cat "$downgrade_npx_output" >&2
    return 1
  fi
  assert_contains "$(cat "$registry_requests")" "GET /${package_name}"
  assert_contains "$(cat "$registry_requests")" "GET /downgrade.tgz"

  # The post-merge release path runs pnpm install after Node selection. Keep
  # both the package cache and pnpm store fresh for each transport case.
  : >"$registry_requests"
  : >"$tarball_requests"
  : >"$http_tarball_requests"
  printf 'direct\n' >"$redirect_mode_file"
  printf 'integrity\n' >"$metadata_mode_file"
  printf 'matching\n' >"$tarball_mode_file"
  set +e
  run_release_pnpm_install \
    "${workspace}/release-install-project" \
    "${workspace}/release-install-npm-cache" \
    "${workspace}/release-install-pnpm-store" \
    "$release_install_npm_output"
  status=$?
  set -e
  if [[ "$status" -ne 0 ]] ||
    [[ ! -f "${workspace}/release-install-project/node_modules/${package_name}/package.json" ]]; then
    printf 'Release-command pnpm install could not use verified HTTPS (status %s):\n' \
      "$status" >&2
    cat "$release_install_npm_output" >&2
    return 1
  fi
  assert_contains "$(cat "$registry_requests")" "GET /${package_name}"
  assert_contains "$(cat "$registry_requests")" "GET /fixture.tgz"
  [[ ! -s "$http_tarball_requests" ]] || {
    printf 'Successful HTTPS release install unexpectedly reached the HTTP listener:\n' >&2
    cat "$http_tarball_requests" >&2
    return 1
  }

  : >"$registry_requests"
  : >"$tarball_requests"
  : >"$http_tarball_requests"
  printf 'http-downgrade\n' >"$redirect_mode_file"
  set +e
  run_release_pnpm_install \
    "${workspace}/release-downgrade-project" \
    "${workspace}/release-downgrade-npm-cache" \
    "${workspace}/release-downgrade-pnpm-store" \
    "$release_downgrade_npm_output"
  status=$?
  set -e
  if [[ "$status" -eq 0 ]]; then
    printf 'Release-command pnpm install followed an HTTPS-to-HTTP tarball redirect.\n' >&2
    cat "$release_downgrade_npm_output" >&2
    return 1
  fi
  assert_contains "$(cat "$release_downgrade_npm_output")" \
    "HTTP 403"
  assert_contains "$(cat "$release_downgrade_npm_output")" \
    "Release runner blocked a cleartext HTTP package request."
  assert_contains "$(cat "$registry_requests")" "GET /${package_name}"
  assert_contains "$(cat "$registry_requests")" "GET /downgrade.tgz"
  [[ ! -s "$http_tarball_requests" ]] || {
    printf 'Release-command pnpm install reached the plain HTTP tarball listener:\n' >&2
    cat "$http_tarball_requests" >&2
    cat "$release_downgrade_npm_output" >&2
    return 1
  }

  printf 'direct\n' >"$redirect_mode_file"
  printf 'shasum-only\n' >"$metadata_mode_file"
  printf 'matching\n' >"$tarball_mode_file"
  set +e
  run_local_npm_install \
    "${workspace}/lifecycle-control-project" \
    "${workspace}/lifecycle-control-npm-cache" \
    "$lifecycle_control_npm_output" "$lifecycle_control_marker"
  status=$?
  set -e
  if [[ "$status" -ne 0 ]] ||
    [[ ! -f "$lifecycle_control_marker" ]]; then
    printf 'Installed npm did not run the valid package preinstall hook (status %s):\n' \
      "$status" >&2
    cat "$lifecycle_control_npm_output" >&2
    if [[ -f "$lifecycle_control_marker" ]]; then
      cat "$lifecycle_control_marker" >&2
    fi
    return 1
  fi
  assert_contains "$(cat "$lifecycle_control_marker")" "preinstall ran"

  printf 'altered\n' >"$tarball_mode_file"
  rm -f "$lifecycle_rejected_marker"
  set +e
  run_local_npm_install \
    "${workspace}/lifecycle-rejected-project" \
    "${workspace}/lifecycle-rejected-npm-cache" \
    "$lifecycle_rejected_npm_output" "$lifecycle_rejected_marker"
  status=$?
  set -e
  if [[ "$status" -eq 0 ]]; then
    printf 'Installed npm accepted altered shasum-only tarball bytes.\n' >&2
    cat "$lifecycle_rejected_npm_output" >&2
    return 1
  fi
  local lifecycle_rejected_npm_result
  lifecycle_rejected_npm_result=$(cat "$lifecycle_rejected_npm_output")
  if [[ "$lifecycle_rejected_npm_result" != *"EINTEGRITY"* &&
    "$lifecycle_rejected_npm_result" != *"checksum failed"* &&
    "$lifecycle_rejected_npm_result" != *"checksum mismatch"* ]]; then
    printf 'Altered shasum-only tarball installation failed for a reason other than npm checksum validation:\n%s\n' \
      "$lifecycle_rejected_npm_result" >&2
    return 1
  fi
  if [[ -e "$lifecycle_rejected_marker" ]]; then
    printf 'Installed npm ran the preinstall hook before rejecting the altered shasum-only tarball.\n' >&2
    cat "$lifecycle_rejected_marker" >&2
    return 1
  fi

  printf 'redirect\n' >"$redirect_mode_file"
  rm -f "$lifecycle_redirected_marker"
  set +e
  run_local_npm_install \
    "${workspace}/lifecycle-redirected-project" \
    "${workspace}/lifecycle-redirected-npm-cache" \
    "$lifecycle_redirected_npm_output" "$lifecycle_redirected_marker"
  status=$?
  set -e
  if [[ "$status" -eq 0 ]]; then
    printf 'Installed npm accepted altered shasum-only tarball bytes after following a registry redirect.\n' >&2
    cat "$lifecycle_redirected_npm_output" >&2
    return 1
  fi
  local lifecycle_redirected_npm_result
  lifecycle_redirected_npm_result=$(cat "$lifecycle_redirected_npm_output")
  if [[ "$lifecycle_redirected_npm_result" != *"EINTEGRITY"* &&
    "$lifecycle_redirected_npm_result" != *"checksum failed"* &&
    "$lifecycle_redirected_npm_result" != *"checksum mismatch"* ]]; then
    printf 'Redirected altered shasum-only tarball installation failed for a reason other than npm checksum validation:\n%s\n' \
      "$lifecycle_redirected_npm_result" >&2
    return 1
  fi
  if [[ -e "$lifecycle_redirected_marker" ]]; then
    printf 'Installed npm ran the preinstall hook before rejecting the redirected altered shasum-only tarball.\n' >&2
    cat "$lifecycle_redirected_marker" >&2
    return 1
  fi
  assert_contains "$(cat "$registry_requests")" "GET /redirect.tgz"
  assert_contains "$(cat "$tarball_requests")" "GET /fixture.tgz"

  printf 'direct\n' >"$redirect_mode_file"
  set +e
  run_local_npx "${cert_dir}/test-ca.pem" \
    "${workspace}/shasum-npm-cache" "$shasum_npx_output"
  status=$?
  set -e
  if [[ "$status" -eq 0 ]]; then
    printf 'Installed npx accepted altered tarball bytes with only the original shasum metadata.\n' >&2
    cat "$shasum_npx_output" >&2
    return 1
  fi
  local shasum_npx_result
  shasum_npx_result=$(cat "$shasum_npx_output")
  if [[ "$shasum_npx_result" != *"EINTEGRITY"* &&
    "$shasum_npx_result" != *"checksum failed"* &&
    "$shasum_npx_result" != *"checksum mismatch"* ]]; then
    printf 'Altered tarball with shasum-only metadata failed for a reason other than npm checksum validation:\n%s\n' \
      "$shasum_npx_result" >&2
    return 1
  fi
  assert_not_contains "$shasum_npx_result" \
    "local npx package resolved over verified TLS"
  assert_contains "$(cat "$registry_requests")" "GET /${package_name}"
  assert_contains "$(cat "$registry_requests")" "GET /fixture.tgz"

  kill "$TLS_SERVER_PID" 2>/dev/null || true
  wait "$TLS_SERVER_PID" 2>/dev/null || true
  TLS_SERVER_PID=""
  echo "PASS: Node TLS identity checks accept matching IPv4/IPv6 IP SANs and reject mismatches; npm and npx accept matching IPv6 registry certificates and reject mismatches; Node and package managers verify trusted TLS; untrusted, mismatched, invalid, expired, and future-dated certificates are rejected; HTTPS-to-HTTP tarball downgrades are blocked with fresh caches; altered bytes, including direct, redirected, and shasum-only npm cases, are rejected before package lifecycle hooks"
}

ISOLATED_BROWSER_RUNNER="${SCRIPT_DIR}/run-isolated-browser-suite.sh"
ISOLATED_TEST_BIN="${TEST_ROOT}/isolated-browser-bin"
ISOLATED_TEST_OUTPUT="${TEST_ROOT}/isolated-browser-output"
ISOLATED_DB_PATH_FILE="${TEST_ROOT}/isolated-browser-db-path"
ISOLATED_PLAYWRIGHT_STARTED="${TEST_ROOT}/isolated-playwright-started"
ISOLATED_PLAYWRIGHT_STOPPED="${TEST_ROOT}/isolated-playwright-stopped"
mkdir -p "$ISOLATED_TEST_BIN"

cat >"${ISOLATED_TEST_BIN}/postgres" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

cat >"${ISOLATED_TEST_BIN}/initdb" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
args=("$@")
for ((index = 0; index < ${#args[@]}; index++)); do
  if [[ "${args[index]}" == "-D" ]]; then
    printf '%s\n' "${args[index + 1]}" >"$ISOLATED_DB_PATH_FILE"
    exit 0
  fi
done
printf 'initdb did not receive a data directory.\n' >&2
exit 2
EOF

cat >"${ISOLATED_TEST_BIN}/pg_ctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
args=("$@")
data_dir=""
for ((index = 0; index < ${#args[@]}; index++)); do
  if [[ "${args[index]}" == "-D" ]]; then
    data_dir="${args[index + 1]}"
    break
  fi
done
action="${args[${#args[@]} - 1]}"
case "$action" in
  start)
    : >"${data_dir}/running"
    ;;
  stop)
    rm -f "${data_dir}/running"
    ;;
  status)
    if [[ -f "${data_dir}/running" ]]; then
      exit 0
    fi
    exit 3
    ;;
  *)
    printf 'Unexpected pg_ctl action: %s\n' "$action" >&2
    exit 2
    ;;
esac
EOF

cat >"${ISOLATED_TEST_BIN}/createdb" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

cat >"${ISOLATED_TEST_BIN}/pnpm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "--filter" ]]; then
  exit 0
fi
if [[ "${1:-}" == "exec" && "${2:-}" == "playwright" && "${3:-}" == "test" ]]; then
  : >"$ISOLATED_PLAYWRIGHT_STARTED"
  if [[ "${ISOLATED_PLAYWRIGHT_MODE:-}" == "hang" ]]; then
    trap 'touch "$ISOLATED_PLAYWRIGHT_STOPPED"; exit 143' INT TERM
    while :; do
      sleep 1
    done
  fi
  exit "${ISOLATED_PLAYWRIGHT_STATUS:-0}"
fi
printf 'Unexpected pnpm invocation: %s\n' "$*" >&2
exit 64
EOF

chmod +x \
  "${ISOLATED_TEST_BIN}/postgres" \
  "${ISOLATED_TEST_BIN}/initdb" \
  "${ISOLATED_TEST_BIN}/pg_ctl" \
  "${ISOLATED_TEST_BIN}/createdb" \
  "${ISOLATED_TEST_BIN}/pnpm"

run_isolated_browser_case() {
  local expected_status="$1"
  local playwright_status="$2"
  local actual_status
  rm -f "$ISOLATED_DB_PATH_FILE" "$ISOLATED_PLAYWRIGHT_STARTED"

  set +e
  env \
    -u NODE_ENV \
    -u APP_ENV \
    -u REPLIT_DEPLOYMENT \
    PATH="${ISOLATED_TEST_BIN}:${PATH}" \
    ISOLATED_DB_PATH_FILE="$ISOLATED_DB_PATH_FILE" \
    ISOLATED_PLAYWRIGHT_STARTED="$ISOLATED_PLAYWRIGHT_STARTED" \
    ISOLATED_PLAYWRIGHT_STATUS="$playwright_status" \
    bash "$ISOLATED_BROWSER_RUNNER" \
    --playwright-config=playwright.smoke.config.ts \
    >"$ISOLATED_TEST_OUTPUT" 2>&1
  actual_status=$?
  set -e

  [[ "$actual_status" -eq "$expected_status" ]] || {
    printf 'Expected isolated browser status %s, got %s. Output:\n' \
      "$expected_status" "$actual_status" >&2
    cat "$ISOLATED_TEST_OUTPUT" >&2
    return 1
  }
  [[ -f "$ISOLATED_DB_PATH_FILE" ]] || {
    printf 'Isolated browser run did not create its disposable database.\n' >&2
    return 1
  }
  local db_path
  db_path=$(cat "$ISOLATED_DB_PATH_FILE")
  [[ ! -e "$db_path" ]] || {
    printf 'Isolated browser run left its disposable database at %s.\n' \
      "$db_path" >&2
    return 1
  }
}

test_isolated_browser_status_and_database_cleanup() {
  run_isolated_browser_case 0 0
  run_isolated_browser_case 37 37
  (
    cd "$TEST_ROOT"
    run_isolated_browser_case 0 0
  )
  echo "PASS: isolated browser runner preserves Playwright status and cleans its disposable database"
  echo "PASS: isolated browser runner resolves its workspace independently of the caller directory"
}

test_isolated_browser_interrupt_cleans_database() {
  rm -f \
    "$ISOLATED_DB_PATH_FILE" \
    "$ISOLATED_PLAYWRIGHT_STARTED" \
    "$ISOLATED_PLAYWRIGHT_STOPPED"
  set +e
  env \
    -u NODE_ENV \
    -u APP_ENV \
    -u REPLIT_DEPLOYMENT \
    PATH="${ISOLATED_TEST_BIN}:${PATH}" \
    ISOLATED_DB_PATH_FILE="$ISOLATED_DB_PATH_FILE" \
    ISOLATED_PLAYWRIGHT_STARTED="$ISOLATED_PLAYWRIGHT_STARTED" \
    ISOLATED_PLAYWRIGHT_STOPPED="$ISOLATED_PLAYWRIGHT_STOPPED" \
    ISOLATED_PLAYWRIGHT_MODE=hang \
    bash "$ISOLATED_BROWSER_RUNNER" \
    --playwright-config=playwright.smoke.config.ts \
    >"$ISOLATED_TEST_OUTPUT" 2>&1 &
  local runner_pid=$!
  local attempt
  for ((attempt = 0; attempt < 200; attempt++)); do
    [[ -f "$ISOLATED_PLAYWRIGHT_STARTED" ]] && break
    sleep 0.1
  done
  if [[ ! -f "$ISOLATED_PLAYWRIGHT_STARTED" ]]; then
    kill -TERM "$runner_pid" 2>/dev/null || true
    wait "$runner_pid" 2>/dev/null || true
    set -e
    printf 'Isolated browser runner did not reach the Playwright command.\n' >&2
    cat "$ISOLATED_TEST_OUTPUT" >&2
    return 1
  fi
  kill -TERM "$runner_pid"
  wait "$runner_pid"
  local actual_status=$?
  set -e

  [[ "$actual_status" -eq 143 ]] || {
    printf 'Expected interrupted isolated browser status 143, got %s. Output:\n' \
      "$actual_status" >&2
    cat "$ISOLATED_TEST_OUTPUT" >&2
    return 1
  }
  [[ -f "$ISOLATED_PLAYWRIGHT_STOPPED" ]] || {
    printf 'Interrupted Playwright process did not receive the forwarded signal.\n' >&2
    return 1
  }
  local db_path
  db_path=$(cat "$ISOLATED_DB_PATH_FILE")
  [[ ! -e "$db_path" ]] || {
    printf 'Interrupted browser run left its disposable database at %s.\n' \
      "$db_path" >&2
    return 1
  }
  echo "PASS: interrupted isolated browser runner stops Playwright and removes its disposable database"
}

ISOLATED_SYNC_RUNNER="${SCRIPT_DIR}/run-isolated-sync-convergence.sh"
SYNC_TEST_BIN="${TEST_ROOT}/isolated-sync-bin"
mkdir -p "$SYNC_TEST_BIN"

cat >"${SYNC_TEST_BIN}/postgres" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

cat >"${SYNC_TEST_BIN}/initdb" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
args=("$@")
for ((index = 0; index < ${#args[@]}; index++)); do
  if [[ "${args[index]}" == "-D" ]]; then
    printf '%s\n' "${args[index + 1]}" >"$SYNC_DB_PATH_FILE"
    exit 0
  fi
done
printf 'initdb did not receive a data directory.\n' >&2
exit 2
EOF

cat >"${SYNC_TEST_BIN}/pg_ctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
args=("$@")
data_dir=""
for ((index = 0; index < ${#args[@]}; index++)); do
  if [[ "${args[index]}" == "-D" ]]; then
    data_dir="${args[index + 1]}"
    break
  fi
done
action="${args[${#args[@]} - 1]}"
case "$action" in
  start)
    : >"${data_dir}/running"
    : >"$SYNC_PG_STARTED"
    ;;
  stop)
    : >"$SYNC_PG_STOP_ATTEMPTED"
      if [[ -n "${SYNC_TIMEOUT_SESSION_FILE:-}" &&
        -s "$SYNC_TIMEOUT_SESSION_FILE" ]]; then
        test_session=$(cat "$SYNC_TIMEOUT_SESSION_FILE")
        if ps -eo sid=,stat= |
          awk -v session="$test_session" \
            '$1 == session && $2 !~ /^Z/ { found = 1 } END { exit !found }'; then
          : >"$SYNC_PG_STOP_WITH_TEST_CHILDREN"
        fi
      fi
    if [[ "${SYNC_PG_STOP_FAILURE:-0}" == "1" ]]; then
      exit 1
    fi
    rm -f "${data_dir}/running"
    : >"$SYNC_PG_STOPPED"
    ;;
  status)
    [[ -f "${data_dir}/running" ]]
    ;;
  *)
    printf 'Unexpected pg_ctl action: %s\n' "$action" >&2
    exit 2
    ;;
esac
EOF

cat >"${SYNC_TEST_BIN}/createdb" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "${@: -1}" >"$SYNC_DB_NAME_FILE"
EOF

cat >"${SYNC_TEST_BIN}/api-child" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
trap 'touch "$SYNC_API_STOPPED"; exit 0' TERM
touch "$SYNC_API_STARTED"
while :; do sleep 1; done
EOF

cat >"${SYNC_TEST_BIN}/vitest-child" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
trap 'touch "$SYNC_VITEST_STOPPED"; exit 0' TERM
touch "$SYNC_VITEST_STARTED"
while :; do sleep 1; done
EOF

cat >"${SYNC_TEST_BIN}/pnpm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" != "--filter" ||
  "${2:-}" != "@workspace/api-server" ||
  "${3:-}" != "exec" ||
  "${4:-}" != "vitest" ]]; then
  printf 'Unexpected isolated sync pnpm invocation: %s\n' "$*" >&2
  exit 64
fi
printf '%s\n' "${DATABASE_URL:-<unset>}" >"$SYNC_DATABASE_URL_FILE"
printf '%s\n' "$*" >"$SYNC_PNPM_ARGS_FILE"
touch "$SYNC_PNPM_STARTED"
bash "$SYNC_TEST_BIN/api-child" &
bash "$SYNC_TEST_BIN/vitest-child" &
wait
EOF

chmod +x \
  "${SYNC_TEST_BIN}/postgres" \
  "${SYNC_TEST_BIN}/initdb" \
  "${SYNC_TEST_BIN}/pg_ctl" \
  "${SYNC_TEST_BIN}/createdb" \
  "${SYNC_TEST_BIN}/api-child" \
  "${SYNC_TEST_BIN}/vitest-child" \
  "${SYNC_TEST_BIN}/pnpm"

cat >"${SYNC_TEST_BIN}/timeout" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${SYNC_TIMEOUT_TEST_MODE:-}" != "expire" ]]; then
  exec "$SYNC_REAL_TIMEOUT" "$@"
fi

while (( $# > 0 )); do
  case "$1" in
    --*)
      shift
      ;;
    [0-9]*s|[0-9]*m|[0-9]*h)
      shift
      break
      ;;
    *)
      break
      ;;
  esac
done
if (( $# == 0 )); then
  printf 'Fake timeout did not receive a command.\n' >&2
  exit 64
fi

test_session=$(ps -o sid= -p "$$" | tr -d ' ')
printf '%s\n' "$test_session" >"$SYNC_TIMEOUT_SESSION_FILE"
"$@" &
command_pid=$!
for ((attempt = 0; attempt < 200; attempt++)); do
  if [[ -f "$SYNC_PNPM_STARTED" &&
    -f "$SYNC_API_STARTED" &&
    -f "$SYNC_VITEST_STARTED" ]]; then
    break
  fi
  sleep 0.01
done
if [[ ! -f "$SYNC_PNPM_STARTED" ||
  ! -f "$SYNC_API_STARTED" ||
  ! -f "$SYNC_VITEST_STARTED" ]]; then
  kill -TERM "$command_pid" 2>/dev/null || true
  wait "$command_pid" 2>/dev/null || true
  printf 'Fake timeout command did not start its test descendants.\n' >&2
  exit 65
fi

touch "$SYNC_TIMEOUT_STARTED"
printf 'fake timeout expired\n'
# Mirror a timeout that stops its direct command but exits without waiting for
# grandchildren that are still in the runner-owned session.
kill -TERM "$command_pid" 2>/dev/null || true
wait "$command_pid" 2>/dev/null || true
touch "$SYNC_TIMEOUT_EXPIRED"
exit 124
EOF
chmod +x "${SYNC_TEST_BIN}/timeout"

run_isolated_sync_interrupt_case() {
  local case_name="$1"
  local stop_failure="$2"
  local case_dir="${TEST_ROOT}/sync-${case_name}"
  local db_path
  local db_name
  local db_url
  local actual_status
  local attempt
  local runner_pid
  local output_path="${case_dir}/output"
  mkdir -p "${case_dir}/tmp"

  env \
    -u NODE_ENV \
    -u APP_ENV \
    -u REPLIT_DEPLOYMENT \
    PATH="${SYNC_TEST_BIN}:${PATH}" \
    TMPDIR="${case_dir}/tmp" \
    DATABASE_URL="postgresql://shared.example/should-not-be-used" \
    SYNC_DB_PATH_FILE="${case_dir}/db-path" \
    SYNC_DB_NAME_FILE="${case_dir}/db-name" \
    SYNC_DATABASE_URL_FILE="${case_dir}/database-url" \
    SYNC_PNPM_ARGS_FILE="${case_dir}/pnpm-args" \
    SYNC_PG_STARTED="${case_dir}/pg-started" \
    SYNC_PG_STOP_ATTEMPTED="${case_dir}/pg-stop-attempted" \
    SYNC_PG_STOPPED="${case_dir}/pg-stopped" \
    SYNC_PG_STOP_FAILURE="$stop_failure" \
    SYNC_PNPM_STARTED="${case_dir}/pnpm-started" \
    SYNC_API_STARTED="${case_dir}/api-started" \
    SYNC_API_STOPPED="${case_dir}/api-stopped" \
    SYNC_VITEST_STARTED="${case_dir}/vitest-started" \
    SYNC_VITEST_STOPPED="${case_dir}/vitest-stopped" \
    SYNC_TEST_BIN="$SYNC_TEST_BIN" \
    bash "$ISOLATED_SYNC_RUNNER" >"$output_path" 2>&1 &
  runner_pid=$!

  for ((attempt = 0; attempt < 200; attempt++)); do
    if [[ -f "${case_dir}/pnpm-started" &&
      -f "${case_dir}/api-started" &&
      -f "${case_dir}/vitest-started" ]]; then
      break
    fi
    sleep 0.1
  done
  if [[ ! -f "${case_dir}/pnpm-started" ||
    ! -f "${case_dir}/api-started" ||
    ! -f "${case_dir}/vitest-started" ]]; then
    kill -TERM "$runner_pid" 2>/dev/null || true
    wait "$runner_pid" 2>/dev/null || true
    printf 'Isolated sync runner did not reach the API/Vitest test processes.\n' >&2
    cat "$output_path" >&2
    return 1
  fi

  [[ -f "${case_dir}/db-path" && -f "${case_dir}/database-url" ]] || {
    kill -TERM "$runner_pid" 2>/dev/null || true
    wait "$runner_pid" 2>/dev/null || true
    printf 'Isolated sync runner did not initialize its disposable database.\n' >&2
    cat "$output_path" >&2
    return 1
  }
  db_url=$(cat "${case_dir}/database-url")
  db_name=$(cat "${case_dir}/db-name")
  if [[ ! "$db_url" =~ ^postgresql://postgres@127\.0\.0\.1:[0-9]+/sync_convergence_test_[[:xdigit:]]{12}$ ]]; then
    kill -TERM "$runner_pid" 2>/dev/null || true
    wait "$runner_pid" 2>/dev/null || true
    printf 'Isolated sync runner did not replace the inherited shared database URL: %s\n' \
      "$db_url" >&2
    return 1
  fi
  [[ "$db_url" == */"$db_name" ]] || {
    kill -TERM "$runner_pid" 2>/dev/null || true
    wait "$runner_pid" 2>/dev/null || true
    printf 'Isolated sync runner connected to a database other than the one it created.\n' >&2
    return 1
  }
  grep -Fq 'src/routes/sync.convergence.integration.test.ts' \
    "${case_dir}/pnpm-args" || {
    kill -TERM "$runner_pid" 2>/dev/null || true
    wait "$runner_pid" 2>/dev/null || true
    printf 'Isolated sync runner did not pass the owned integration test path to Vitest.\n' >&2
    return 1
  }

  kill -TERM "$runner_pid"
  set +e
  wait "$runner_pid"
  actual_status=$?
  set -e
  [[ "$actual_status" -eq 143 ]] || {
    printf 'Expected interrupted isolated sync status 143, got %s. Output:\n' \
      "$actual_status" >&2
    cat "$output_path" >&2
    return 1
  }
  [[ -f "${case_dir}/api-stopped" && -f "${case_dir}/vitest-stopped" ]] || {
    printf 'Interrupted isolated sync run did not stop both API and Vitest children.\n' >&2
    cat "$output_path" >&2
    return 1
  }
  [[ -f "${case_dir}/pg-stop-attempted" ]] || {
    printf 'Interrupted isolated sync run did not attempt to stop PostgreSQL.\n' >&2
    cat "$output_path" >&2
    return 1
  }

  db_path=$(cat "${case_dir}/db-path")
  if [[ "$stop_failure" == "1" ]]; then
    [[ -d "$db_path" ]] || {
      printf 'Unstoppable disposable PostgreSQL data directory was not preserved.\n' >&2
      cat "$output_path" >&2
      return 1
    }
    assert_contains "$(cat "$output_path")" \
      "Could not confirm that the disposable PostgreSQL server stopped; preserving its data directory at ${db_path}."
    rm -rf -- "$db_path"
  else
    [[ -f "${case_dir}/pg-stopped" ]] || {
      printf 'Interrupted isolated sync run did not stop PostgreSQL.\n' >&2
      cat "$output_path" >&2
      return 1
    }
    [[ ! -e "$db_path" ]] || {
      printf 'Interrupted isolated sync run left its disposable data directory at %s.\n' \
        "$db_path" >&2
      return 1
    }
  fi
}

test_isolated_sync_interrupt_cleans_database_and_children() {
  run_isolated_sync_interrupt_case stopped 0
  run_isolated_sync_interrupt_case unconfirmed-stop 1
  echo "PASS: interrupted isolated sync runner stops API/Vitest and cleans or safely preserves its disposable database"
}

run_isolated_sync_timeout_case() {
  local case_name="$1"
  local stop_failure="$2"
  local case_dir="${TEST_ROOT}/sync-timeout-${case_name}"
  local db_path
  local db_name
  local db_url
  local test_session
  local actual_status
  local attempt
  local runner_pid
  local output_path="${case_dir}/output"
  mkdir -p "${case_dir}/tmp"

  env \
    -u NODE_ENV \
    -u APP_ENV \
    -u REPLIT_DEPLOYMENT \
    PATH="${SYNC_TEST_BIN}:${PATH}" \
    TMPDIR="${case_dir}/tmp" \
    DATABASE_URL="postgresql://shared.example/should-not-be-used" \
    SYNC_DB_PATH_FILE="${case_dir}/db-path" \
    SYNC_DB_NAME_FILE="${case_dir}/db-name" \
    SYNC_DATABASE_URL_FILE="${case_dir}/database-url" \
    SYNC_PNPM_ARGS_FILE="${case_dir}/pnpm-args" \
    SYNC_PG_STARTED="${case_dir}/pg-started" \
    SYNC_PG_STOP_ATTEMPTED="${case_dir}/pg-stop-attempted" \
    SYNC_PG_STOPPED="${case_dir}/pg-stopped" \
    SYNC_PG_STOP_WITH_TEST_CHILDREN="${case_dir}/pg-stop-with-test-children" \
    SYNC_PG_STOP_FAILURE="$stop_failure" \
    SYNC_PNPM_STARTED="${case_dir}/pnpm-started" \
    SYNC_API_STARTED="${case_dir}/api-started" \
    SYNC_API_STOPPED="${case_dir}/api-stopped" \
    SYNC_VITEST_STARTED="${case_dir}/vitest-started" \
    SYNC_VITEST_STOPPED="${case_dir}/vitest-stopped" \
    SYNC_TIMEOUT_SESSION_FILE="${case_dir}/timeout-session" \
    SYNC_TIMEOUT_STARTED="${case_dir}/timeout-started" \
    SYNC_TIMEOUT_EXPIRED="${case_dir}/timeout-expired" \
    SYNC_TIMEOUT_TEST_MODE=expire \
    SYNC_REAL_TIMEOUT="$REAL_TIMEOUT_BIN" \
    SYNC_TEST_BIN="$SYNC_TEST_BIN" \
    bash "$ISOLATED_SYNC_RUNNER" >"$output_path" 2>&1 &
  runner_pid=$!

  for ((attempt = 0; attempt < 250; attempt++)); do
    [[ -f "${case_dir}/timeout-expired" ]] && break
    sleep 0.1
  done
  if [[ ! -f "${case_dir}/timeout-expired" ]]; then
    kill -TERM "$runner_pid" 2>/dev/null || true
    wait "$runner_pid" 2>/dev/null || true
    printf 'Isolated sync runner did not exercise fake timeout expiry.\n' >&2
    cat "$output_path" >&2
    return 1
  fi

  set +e
  wait "$runner_pid"
  actual_status=$?
  set -e
  [[ "$actual_status" -eq 124 ]] || {
    printf 'Expected timed-out isolated sync status 124, got %s. Output:\n' \
      "$actual_status" >&2
    cat "$output_path" >&2
    return 1
  }
  [[ -f "${case_dir}/api-stopped" && -f "${case_dir}/vitest-stopped" ]] || {
    printf 'Timed-out isolated sync run did not stop both API and Vitest children.\n' >&2
    cat "$output_path" >&2
    return 1
  }
  [[ -f "${case_dir}/pg-stop-attempted" ]] || {
    printf 'Timed-out isolated sync run did not attempt to stop PostgreSQL.\n' >&2
    cat "$output_path" >&2
    return 1
  }
  [[ ! -e "${case_dir}/pg-stop-with-test-children" ]] || {
    printf 'Timed-out isolated sync run attempted PostgreSQL cleanup before stopping test descendants.\n' >&2
    cat "$output_path" >&2
    return 1
  }

  db_url=$(cat "${case_dir}/database-url")
  db_name=$(cat "${case_dir}/db-name")
  if [[ ! "$db_url" =~ ^postgresql://postgres@127\.0\.0\.1:[0-9]+/sync_convergence_test_[[:xdigit:]]{12}$ ||
    "$db_url" != */"$db_name" ]]; then
    printf 'Timed-out isolated sync runner did not use its own disposable database URL: %s\n' \
      "$db_url" >&2
    cat "$output_path" >&2
    return 1
  fi

  test_session=$(cat "${case_dir}/timeout-session")
  if ps -eo sid=,stat= |
    awk -v session="$test_session" \
      '$1 == session && $2 !~ /^Z/ { found = 1 } END { exit !found }'; then
    printf 'Timed-out isolated sync run left live test descendants in session %s.\n' \
      "$test_session" >&2
    cat "$output_path" >&2
    return 1
  fi

  db_path=$(cat "${case_dir}/db-path")
  if [[ "$stop_failure" == "1" ]]; then
    [[ -d "$db_path" && -f "${db_path}/running" ]] || {
      printf 'Unconfirmed PostgreSQL shutdown did not preserve its live data directory.\n' >&2
      cat "$output_path" >&2
      return 1
    }
    assert_contains "$(cat "$output_path")" \
      "Could not confirm that the disposable PostgreSQL server stopped; preserving its data directory at ${db_path}."
    rm -rf -- "$db_path"
  else
    [[ -f "${case_dir}/pg-stopped" ]] || {
      printf 'Timed-out isolated sync run did not stop PostgreSQL.\n' >&2
      cat "$output_path" >&2
      return 1
    }
    [[ ! -e "$db_path" ]] || {
      printf 'Timed-out isolated sync run left its disposable data directory at %s.\n' \
        "$db_path" >&2
      return 1
    }
  fi
}

test_isolated_sync_timeout_cleans_descendants_before_database() {
  run_isolated_sync_timeout_case stopped 0
  run_isolated_sync_timeout_case unconfirmed-stop 1
  echo "PASS: timed-out isolated sync runner stops test descendants before PostgreSQL cleanup and removes or safely preserves its disposable database"
}

test_release_node_fallback_interrupt_stops_process_group() {
  local workspace
  local log_path
  local started_path
  local stopped_path
  local output_path
  local launcher_pid
  local cache_path_file
  local cache_path
  local attempt
  local actual_status
  workspace=$(make_workspace fallback-interrupt)
  log_path="${workspace}/events"
  started_path="${workspace}/npx-started"
  stopped_path="${workspace}/npx-stopped"
  cache_path_file="${workspace}/npx-cache-path"
  output_path="${workspace}/output"
  mkdir -p "${workspace}/tmp"
  write_node "${workspace}/bin/node" "24.19.0"
  cat >"${workspace}/bin/npx" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
touch "$NPX_STARTED"
printf '%s\n' "$npm_config_cache" >"$NPX_CACHE_PATH"
trap 'touch "$NPX_STOPPED"; exit 143' TERM
while :; do
  sleep 1
done
EOF
  chmod +x "${workspace}/bin/npx"

  RUN_LOG="$log_path" \
    NPX_STARTED="$started_path" \
    NPX_STOPPED="$stopped_path" \
    NPX_CACHE_PATH="$cache_path_file" \
    TMPDIR="${workspace}/tmp" \
    PATH="${workspace}/bin:${PATH}" \
    bash "${workspace}/scripts/src/run-release-node.sh" release-child \
    >"$output_path" 2>&1 &
  launcher_pid=$!

  for ((attempt = 0; attempt < 200; attempt++)); do
    [[ -f "$started_path" ]] && break
    sleep 0.1
  done
  if [[ ! -f "$started_path" ]]; then
    kill -TERM "$launcher_pid" 2>/dev/null || true
    wait "$launcher_pid" 2>/dev/null || true
    printf 'Pinned-Node fallback did not reach its npx process.\n' >&2
    cat "$output_path" >&2
    return 1
  fi
  [[ -s "$cache_path_file" ]] || {
    printf 'Pinned-Node fallback did not expose its temporary cache path.\n' >&2
    kill -TERM "$launcher_pid" 2>/dev/null || true
    wait "$launcher_pid" 2>/dev/null || true
    return 1
  }
  cache_path=$(cat "$cache_path_file")
  [[ -d "$cache_path" && "$(stat -c '%a' "$cache_path")" == "700" ]] || {
    printf 'Pinned-Node fallback cache was not private while active.\n' >&2
    kill -TERM "$launcher_pid" 2>/dev/null || true
    wait "$launcher_pid" 2>/dev/null || true
    return 1
  }

  kill -TERM "$launcher_pid"
  set +e
  wait "$launcher_pid"
  actual_status=$?
  set -e
  [[ "$actual_status" -eq 143 ]] || {
    printf 'Expected interrupted fallback status 143, got %s. Output:\n' \
      "$actual_status" >&2
    cat "$output_path" >&2
    return 1
  }
  [[ -f "$stopped_path" ]] || {
    printf 'Pinned-Node fallback did not forward TERM to its process group.\n' >&2
    cat "$output_path" >&2
    return 1
  }
  [[ ! -e "$cache_path" ]] || {
    printf 'Interrupted pinned-Node fallback left its temporary npm cache behind.\n' >&2
    return 1
  }
  [[ -z "$(find "${workspace}/tmp" -mindepth 1 -maxdepth 1 -type d -print -quit)" ]] || {
    printf 'Pinned-Node fallback left its temporary marker directory behind.\n' >&2
    return 1
  }

  # The interrupted process group must release the workspace lock as well.
  write_node "${workspace}/bin/node" "$REQUIRED_NODE_VERSION"
  RUN_LOG="$log_path" PATH="${workspace}/bin:${PATH}" \
    timeout 5s bash "${workspace}/scripts/src/run-release-node.sh" release-child \
    >"$output_path" 2>&1 || {
      printf 'Release runner remained locked after fallback interruption.\n' >&2
      cat "$output_path" >&2
      return 1
    }
  echo "PASS: interrupted pinned-Node fallback stops its child group and removes its marker directory"
}

test_release_runner_serializes_same_workspace_commands() {
  local workspace
  local active_dir
  local event_log
  local first_output
  local second_output
  local first_pid
  local second_pid
  local first_status
  local second_status
  local events
  local history_file
  local history_line
  local attempt
  local second_waited=false
  workspace=$(make_workspace serialized)
  history_file=$(lock_history_path "$workspace")
  active_dir="${workspace}/active"
  event_log="${workspace}/serialization-events"
  first_output="${workspace}/first-output"
  second_output="${workspace}/second-output"
  local release_gate="${workspace}/allow-first-release"
  write_node "${workspace}/bin/node" "$REQUIRED_NODE_VERSION"
  write_failing_npx "${workspace}/bin/npx"

  cat >"${workspace}/bin/serialized-child" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if ! mkdir "$SERIAL_ACTIVE_DIR" 2>/dev/null; then
  printf 'overlap:%s\n' "$SERIAL_RUN_ID" >>"$SERIAL_EVENT_LOG"
  exit 91
fi
trap 'rmdir "$SERIAL_ACTIVE_DIR" 2>/dev/null || true' EXIT
printf 'start:%s\n' "$SERIAL_RUN_ID" >>"$SERIAL_EVENT_LOG"
if [[ "$SERIAL_RUN_ID" == "first" ]]; then
  for ((attempt = 0; attempt < 1000; attempt += 1)); do
    [[ -e "$SERIAL_RELEASE_GATE" ]] && break
    sleep 0.01
  done
  [[ -e "$SERIAL_RELEASE_GATE" ]] || exit 92
fi
printf 'end:%s\n' "$SERIAL_RUN_ID" >>"$SERIAL_EVENT_LOG"
EOF
  chmod +x "${workspace}/bin/serialized-child"

  SERIAL_ACTIVE_DIR="$active_dir" SERIAL_EVENT_LOG="$event_log" \
    SERIAL_RELEASE_GATE="$release_gate" SERIAL_RUN_ID=first \
    RUN_LOG="${workspace}/runner-events" PATH="${workspace}/bin:${PATH}" \
    bash "${workspace}/scripts/src/run-release-node.sh" serialized-child \
    >"$first_output" 2>&1 &
  first_pid=$!

  for ((attempt = 0; attempt < 200; attempt += 1)); do
    [[ -d "$active_dir" ]] && break
    sleep 0.025
  done
  if [[ ! -d "$active_dir" ]]; then
    kill "$first_pid" 2>/dev/null || true
    wait "$first_pid" 2>/dev/null || true
    printf 'First release-runner command did not start.\n' >&2
    cat "$first_output" >&2
    return 1
  fi

  SERIAL_ACTIVE_DIR="$active_dir" SERIAL_EVENT_LOG="$event_log" \
    SERIAL_RELEASE_GATE="$release_gate" SERIAL_RUN_ID=second \
    HISTORY_ENV_SENTINEL="must-not-be-retained" \
    RUN_LOG="${workspace}/runner-events" PATH="${workspace}/bin:${PATH}" \
    bash "${workspace}/scripts/src/run-release-node.sh" serialized-child \
    "HISTORY_ARGUMENT_SENTINEL" \
    >"$second_output" 2>&1 &
  second_pid=$!

  for ((attempt = 0; attempt < 200; attempt += 1)); do
    if grep -q 'Release runner is waiting for the workspace validation lock' \
      "$second_output"; then
      second_waited=true
      break
    fi
    sleep 0.025
  done
  touch "$release_gate"

  set +e
  wait "$first_pid"
  first_status=$?
  wait "$second_pid"
  second_status=$?
  set -e
  if (( first_status != 0 || second_status != 0 )); then
    printf 'Concurrent release-runner children overlapped or failed (%s, %s).\n' \
      "$first_status" "$second_status" >&2
    cat "$first_output" "$second_output" >&2
    cat "$event_log" >&2
    return 1
  fi

  if [[ "$second_waited" != true ]]; then
    printf 'Second command did not report waiting for the workspace lock.\n' >&2
    cat "$second_output" >&2
    return 1
  fi
  assert_contains "$(cat "$second_output")" \
    "Release runner acquired the workspace validation lock after"
  [[ -f "$history_file" ]] || {
    printf 'Successful lock wait did not create its local history file.\n' >&2
    return 1
  }
  [[ "$(wc -l <"$history_file")" -eq 1 ]] || {
    printf 'Expected one successful lock-wait history event.\n' >&2
    cat "$history_file" >&2
    return 1
  }
  history_line=$(cat "$history_file")
  grep -Eq \
    '^\{"timestamp_utc":"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z","elapsed_wait_seconds":[0-9]+,"outcome":"acquired","owner_pid":"[1-9][0-9]*","owner_started_at":"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z"\}$' \
    <<<"$history_line" || {
    printf 'Successful lock-wait history has unexpected fields or values:\n%s\n' \
      "$history_line" >&2
    return 1
  }
  [[ "$(stat -c '%a' -- "$history_file")" == 600 ]] || {
    printf 'Lock-wait history must have mode 600.\n' >&2
    return 1
  }
  [[ "$(stat -c '%a' -- "$(dirname "$history_file")")" == 700 ]] || {
    printf 'Per-user release-runner directory must have mode 700.\n' >&2
    return 1
  }
  [[ "$(stat -c '%a' -- "${history_file}.lock")" == 600 ]] || {
    printf 'Lock-wait history lock file must have mode 600.\n' >&2
    return 1
  }
  assert_not_contains "$history_line" "HISTORY_ARGUMENT_SENTINEL"
  assert_not_contains "$history_line" "must-not-be-retained"

  events=$(cat "$event_log")
  if [[ "$events" == *overlap:* ]] ||
    [[ "$(grep -c '^start:' "$event_log")" -ne 2 ]] ||
    [[ "$(grep -c '^end:' "$event_log")" -ne 2 ]]; then
    printf 'Release-runner lock did not serialize both commands:\n%s\n' "$events" >&2
    return 1
  fi
  echo "PASS: concurrent release-runner commands in one workspace execute serially"
}

test_release_runner_lock_wait_times_out_with_owner_and_recovers() {
  local workspace
  local holder_started
  local holder_release
  local timeout_child_marker
  local holder_output
  local waiter_output
  local owner_pid
  local attempt
  local waiter_status
  local recovery_output
  local history_file
  workspace=$(make_workspace lock-timeout)
  history_file=$(lock_history_path "$workspace")
  holder_started="${workspace}/holder-started"
  holder_release="${workspace}/holder-release"
  timeout_child_marker="${workspace}/timeout-child-ran"
  holder_output="${workspace}/holder-output"
  waiter_output="${workspace}/waiter-output"
  recovery_output="${workspace}/recovery-output"
  write_node "${workspace}/bin/node" "$REQUIRED_NODE_VERSION"
  write_failing_npx "${workspace}/bin/npx"

  cat >"${workspace}/bin/lock-holder" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
touch "$LOCK_HOLDER_STARTED"
while [[ ! -e "$LOCK_HOLDER_RELEASE" ]]; do
  sleep 0.05
done
EOF
  cat >"${workspace}/bin/timeout-child" <<'EOF'
#!/usr/bin/env bash
touch "$TIMEOUT_CHILD_MARKER"
EOF
  chmod +x "${workspace}/bin/lock-holder" "${workspace}/bin/timeout-child"

  LOCK_HOLDER_STARTED="$holder_started" \
    LOCK_HOLDER_RELEASE="$holder_release" \
    RUN_LOG="${workspace}/holder-events" PATH="${workspace}/bin:${PATH}" \
    bash "${workspace}/scripts/src/run-release-node.sh" lock-holder \
    >"$holder_output" 2>&1 &
  local holder_pid=$!
  ACTIVE_RUNNER_PIDS+=("$holder_pid")

  for ((attempt = 0; attempt < 200; attempt++)); do
    [[ -f "$holder_started" ]] && break
    sleep 0.025
  done
  if [[ ! -f "$holder_started" ]]; then
    printf 'Lock holder did not start.\n' >&2
    cat "$holder_output" >&2
    return 1
  fi
  owner_pid="$holder_pid"

  set +e
  RELEASE_RUNNER_LOCK_WAIT_SECONDS=2 \
    TIMEOUT_CHILD_MARKER="$timeout_child_marker" \
    RUN_LOG="${workspace}/waiter-events" PATH="${workspace}/bin:${PATH}" \
    timeout 8s bash "${workspace}/scripts/src/run-release-node.sh" timeout-child \
    >"$waiter_output" 2>&1
  waiter_status=$?
  set -e

  if [[ "$waiter_status" -ne 75 ]]; then
    printf 'Expected bounded lock wait status 75, got %s. Output:\n' \
      "$waiter_status" >&2
    cat "$waiter_output" >&2
    return 1
  fi
  assert_contains "$(cat "$waiter_output")" "owner_pid=${owner_pid}"
  assert_contains "$(cat "$waiter_output")" "wait_limit=2s"
  assert_contains "$(cat "$waiter_output")" "owner_started_at="
  assert_contains "$(cat "$waiter_output")" "timed out after 2 seconds"
  assert_contains "$(cat "$waiter_output")" "Retry after the current validation command finishes"
  [[ -f "$history_file" ]] || {
    printf 'Timed-out lock wait did not create its local history file.\n' >&2
    return 1
  }
  assert_contains "$(cat "$history_file")" '"outcome":"timeout"'
  [[ "$(wc -l <"$history_file")" -eq 1 ]] || {
    printf 'Expected one timeout history event.\n' >&2
    cat "$history_file" >&2
    return 1
  }
  [[ ! -e "$timeout_child_marker" ]] || {
    printf 'Timed-out runner unexpectedly started its child command.\n' >&2
    return 1
  }
  kill -0 "$holder_pid" 2>/dev/null || {
    printf 'Timed-out waiter unexpectedly stopped the lock holder.\n' >&2
    return 1
  }

  set +e
  RELEASE_RUNNER_LOCK_WAIT_SECONDS=7201 \
    RUN_LOG="${workspace}/over-limit-events" PATH="${workspace}/bin:${PATH}" \
    timeout 5s bash "${workspace}/scripts/src/run-release-node.sh" timeout-child \
    >"${workspace}/over-limit-output" 2>&1
  waiter_status=$?
  set -e
  [[ "$waiter_status" -eq 2 ]] || {
    printf 'Expected over-limit lock wait configuration to fail with status 2, got %s.\n' \
      "$waiter_status" >&2
    cat "${workspace}/over-limit-output" >&2
    return 1
  }
  assert_contains "$(cat "${workspace}/over-limit-output")" \
    "Release runner lock wait must be between 1 and 7200 seconds"
  [[ ! -e "$timeout_child_marker" ]] || {
    printf 'Over-limit lock wait configuration unexpectedly started its child command.\n' >&2
    return 1
  }

  touch "$holder_release"
  wait "$holder_pid"
  ACTIVE_RUNNER_PIDS=()

  RUN_LOG="${workspace}/recovery-events" PATH="${workspace}/bin:${PATH}" \
    timeout 5s bash "${workspace}/scripts/src/run-release-node.sh" release-child \
    >"$recovery_output" 2>&1 || {
      printf 'Release runner did not recover after the holder released the lock.\n' >&2
      cat "$recovery_output" >&2
      return 1
    }
  assert_contains "$(cat "${workspace}/recovery-events")" \
    "child-node=v${REQUIRED_NODE_VERSION}"
  echo "PASS: lock contention reports its owner, times out within the configured bound, skips the child, and recovers after release"
}

test_release_runner_lock_history_rotates_and_recovers_malformed_state() {
  local workspace
  local history_file
  local holder_started
  local holder_release
  local holder_output
  local waiter_output
  local holder_pid
  local waiter_pid
  local waiter_status
  local attempt
  local first_line
  workspace=$(make_workspace lock-history-rotation)
  history_file=$(lock_history_path "$workspace")
  holder_started="${workspace}/holder-started"
  holder_release="${workspace}/holder-release"
  holder_output="${workspace}/holder-output"
  waiter_output="${workspace}/waiter-output"
  write_node "${workspace}/bin/node" "$REQUIRED_NODE_VERSION"
  write_failing_npx "${workspace}/bin/npx"

  cat >"${workspace}/bin/history-holder" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
touch "$HISTORY_HOLDER_STARTED"
while [[ ! -e "$HISTORY_HOLDER_RELEASE" ]]; do
  sleep 0.05
done
EOF
  chmod +x "${workspace}/bin/history-holder"
  HISTORY_HOLDER_STARTED="$holder_started" \
    HISTORY_HOLDER_RELEASE="$holder_release" \
    RUN_LOG="${workspace}/holder-events" PATH="${workspace}/bin:${PATH}" \
    bash "${workspace}/scripts/src/run-release-node.sh" history-holder \
    >"$holder_output" 2>&1 &
  holder_pid=$!
  ACTIVE_RUNNER_PIDS+=("$holder_pid")
  for ((attempt = 0; attempt < 200; attempt++)); do
    [[ -f "$holder_started" ]] && break
    sleep 0.025
  done
  [[ -f "$holder_started" ]] || {
    printf 'History test lock holder did not start.\n' >&2
    cat "$holder_output" >&2
    return 1
  }

  {
    printf '%s\n' '{"malformed":"prior-state"}'
    for ((attempt = 1; attempt <= 20; attempt++)); do
      printf \
        '{"timestamp_utc":"2026-01-01T00:00:00Z","elapsed_wait_seconds":%s,"outcome":"acquired","owner_pid":"1","owner_started_at":"2026-01-01T00:00:00Z"}\n' \
        "$attempt"
    done
    printf '%s\n' '{"truncated":'
  } >"$history_file"
  chmod 600 -- "$history_file"

  RUN_LOG="${workspace}/waiter-events" PATH="${workspace}/bin:${PATH}" \
    bash "${workspace}/scripts/src/run-release-node.sh" release-child \
    >"$waiter_output" 2>&1 &
  waiter_pid=$!
  ACTIVE_RUNNER_PIDS+=("$waiter_pid")
  for ((attempt = 0; attempt < 200; attempt++)); do
    grep -q 'Release runner is waiting for the workspace validation lock' \
      "$waiter_output" && break
    sleep 0.025
  done
  if ! grep -q 'Release runner is waiting for the workspace validation lock' \
    "$waiter_output"; then
    printf 'History rotation waiter did not begin waiting.\n' >&2
    cat "$waiter_output" >&2
    return 1
  fi
  touch "$holder_release"
  wait "$holder_pid"
  wait "$waiter_pid" || {
    printf 'History rotation waiter failed after lock release.\n' >&2
    cat "$waiter_output" >&2
    return 1
  }
  ACTIVE_RUNNER_PIDS=()

  [[ "$(wc -l <"$history_file")" -eq 20 ]] || {
    printf 'Lock-wait history did not retain exactly 20 events.\n' >&2
    cat "$history_file" >&2
    return 1
  }
  first_line=$(head -n 1 "$history_file")
  assert_contains "$first_line" '"elapsed_wait_seconds":2'
  assert_not_contains "$(cat "$history_file")" '"malformed"'
  assert_not_contains "$(cat "$history_file")" '"truncated"'
  assert_contains "$(tail -n 1 "$history_file")" '"outcome":"acquired"'
  [[ "$(stat -c '%a' -- "$history_file")" == 600 ]] || {
    printf 'Rotated lock-wait history must have mode 600.\n' >&2
    return 1
  }
  [[ -z "$(find "$(dirname "$history_file")" -maxdepth 1 \
    -name "$(basename "$history_file").tmp.*" -print -quit)" ]] || {
    printf 'Atomic history update left a temporary file behind.\n' >&2
    return 1
  }
  echo "PASS: local lock-wait history rotates atomically and ignores malformed prior records"
}

test_release_runner_lock_wait_interruption_is_recorded() {
  local workspace
  local history_file
  local holder_started
  local holder_release
  local timeout_child_marker
  local holder_output
  local waiter_output
  local holder_pid
  local waiter_pid
  local waiter_status
  local attempt
  workspace=$(make_workspace lock-interruption)
  history_file=$(lock_history_path "$workspace")
  holder_started="${workspace}/holder-started"
  holder_release="${workspace}/holder-release"
  timeout_child_marker="${workspace}/interrupted-child-ran"
  holder_output="${workspace}/holder-output"
  waiter_output="${workspace}/waiter-output"
  write_node "${workspace}/bin/node" "$REQUIRED_NODE_VERSION"
  write_failing_npx "${workspace}/bin/npx"
  cat >"${workspace}/bin/interrupt-holder" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
touch "$INTERRUPT_HOLDER_STARTED"
while [[ ! -e "$INTERRUPT_HOLDER_RELEASE" ]]; do
  sleep 0.05
done
EOF
  cat >"${workspace}/bin/interrupted-child" <<'EOF'
#!/usr/bin/env bash
touch "$INTERRUPTED_CHILD_MARKER"
EOF
  chmod +x "${workspace}/bin/interrupt-holder" \
    "${workspace}/bin/interrupted-child"

  INTERRUPT_HOLDER_STARTED="$holder_started" \
    INTERRUPT_HOLDER_RELEASE="$holder_release" \
    RUN_LOG="${workspace}/holder-events" PATH="${workspace}/bin:${PATH}" \
    bash "${workspace}/scripts/src/run-release-node.sh" interrupt-holder \
    >"$holder_output" 2>&1 &
  holder_pid=$!
  ACTIVE_RUNNER_PIDS+=("$holder_pid")
  for ((attempt = 0; attempt < 200; attempt++)); do
    [[ -f "$holder_started" ]] && break
    sleep 0.025
  done
  [[ -f "$holder_started" ]] || {
    printf 'Interrupt test lock holder did not start.\n' >&2
    cat "$holder_output" >&2
    return 1
  }

  set +e
  RELEASE_RUNNER_LOCK_WAIT_SECONDS=30 \
    INTERRUPTED_CHILD_MARKER="$timeout_child_marker" \
    RUN_LOG="${workspace}/waiter-events" PATH="${workspace}/bin:${PATH}" \
    bash "${workspace}/scripts/src/run-release-node.sh" interrupted-child \
    >"$waiter_output" 2>&1 &
  waiter_pid=$!
  ACTIVE_RUNNER_PIDS+=("$waiter_pid")
  set -e
  for ((attempt = 0; attempt < 200; attempt++)); do
    grep -q 'Release runner is waiting for the workspace validation lock' \
      "$waiter_output" && break
    sleep 0.025
  done
  if ! grep -q 'Release runner is waiting for the workspace validation lock' \
    "$waiter_output"; then
    printf 'Interrupt test waiter did not begin waiting.\n' >&2
    cat "$waiter_output" >&2
    return 1
  fi

  kill -TERM "$waiter_pid"
  set +e
  wait "$waiter_pid"
  waiter_status=$?
  set -e
  [[ "$waiter_status" -eq 143 ]] || {
    printf 'Expected interrupted waiter status 143, got %s.\n' \
      "$waiter_status" >&2
    cat "$waiter_output" >&2
    return 1
  }
  [[ -f "$history_file" ]] || {
    printf 'Interrupted lock wait did not create its local history file.\n' >&2
    return 1
  }
  assert_contains "$(cat "$history_file")" '"outcome":"interrupted"'
  [[ ! -e "$timeout_child_marker" ]] || {
    printf 'Interrupted lock waiter unexpectedly started its child command.\n' >&2
    return 1
  }
  kill -0 "$holder_pid" 2>/dev/null || {
    printf 'Interrupting the waiter unexpectedly stopped the lock holder.\n' >&2
    return 1
  }

  touch "$holder_release"
  wait "$holder_pid"
  ACTIVE_RUNNER_PIDS=()
  RUN_LOG="${workspace}/recovery-events" PATH="${workspace}/bin:${PATH}" \
    timeout 5s bash "${workspace}/scripts/src/run-release-node.sh" release-child \
    >"${workspace}/recovery-output" 2>&1 || {
      printf 'Release runner did not recover after waiter interruption.\n' >&2
      cat "${workspace}/recovery-output" >&2
      return 1
    }
  echo "PASS: interrupted lock waits are recorded without stopping the active lock owner"
}

test_release_runner_nested_invocation_reuses_lock() {
  local workspace
  local log_path
  local output_path
  workspace=$(make_workspace nested-lock)
  log_path="${workspace}/events"
  output_path="${workspace}/output"
  write_node "${workspace}/bin/node" "$REQUIRED_NODE_VERSION"
  write_failing_npx "${workspace}/bin/npx"

  cat >"${workspace}/bin/release-child" <<EOF
#!/usr/bin/env bash
set -euo pipefail
timeout 5s bash "${workspace}/scripts/src/run-release-node.sh" nested-child
EOF
  cat >"${workspace}/bin/nested-child" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'nested-child-ran\n' >>"$RUN_LOG"
EOF
  chmod +x "${workspace}/bin/release-child" "${workspace}/bin/nested-child"

  RUN_LOG="$log_path" PATH="${workspace}/bin:${PATH}" \
    timeout 10s bash "${workspace}/scripts/src/run-release-node.sh" release-child \
    >"$output_path" 2>&1 || {
      printf 'Nested release-runner invocation failed or deadlocked.\n' >&2
      cat "$output_path" >&2
      return 1
    }
  assert_contains "$(cat "$log_path")" "nested-child-ran"
  echo "PASS: nested release-runner commands reuse the workspace lock without deadlocking"
}

test_release_runner_preserves_child_status() {
  local workspace
  local status
  workspace=$(make_workspace child-status)
  write_node "${workspace}/bin/node" "$REQUIRED_NODE_VERSION"
  write_failing_npx "${workspace}/bin/npx"
  cat >"${workspace}/bin/failing-child" <<'EOF'
#!/usr/bin/env bash
exit 37
EOF
  chmod +x "${workspace}/bin/failing-child"

  set +e
  RUN_LOG="${workspace}/events" PATH="${workspace}/bin:${PATH}" \
    bash "${workspace}/scripts/src/run-release-node.sh" failing-child \
    >"${workspace}/output" 2>&1
  status=$?
  set -e
  [[ "$status" -eq 37 ]] || {
    printf 'Expected child status 37 to propagate through lock, got %s.\n' "$status" >&2
    cat "${workspace}/output" >&2
    return 1
  }
  echo "PASS: release-runner lock preserves the child command exit status"
}

test_matching_node_skips_npx
test_pinned_pnpm_bootstrap_uses_package_manager_pin_and_cleans_cache
test_mismatching_node_uses_npx
test_concurrent_fallbacks_use_private_npm_caches
test_invalid_npx_registry_fails_before_package_acquisition
test_ipv6_npx_registry_url_is_forwarded
test_wrong_fallback_node_version_fails_before_release_commands
test_npx_package_resolution_failure_fails_before_release_commands
test_missing_node_selector_fails_before_release_commands
test_empty_node_selector_fails_before_release_commands
test_missing_npx_fails_before_release_commands
test_release_node_fallback_interrupt_stops_process_group
test_release_dependency_installs_use_https_guard
test_release_runner_verifies_local_tls_certificates
test_isolated_browser_status_and_database_cleanup
test_isolated_browser_interrupt_cleans_database
test_isolated_sync_interrupt_cleans_database_and_children
test_isolated_sync_timeout_cleans_descendants_before_database
test_release_runner_serializes_same_workspace_commands
test_release_runner_lock_wait_times_out_with_owner_and_recovers
test_release_runner_lock_history_rotates_and_recovers_malformed_state
test_release_runner_lock_history_viewer_handles_missing_and_malformed_history
test_release_runner_lock_history_viewer_shows_only_recent_safe_fields
test_release_runner_lock_history_viewer_rejects_symlinked_history_without_reading_or_modifying_target
test_release_runner_lock_history_viewer_rejects_broad_history_permissions_without_reading_or_modifying_file
test_release_runner_lock_history_viewer_rejects_symlinked_history_directory_without_reading_or_modifying_target
test_release_runner_lock_history_viewer_rejects_broad_history_directory_permissions_without_reading_or_modifying_contents
test_release_runner_lock_wait_interruption_is_recorded
test_release_runner_nested_invocation_reuses_lock
test_release_runner_preserves_child_status
