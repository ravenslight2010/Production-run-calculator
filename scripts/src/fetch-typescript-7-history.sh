#!/usr/bin/env bash

set -euo pipefail

: "${GITHUB_WORKSPACE:?GITHUB_WORKSPACE is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"
: "${GITHUB_ENV:?GITHUB_ENV is required}"

root="$GITHUB_WORKSPACE/typescript-7-history"
history="$root/history.json"
mkdir -p "$root"
printf '[]\n' > "$history"
count=0

while IFS=$'\t' read -r run_id; do
  [[ -n "$run_id" && "$run_id" != "$GITHUB_RUN_ID" ]] || continue
  artifacts="$(gh api "repos/${GITHUB_REPOSITORY}/actions/runs/${run_id}/artifacts?per_page=100" || true)"
  artifact_id="$(jq -r '[.artifacts[]? | select(.expired == false) | select(.name | startswith("release-evidence-standard-"))] | .[0].id // empty' <<<"$artifacts" 2>/dev/null || true)"
  [[ -n "$artifact_id" ]] || continue
  zip="$root/candidate.zip"
  dir="$root/candidate"
  rm -rf "$dir" "$zip"
  mkdir -p "$dir"
  gh api "repos/${GITHUB_REPOSITORY}/actions/artifacts/${artifact_id}/zip" >"$zip" || continue
  entries="$(unzip -Z1 "$zip" 2>/dev/null || true)"
  [[ -n "$entries" ]] || continue
  grep -Eq '(^/|(^|/)\.\.(/|$))' <<<"$entries" && continue
  unzip -q "$zip" -d "$dir" || continue
  report="$(find "$dir" -type f -name typescript-7-comparison.json -print -quit)"
  [[ -n "$report" ]] || continue
  jq -e '.schemaVersion == 3 and (.sourceRevision | strings) and (.runner.image | strings | length > 0 and length <= 80) and (.runner.hardwareClass | strings | test("^[a-f0-9]{64}$")) and (.performanceComparison | arrays | length == 14)' "$report" >/dev/null || continue
  revision="$(jq -r '.sourceRevision' "$report")"
  if jq -e --arg revision "$revision" 'any(.sourceRevision == $revision)' "$history" >/dev/null; then
    echo "Ignoring duplicate TypeScript 7 evidence for revision ${revision}."
    continue
  fi
  jq --slurpfile report "$report" '. + [$report[0]]' "$history" >"$history.tmp"
  mv "$history.tmp" "$history"
  count=$((count + 1))
  [[ "$count" -ge 5 ]] && break
done < <(gh api "repos/${GITHUB_REPOSITORY}/actions/workflows/release-check.yml/runs?status=success&per_page=50" --jq '.workflow_runs[] | [.id] | @tsv')

echo "TYPESCRIPT_7_HISTORY_JSON=$history" >>"$GITHUB_ENV"
echo "Collected ${count} prior TypeScript 7 comparison artifact(s)."