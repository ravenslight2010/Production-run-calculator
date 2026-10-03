#!/usr/bin/env bash

# Regression tests for the release Node launcher. These tests use only
# temporary fake executables, so neither branch downloads a package or runs a
# real release command.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
LAUNCHER="${SCRIPT_DIR}/run-release-node.sh"
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

REQUIRED_NODE_VERSION="24.20.0"

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
  printf '%s\n' "$REQUIRED_NODE_VERSION" >"${workspace}/.nvmrc"

  cat >"${workspace}/bin/release-child" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

printf 'child-node=%s\n' "$(node --version)" >>"$RUN_LOG"
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

  set +e
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
  assert_contains "$events" "package-child-node=v${REQUIRED_NODE_VERSION}"
  assert_not_contains "$events" "npx-invoked"
  echo "PASS: matching Node path runs preflight, skips npx, and preserves Node for the child"
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
    "${workspace}/bin:${PATH}"

  [[ "$RUN_STATUS" -eq 0 ]] || {
    printf 'Mismatching Node path failed. Output:\n%s\n' "$RUN_OUTPUT" >&2
    return 1
  }
  local events
  events=$(cat "$log_path")
  assert_contains "$events" "npx-invoked"
  assert_contains "$events" "preflight-node=v${REQUIRED_NODE_VERSION}"
  assert_contains "$events" "child-node=v${REQUIRED_NODE_VERSION}"
  assert_contains "$events" "package-child-node=v${REQUIRED_NODE_VERSION}"
  echo "PASS: mismatching Node path invokes npx, runs preflight, and preserves pinned Node for the child"
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
    [[ -f "${data_dir}/running" ]]
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
  echo "PASS: isolated browser runner preserves Playwright status and cleans its disposable database"
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

test_release_node_fallback_interrupt_stops_process_group() {
  local workspace
  local log_path
  local started_path
  local stopped_path
  local output_path
  local launcher_pid
  local attempt
  local actual_status
  workspace=$(make_workspace fallback-interrupt)
  log_path="${workspace}/events"
  started_path="${workspace}/npx-started"
  stopped_path="${workspace}/npx-stopped"
  output_path="${workspace}/output"
  mkdir -p "${workspace}/tmp"
  write_node "${workspace}/bin/node" "24.19.0"
  cat >"${workspace}/bin/npx" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
touch "$NPX_STARTED"
trap 'touch "$NPX_STOPPED"; exit 143' TERM
while :; do
  sleep 1
done
EOF
  chmod +x "${workspace}/bin/npx"

  RUN_LOG="$log_path" \
    NPX_STARTED="$started_path" \
    NPX_STOPPED="$stopped_path" \
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
  [[ -z "$(find "${workspace}/tmp" -mindepth 1 -maxdepth 1 -type d -print -quit)" ]] || {
    printf 'Pinned-Node fallback left its temporary marker directory behind.\n' >&2
    return 1
  }
  echo "PASS: interrupted pinned-Node fallback stops its child group and removes its marker directory"
}

test_matching_node_skips_npx
test_mismatching_node_uses_npx
test_wrong_fallback_node_version_fails_before_release_commands
test_npx_package_resolution_failure_fails_before_release_commands
test_missing_node_selector_fails_before_release_commands
test_empty_node_selector_fails_before_release_commands
test_missing_npx_fails_before_release_commands
test_isolated_browser_status_and_database_cleanup
test_isolated_browser_interrupt_cleans_database
test_release_node_fallback_interrupt_stops_process_group
