#!/bin/bash

# Regression tests for check-model-version-bump.sh. Each case runs the real
# guard inside an isolated two-commit repository so the test never depends on
# the current checkout's history or working tree.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
GUARD_SCRIPT="${SCRIPT_DIR}/check-model-version-bump.sh"
TEST_ROOT=$(mktemp -d)

cleanup() {
  rm -rf "${TEST_ROOT}"
}
trap cleanup EXIT

make_base_repo() {
  local repo="$1"

  mkdir -p \
    "${repo}/scripts/src" \
    "${repo}/lib/integrations-openai-ai-server/src" \
    "${repo}/lib/spec-import/src" \
    "${repo}/artifacts/api-server/src/routes" \
    "${repo}/artifacts/run-calculator/src"
  cp "${GUARD_SCRIPT}" "${repo}/scripts/src/check-model-version-bump.sh"
  chmod +x "${repo}/scripts/src/check-model-version-bump.sh"

  cat > "${repo}/artifacts/api-server/src/routes/aiParseSpecSheet.ts" <<'EOF'
export const parsePrompt = "original prompt";
EOF
  cat > "${repo}/artifacts/run-calculator/src/specImport.ts" <<'EOF'
export const SPEC_PARSE_VERSION = "10";
EOF
  cat > "${repo}/lib/integrations-openai-ai-server/src/models.ts" <<'EOF'
export const AI_MODELS = ["original-model"];
EOF
  cat > "${repo}/lib/spec-import/src/index.ts" <<'EOF'
export type ParsedRecipe = { name: string };
EOF

  git -C "${repo}" init -q
  git -C "${repo}" config user.email "guard-test@example.invalid"
  git -C "${repo}" config user.name "Guard test"
  git -C "${repo}" add .
  git -C "${repo}" commit -q -m "base"
}

run_guard() {
  local repo="$1"
  local expected_status="$2"
  local output
  local status

  set +e
  output=$(cd "${repo}" && DIFF_BASE=HEAD~1 DIFF_TARGET=HEAD bash scripts/src/check-model-version-bump.sh 2>&1)
  status=$?
  set -e

  if [ "${status}" -ne "${expected_status}" ]; then
    echo "Expected guard exit ${expected_status}, got ${status}."
    echo "${output}"
    return 1
  fi
}

test_rejects_prompt_change_without_version_bump() {
  local repo="${TEST_ROOT}/without-bump"
  make_base_repo "${repo}"

  printf 'export const parsePrompt = "changed prompt";\n' \
    > "${repo}/artifacts/api-server/src/routes/aiParseSpecSheet.ts"
  git -C "${repo}" add .
  git -C "${repo}" commit -q -m "rewrite prompt without version bump"

  run_guard "${repo}" 1
  echo "PASS: rejects a prompt change without a SPEC_PARSE_VERSION bump"
}

test_accepts_prompt_change_with_version_bump() {
  local repo="${TEST_ROOT}/with-bump"
  make_base_repo "${repo}"

  printf 'export const parsePrompt = "changed prompt";\n' \
    > "${repo}/artifacts/api-server/src/routes/aiParseSpecSheet.ts"
  printf 'export const SPEC_PARSE_VERSION = "11";\n' \
    > "${repo}/artifacts/run-calculator/src/specImport.ts"
  git -C "${repo}" add .
  git -C "${repo}" commit -q -m "rewrite prompt with version bump"

  run_guard "${repo}" 0
  echo "PASS: accepts a prompt change with a SPEC_PARSE_VERSION bump"
}

test_rejects_sanitizer_change_without_version_bump() {
  local repo="${TEST_ROOT}/sanitizer-without-bump"
  make_base_repo "${repo}"

  cat > "${repo}/lib/spec-import/src/index.ts" <<'EOF'
export type ParsedRecipe = { name: string; doughName?: string };
EOF
  git -C "${repo}" add .
  git -C "${repo}" commit -q -m "change sanitizer output shape without version bump"

  run_guard "${repo}" 1
  echo "PASS: rejects a sanitizer/type change without a SPEC_PARSE_VERSION bump"
}

test_accepts_sanitizer_change_with_version_bump() {
  local repo="${TEST_ROOT}/sanitizer-with-bump"
  make_base_repo "${repo}"

  cat > "${repo}/lib/spec-import/src/index.ts" <<'EOF'
export type ParsedRecipe = { name: string; doughName?: string };
EOF
  printf 'export const SPEC_PARSE_VERSION = "11";\n' \
    > "${repo}/artifacts/run-calculator/src/specImport.ts"
  git -C "${repo}" add .
  git -C "${repo}" commit -q -m "change sanitizer output shape with version bump"

  run_guard "${repo}" 0
  echo "PASS: accepts a sanitizer/type change with a SPEC_PARSE_VERSION bump"
}

test_rejects_prompt_change_without_version_bump
test_accepts_prompt_change_with_version_bump
test_rejects_sanitizer_change_without_version_bump
test_accepts_sanitizer_change_with_version_bump