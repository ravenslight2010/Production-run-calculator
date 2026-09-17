#!/usr/bin/env bash

# Hermetic regression coverage for the local Playwright WebKit wrapper.
# The fake browser records its final environment; no browser bundle or Nix
# installation is needed to run this test.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPOSITORY_ROOT=$(cd "${SCRIPT_DIR}/../.." && pwd)
WRAPPER="${REPOSITORY_ROOT}/artifacts/run-calculator/e2e/run-playwright-webkit-nix.sh"
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

BROWSER_ROOT="${TEST_ROOT}/browsers"
FAKE_BIN="${TEST_ROOT}/bin"
HOME_ROOT="${TEST_ROOT}/home"
mkdir -p \
  "${BROWSER_ROOT}/webkit-fake/minibrowser-wpe/bin" \
  "${FAKE_BIN}" \
  "${HOME_ROOT}"

cat > "${FAKE_BIN}/nix" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != "eval" || "${2:-}" != "--raw" ]]; then
  echo "unexpected fake nix invocation" >&2
  exit 1
fi

case "${3:-}" in
  nixpkgs#gcc.cc.lib.outPath) printf '/nix/store/fake-gcc' ;;
  nixpkgs#libglvnd.outPath) printf '/nix/store/fake-libglvnd' ;;
  nixpkgs#x264.lib.outPath) printf '/nix/store/fake-x264' ;;
  *) echo "unexpected nix attribute: ${3:-}" >&2; exit 1 ;;
esac
EOF
chmod +x "${FAKE_BIN}/nix"

cat > "${BROWSER_ROOT}/webkit-fake/minibrowser-wpe/bin/MiniBrowser" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "${LD_LIBRARY_PATH:-}" > "${WEBKIT_TEST_OUTPUT}"
printf '%s\n' "${WEBKIT_EXEC_PATH:-}" >> "${WEBKIT_TEST_OUTPUT}"
printf '%s\n' "${WEBKIT_INJECTED_BUNDLE_PATH:-}" >> "${WEBKIT_TEST_OUTPUT}"
printf '%s\n' "${WEBKIT_INSPECTOR_RESOURCES_PATH:-}" >> "${WEBKIT_TEST_OUTPUT}"
printf '%s\n' "$*" >> "${WEBKIT_TEST_OUTPUT}"
EOF
chmod +x "${BROWSER_ROOT}/webkit-fake/minibrowser-wpe/bin/MiniBrowser"

run_wrapper() {
  local output="$1"
  shift
  WEBKIT_TEST_OUTPUT="$output" \
    PLAYWRIGHT_BROWSERS_PATH="$BROWSER_ROOT" \
    HOME="$HOME_ROOT" \
    PATH="${FAKE_BIN}:$PATH" \
    env "$@" \
    bash "$WRAPPER" --test-argument
}

assert_contains() {
  local value="$1"
  local expected="$2"
  if [[ ":${value}:" != *":${expected}:"* ]]; then
    printf 'Expected %s to contain path %s\nActual: %s\n' \
      "LD_LIBRARY_PATH" "$expected" "$value" >&2
    exit 1
  fi
}

fallback_output="${TEST_ROOT}/fallback.txt"
run_wrapper "$fallback_output" LD_LIBRARY_PATH="/existing/lib"
fallback_library_path=$(sed -n '1p' "$fallback_output")
assert_contains "$fallback_library_path" "${BROWSER_ROOT}/webkit-fake/minibrowser-wpe/lib"
assert_contains "$fallback_library_path" "${BROWSER_ROOT}/webkit-fake/minibrowser-wpe/sys/lib"
assert_contains "$fallback_library_path" "/nix/store/fake-gcc/lib"
assert_contains "$fallback_library_path" "/nix/store/fake-libglvnd/lib"
assert_contains "$fallback_library_path" "/nix/store/fake-x264/lib"
assert_contains "$fallback_library_path" "/existing/lib"
grep -Fxq "${BROWSER_ROOT}/webkit-fake/minibrowser-wpe/bin" \
  <(sed -n '2p' "$fallback_output")
grep -Fxq "${BROWSER_ROOT}/webkit-fake/minibrowser-wpe/lib" \
  <(sed -n '3p' "$fallback_output")
grep -Fxq "${BROWSER_ROOT}/webkit-fake/minibrowser-wpe/share" \
  <(sed -n '4p' "$fallback_output")
grep -Fxq -- "--test-argument" <(sed -n '5p' "$fallback_output")

configured_output="${TEST_ROOT}/configured.txt"
configured_path="/configured/webkit:/configured/extra"
run_wrapper "$configured_output" \
  PLAYWRIGHT_WEBKIT_LIBRARY_PATH="  ${configured_path}  " \
  LD_LIBRARY_PATH="${configured_path}:/existing/lib"
configured_library_path=$(sed -n '1p' "$configured_output")
assert_contains "$configured_library_path" "${BROWSER_ROOT}/webkit-fake/minibrowser-wpe/lib"
assert_contains "$configured_library_path" "${BROWSER_ROOT}/webkit-fake/minibrowser-wpe/sys/lib"
assert_contains "$configured_library_path" "/configured/webkit"
assert_contains "$configured_library_path" "/configured/extra"
assert_contains "$configured_library_path" "/existing/lib"
if [[ "$configured_library_path" == *"/nix/store/fake-"* ]]; then
  echo "Explicit WebKit library path unexpectedly invoked the Nix fallback." >&2
  exit 1
fi

missing_root="${TEST_ROOT}/missing-browsers"
if PLAYWRIGHT_BROWSERS_PATH="$missing_root" HOME="$HOME_ROOT" PATH="${FAKE_BIN}:$PATH" \
  bash "$WRAPPER" >/dev/null 2>"${TEST_ROOT}/missing.stderr"; then
  echo "Wrapper unexpectedly succeeded without a WebKit browser bundle." >&2
  exit 1
fi
grep -Fq "Playwright WebKit is not installed under ${HOME_ROOT}/.cache/ms-playwright" \
  "${TEST_ROOT}/missing.stderr"

printf 'PASS: local WebKit wrapper preserves browser, Nix fallback, explicit library, and missing-bundle contracts.\n'