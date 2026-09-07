#!/usr/bin/env bash

# Regression tests for the large-spec harness API endpoint selection.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "${SCRIPT_DIR}/../.." && pwd)
HARNESS_SCRIPT="${REPO_ROOT}/scripts/run-large-spec-harness.sh"
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

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
  local local_port="$2"
  local workspace="${TEST_ROOT}/${name}"

  mkdir -p \
    "${workspace}/artifacts/api-server/.replit-artifact" \
    "${workspace}/scripts" \
    "${workspace}/bin"
  cp "$HARNESS_SCRIPT" "${workspace}/scripts/run-large-spec-harness.sh"
  cat > "${workspace}/artifacts/api-server/.replit-artifact/artifact.toml" <<EOF
[[services]]
localPort = ${local_port}
EOF

  cat > "${workspace}/bin/curl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$TRACE_FILE"
exit 0
EOF
  cat > "${workspace}/bin/pnpm" <<'EOF'
#!/usr/bin/env bash
printf 'pnpm %s\n' "$*" >> "$TRACE_FILE"
exit 0
EOF
  chmod +x \
    "${workspace}/bin/curl" \
    "${workspace}/bin/pnpm" \
    "${workspace}/scripts/run-large-spec-harness.sh"
  printf '%s\n' "$workspace"
}

run_harness() {
  local workspace="$1"
  shift

  HARNESS_OUTPUT=$(
    cd "$workspace"
    env \
      -u API_BASE \
      "PATH=${workspace}/bin:${PATH}" \
      "TRACE_FILE=${workspace}/trace" \
      BRANDS=1 \
      FLAVORS=1 \
      "$@" \
      bash scripts/run-large-spec-harness.sh
  )
}

test_uses_artifact_local_port_by_default() {
  local workspace
  workspace=$(make_workspace configured 49123)

  run_harness "$workspace"

  assert_contains "$HARNESS_OUTPUT" "API_BASE: http://localhost:49123/api"
  assert_contains "$(cat "${workspace}/trace")" \
    "http://localhost:49123/api/healthz"
  echo "PASS: uses the API artifact localPort by default"
}

test_honors_explicit_api_base_override() {
  local workspace
  workspace=$(make_workspace override 49123)

  run_harness "$workspace" API_BASE=https://staging.example.test/api/

  assert_contains "$HARNESS_OUTPUT" \
    "API_BASE: https://staging.example.test/api"
  assert_contains "$(cat "${workspace}/trace")" \
    "https://staging.example.test/api/healthz"
  assert_not_contains "$(cat "${workspace}/trace")" \
    "http://localhost:49123/api/healthz"
  echo "PASS: honors an explicit API_BASE override"
}

test_uses_artifact_local_port_by_default
test_honors_explicit_api_base_override