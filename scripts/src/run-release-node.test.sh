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
EOF
  chmod +x "${workspace}/bin/release-child"

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
  echo "PASS: mismatching Node path invokes npx, runs preflight, and preserves pinned Node for the child"
}

test_matching_node_skips_npx
test_mismatching_node_uses_npx