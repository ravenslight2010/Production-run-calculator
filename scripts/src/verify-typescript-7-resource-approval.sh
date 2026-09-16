#!/usr/bin/env bash

set -euo pipefail

: "${GITHUB_WORKSPACE:?GITHUB_WORKSPACE is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

approval="${1:-docs/typescript-7-resource-approval-evidence.json}"
root="$(mktemp -d "${RUNNER_TEMP:-/tmp}/typescript-7-approval.XXXXXX")"
trap 'rm -rf "$root"' EXIT

while IFS= read -r run_id; do
  [[ "$run_id" =~ ^[0-9]+$ ]] || {
    echo "Invalid workflow run ID in TypeScript 7 approval evidence." >&2
    exit 1
  }
  dir="$root/$run_id"
  mkdir -p "$dir"
  gh api "repos/${GITHUB_REPOSITORY}/actions/runs/${run_id}" >"$dir/workflow-run.json"
  artifacts="$(gh api "repos/${GITHUB_REPOSITORY}/actions/runs/${run_id}/artifacts?per_page=100")"
  artifact_id="$(jq -r '[.artifacts[] | select(.expired == false) | select(.name == "release-evidence-standard-\($runId)")] | if length == 1 then .[0].id else empty end' --arg runId "$run_id" <<<"$artifacts")"
  [[ "$artifact_id" =~ ^[0-9]+$ ]] || {
    echo "Expected one unexpired standard release artifact for workflow run ${run_id}." >&2
    exit 1
  }
  zip="$dir/artifact.zip"
  gh api "repos/${GITHUB_REPOSITORY}/actions/artifacts/${artifact_id}/zip" >"$zip"
  entries="$(unzip -Z1 "$zip")"
  if [[ -z "$entries" ]] || grep -Eq '(^/|(^|/)\.\.(/|$))' <<<"$entries"; then
    echo "Unsafe or empty artifact for workflow run ${run_id}." >&2
    exit 1
  fi
  matches="$(grep -Ec '(^|/)typescript-7-comparison\.json$' <<<"$entries")"
  [[ "$matches" -eq 1 ]] || {
    echo "Expected one TypeScript 7 report for workflow run ${run_id}." >&2
    exit 1
  }
  report_entry="$(grep -E '(^|/)typescript-7-comparison\.json$' <<<"$entries")"
  unzip -p "$zip" "$report_entry" >"$dir/typescript-7-comparison.json"
done < <(jq -er '.samples[].workflowRunId' "$approval")

pnpm --filter @workspace/scripts exec tsx ./src/verify-typescript-7-resource-approval.mts \
  "$approval" "$root"