#!/usr/bin/env bash

set -euo pipefail

: "${GITHUB_WORKSPACE:?GITHUB_WORKSPACE is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"
: "${GITHUB_ENV:?GITHUB_ENV is required}"

history_root="$GITHUB_WORKSPACE/calibration-history"
history_file="$history_root/release-concurrency-history.json"
mkdir -p "$history_root"
printf '[]\n' > "$history_file"
history_limit=5
run_scan_limit=50
history_count=0
workflow_path="release-concurrency-calibration.yml"
run_records="$(
  gh api \
    "repos/${GITHUB_REPOSITORY}/actions/workflows/${workflow_path}/runs?status=success&per_page=${run_scan_limit}" \
    --jq '.workflow_runs[] | [.id, .created_at] | @tsv'
)"

while IFS=$'\t' read -r run_id created_at; do
  if [[ -z "$run_id" || "$run_id" == "$GITHUB_RUN_ID" ]]; then
    continue
  fi
  artifact_response=""
  if ! artifact_response="$(gh api \
    "repos/${GITHUB_REPOSITORY}/actions/runs/${run_id}/artifacts?per_page=100")"; then
    echo "Ignoring calibration run ${run_id}: artifact listing could not be read."
    continue
  fi
  if ! artifact_id="$(jq -r \
    '[.artifacts[]? | select(.expired == false) |
      select(.name | startswith("release-concurrency-calibration-"))] |
     sort_by(.created_at) | reverse | .[0].id // empty' \
    <<< "$artifact_response")"; then
    echo "Ignoring calibration run ${run_id}: artifact listing is malformed."
    continue
  fi
  if [[ -z "$artifact_id" ]]; then
    echo "Ignoring calibration run ${run_id}: no non-expired calibration artifact."
    continue
  fi

  candidate="$history_root/candidate"
  rm -rf "$candidate"
  mkdir -p "$candidate"
  if ! gh api \
    "repos/${GITHUB_REPOSITORY}/actions/artifacts/${artifact_id}/zip" \
    > "$history_root/candidate.zip"; then
    echo "Ignoring calibration run ${run_id}: artifact download failed."
    continue
  fi
  archive_entries=""
  if ! archive_entries="$(unzip -Z1 "$history_root/candidate.zip")"; then
    echo "Ignoring calibration run ${run_id}: artifact archive is malformed."
    continue
  fi
  if grep -Eq '(^/|(^|/)\.\.(/|$))' <<< "$archive_entries"; then
    echo "Ignoring calibration run ${run_id}: artifact archive has unsafe paths."
    continue
  fi
  if ! unzip -q "$history_root/candidate.zip" -d "$candidate"; then
    echo "Ignoring calibration run ${run_id}: artifact archive is malformed."
    continue
  fi
  report_path="$(find "$candidate" -type f -name release-concurrency-stress.json -print -quit)"
  if [[ -n "$report_path" ]] &&
    jq -e '(.schemaVersion == 1) and (.safe == true) and
      (.setupElapsedMs | numbers) and (.setupElapsedMs >= 0) and
      (.totalElapsedMs | numbers) and (.totalElapsedMs >= 0)' \
      "$report_path" >/dev/null; then
    if [[ "$history_count" -eq 0 ]]; then
      cp "$report_path" "$history_root/release-concurrency-stress.json"
      echo "RELEASE_CONCURRENCY_BASELINE_JSON=$history_root/release-concurrency-stress.json" >> "$GITHUB_ENV"
      echo "Using healthy calibration from workflow run ${run_id} as the single baseline."
    fi
    jq --arg runId "$run_id" --arg createdAt "$created_at" \
      --slurpfile report "$report_path" \
      '. + [{runId: $runId, createdAt: $createdAt, report: $report[0]}]' \
      "$history_file" > "$history_file.tmp"
    mv "$history_file.tmp" "$history_file"
    history_count=$((history_count + 1))
    echo "Accepted healthy calibration history from workflow run ${run_id} (${history_count}/${history_limit})."
    if [[ "$history_count" -ge "$history_limit" ]]; then
      break
    fi
  else
    echo "Ignoring calibration run ${run_id}: report is missing, malformed, or unsafe."
  fi
done <<< "$run_records"

if [[ "$history_count" -eq 0 ]]; then
  echo "No prior healthy calibration artifact found; this run will establish the baseline."
fi
echo "RELEASE_CONCURRENCY_HISTORY_JSON=$history_file" >> "$GITHUB_ENV"
echo "Collected ${history_count} prior healthy calibration artifact(s); history is bounded at ${history_limit}."