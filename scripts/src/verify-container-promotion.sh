#!/usr/bin/env bash

set -euo pipefail

evidence="${PROMOTION_EVIDENCE:-}"
output="${PROMOTION_OUTPUT:-}"
expected_revision="${EXPECTED_REVISION:-}"
expected_run_id="${EXPECTED_WORKFLOW_RUN_ID:-}"
expected_workflow="${EXPECTED_WORKFLOW:-.github/workflows/ci.yml}"
expected_artifact_digest="${EXPECTED_ARTIFACT_DIGEST:-}"
observed_artifact_digest="${OBSERVED_ARTIFACT_DIGEST:-}"

fail() {
  echo "Container promotion verification failed: $1" >&2
  exit 1
}

[[ -f "$evidence" ]] || fail "publisher evidence is missing"
[[ -n "$output" ]] || fail "PROMOTION_OUTPUT is required"
[[ "$expected_revision" =~ ^[0-9a-f]{40}$ ]] || fail "EXPECTED_REVISION must be a lowercase 40-character commit SHA"
[[ "$expected_run_id" =~ ^[1-9][0-9]*$ ]] || fail "EXPECTED_WORKFLOW_RUN_ID must be a positive integer"
[[ "$expected_workflow" == ".github/workflows/ci.yml" ]] || fail "unexpected producer workflow"
[[ "$expected_artifact_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "expected artifact digest is missing or malformed"
[[ "$observed_artifact_digest" == "$expected_artifact_digest" ]] || fail "downloaded artifact digest does not match the approved digest"

declare -A values=()
while IFS='=' read -r key value; do
  [[ "$key" =~ ^[a-z0-9_]+$ ]] || fail "evidence contains an invalid key"
  [[ -z "${values[$key]+x}" ]] || fail "evidence contains duplicate field $key"
  values["$key"]="$value"
done <"$evidence"

[[ "${values[schema_version]:-}" == "2" ]] || fail "unsupported or missing evidence schema"
[[ "${values[overall_status]:-}" == "pass" ]] || fail "publisher evidence did not pass"
[[ "${values[failure_count]:-}" == "0" ]] || fail "publisher evidence contains failures"
[[ "${values[expected_revision]:-}" == "$expected_revision" ]] || fail "evidence is stale or tied to another revision"
[[ "${values[producer_workflow]:-}" == "$expected_workflow" ]] || fail "evidence came from another workflow"
[[ "${values[producer_workflow_run_id]:-}" == "$expected_run_id" ]] || fail "evidence came from another workflow run"
[[ "${values[image_count]:-}" == "3" ]] || fail "evidence must contain exactly three images"

expected_labels=(api api-migrate web)
expected_repositories=(
  "${API_IMAGE:-}"
  "${API_MIGRATE_IMAGE:-}"
  "${WEB_IMAGE:-}"
)

temporary_output="${output}.tmp"
mkdir -p "$(dirname "$output")"
rm -f "$temporary_output"
trap 'rm -f "$temporary_output"' EXIT

{
  printf 'schema_version=1\n'
  printf 'revision=%s\n' "$expected_revision"
  printf 'producer_workflow=%s\n' "$expected_workflow"
  printf 'producer_workflow_run_id=%s\n' "$expected_run_id"
  printf 'publisher_artifact_digest=%s\n' "$expected_artifact_digest"
} >"$temporary_output"

for index in 1 2 3; do
  label="${expected_labels[$((index - 1))]}"
  repository="${expected_repositories[$((index - 1))]}"
  digest="${values[image_${index}_digest]:-}"

  [[ "$repository" =~ ^[A-Za-z0-9._/-]+$ ]] || fail "expected $label repository is missing or malformed"
  [[ "${values[image_${index}_name]:-}" == "$label" ]] || fail "evidence image order or name is invalid"
  [[ "${values[image_${index}_repository]:-}" == "$repository" ]] || fail "$label repository does not match the deployment contract"
  [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "$label digest is missing or malformed; tags are not accepted"
  [[ "${values[image_${index}_observed_revision]:-}" == "$expected_revision" ]] || fail "$label revision does not match"
  [[ "${values[image_${index}_digest_verified]:-}" == "true" ]] || fail "$label digest was not verified by the publisher"
  [[ "${values[image_${index}_revision_verified]:-}" == "true" ]] || fail "$label revision was not verified by the publisher"
  [[ "${values[image_${index}_status]:-}" == "pass" ]] || fail "$label publisher verification did not pass"

  printf '%s_image=%s@%s\n' "${label//-/_}" "$repository" "$digest" >>"$temporary_output"
done

mv "$temporary_output" "$output"
echo "Container promotion evidence verified; immutable image handoff created."