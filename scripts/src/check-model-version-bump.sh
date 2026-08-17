#!/bin/bash
# check-model-version-bump.sh
#
# Fails when AI_MODELS / pickModel is modified in a commit without a matching
# SPEC_PARSE_VERSION bump (i.e. the version value must actually change).
#
# WHY: the spec importer's per-chunk limits (chunk size, max_completion_tokens,
# maxProfiles) are tuned empirically to the current model. A model change that
# ships without a version bump means:
#   1. Cached parse snapshots (saved_spec_sheets) built against the OLD model
#      keep being served — the new model's output is never tested at import time.
#   2. No one is reminded to re-run the large-spec harness to verify the new
#      model can handle the 16 k-char chunk budget.
#
# USAGE (called by `pnpm --filter @workspace/scripts run check-model-bump`):
#   Default: checks HEAD~1..HEAD (last commit).
#   Override: DIFF_BASE=<ref> DIFF_TARGET=<ref> ./check-model-version-bump.sh
#
# Exit 0 = OK (no model change, or model changed + version actually bumped).
# Exit 1 = model changed but SPEC_PARSE_VERSION value was not changed.

set -euo pipefail

MODELS_FILE="lib/integrations-openai-ai-server/src/models.ts"
SPEC_FILE="artifacts/run-calculator/src/specImport.ts"

DIFF_BASE="${DIFF_BASE:-HEAD~1}"
DIFF_TARGET="${DIFF_TARGET:-HEAD}"

# Guard: if there is no parent commit (initial commit), nothing to check.
if ! git rev-parse "${DIFF_BASE}" >/dev/null 2>&1; then
  echo "OK: no parent commit (${DIFF_BASE} does not exist) — skipping check."
  exit 0
fi

# ── Step 1: did the models file change at all? ────────────────────────────────
MODELS_DIFF=$(git diff "${DIFF_BASE}..${DIFF_TARGET}" -- "${MODELS_FILE}" 2>/dev/null || true)

if [ -z "${MODELS_DIFF}" ]; then
  echo "OK: ${MODELS_FILE} not changed — no SPEC_PARSE_VERSION bump required."
  exit 0
fi

# ── Step 2: did the change touch AI_MODELS values? ───────────────────────────
# Look only at added/changed lines ('+' prefix, not '+++').
# Match lines carrying a quoted model string (e.g. "gemini-…"), not comments.
MODEL_VALUE_CHANGE=$(
  echo "${MODELS_DIFF}" \
    | grep -E '^\+[^+]' \
    | grep -E '"[a-zA-Z0-9._/-]+"' \
    | grep -vE '^\+\s*//' \
    || true
)

if [ -z "${MODEL_VALUE_CHANGE}" ]; then
  echo "OK: ${MODELS_FILE} changed but no quoted model value lines detected (comments/types only)."
  exit 0
fi

echo "Detected AI_MODELS value change in ${MODELS_FILE}:"
echo "${MODEL_VALUE_CHANGE}" | sed 's/^/  /'
echo ""

# ── Step 3: extract SPEC_PARSE_VERSION at base and target, compare values ─────
# Use `git show REF:FILE` to read the file at each ref and extract the version
# string (e.g. "21"). This avoids false-positives from comments or unchanged
# re-assignments — the version value must actually differ.

extract_version() {
  local ref="$1"
  git show "${ref}:${SPEC_FILE}" 2>/dev/null \
    | grep -E 'SPEC_PARSE_VERSION\s*=\s*"[^"]+"' \
    | grep -oE '"[^"]+"' \
    | head -1 \
    || true
}

BASE_VERSION=$(extract_version "${DIFF_BASE}")
TARGET_VERSION=$(extract_version "${DIFF_TARGET}")

if [ -z "${BASE_VERSION}" ] && [ -z "${TARGET_VERSION}" ]; then
  echo "WARNING: could not read SPEC_PARSE_VERSION from either ref — skipping version-bump check."
  exit 0
fi

if [ "${BASE_VERSION}" != "${TARGET_VERSION}" ] && [ -n "${TARGET_VERSION}" ]; then
  echo "OK: SPEC_PARSE_VERSION bumped from ${BASE_VERSION} to ${TARGET_VERSION}."
  exit 0
fi

# ── FAIL ──────────────────────────────────────────────────────────────────────
cat <<EOF
FAIL: AI_MODELS / pickModel changed but SPEC_PARSE_VERSION was NOT bumped.

  Base version  (${DIFF_BASE}): ${BASE_VERSION:-"<not found>"}
  Target version (${DIFF_TARGET}): ${TARGET_VERSION:-"<not found>"}

Every model change must be paired with a SPEC_PARSE_VERSION bump so that
cached spec-sheet parses (saved_spec_sheets DB table) are invalidated.
Without the bump, managers re-import the same file and silently receive
stale parse results that were tuned to the old model — no error is shown.

Fix:
  1. Increment SPEC_PARSE_VERSION in:
       ${SPEC_FILE}

  2. After the change ships, run the large-spec harness to re-verify that
     the new model can still handle the 16 k-char chunk budget:

       # Quick smoke run (~2 min, real AI calls):
       BRANDS=4 FLAVORS=3 \\
       VERIFY_USERNAME=<manager> VERIFY_PASSWORD=<pass> \\
       pnpm --filter @workspace/scripts run verify-large-spec-import

       # Full run (30×8 = 240 profiles, 10–20 min) — required before shipping:
       VERIFY_USERNAME=<manager> VERIFY_PASSWORD=<pass> \\
       pnpm --filter @workspace/scripts run verify-large-spec-import

  See .agents/skills/spec-import-guard/SKILL.md §4a for full setup instructions.
EOF
exit 1
