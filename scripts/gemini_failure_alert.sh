#!/usr/bin/env bash
set -euo pipefail

threshold="${GEMINI_FAILURE_ALERT_THRESHOLD:-2}"
if ! [[ "$threshold" =~ ^[2-9][0-9]*$ ]]; then
  echo "::warning::GEMINI_FAILURE_ALERT_THRESHOLD must be an integer >= 2; skipping alert."
  exit 0
fi

if [[ -z "${SLACK_WEBHOOK_URL:-}" ]]; then
  echo "SLACK_WEBHOOK_URL is not configured; skipping alert."
  exit 0
fi

run_url="${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
artifact_url="${run_url}#artifacts"
workflow_runs_url="repos/${GITHUB_REPOSITORY}/actions/workflows/nightly-large-spec.yml/runs?per_page=20&exclude_pull_requests=true"

if ! workflow_runs="$(gh api "$workflow_runs_url")"; then
  echo "::warning::Unable to inspect prior Gemini workflow runs; skipping alert."
  exit 0
fi

mapfile -t prior_run_ids < <(
  jq -r --arg current "$GITHUB_RUN_ID" \
    '.workflow_runs[]
     | select(.status == "completed")
     | select((.id | tostring) != $current)
     | .id' <<<"$workflow_runs"
)

failure_streak=1
for prior_run_id in "${prior_run_ids[@]}"; do
  if ! job_conclusion="$(
    gh api "repos/${GITHUB_REPOSITORY}/actions/runs/${prior_run_id}/jobs?per_page=100" \
      --jq '.jobs[]
        | select(.name == "Live Gemini skill-trigger benchmark")
        | .conclusion'
  )"; then
    echo "::warning::Unable to inspect run ${prior_run_id}; skipping alert."
    exit 0
  fi

  if [[ "$job_conclusion" == "failure" ]]; then
    failure_streak=$((failure_streak + 1))
  else
    break
  fi
done

if (( failure_streak != threshold )); then
  echo "Gemini failure streak is ${failure_streak}; alert threshold is ${threshold}."
  exit 0
fi

jq -n \
  --arg text ":rotating_light: Live Gemini skill-trigger benchmark has failed ${failure_streak} consecutive run(s). <${run_url}|Open failed workflow run> · <${artifact_url}|Open retained artifacts>" \
  '{text: $text}' |
  curl --fail-with-body --silent --show-error \
    -X POST \
    -H 'Content-Type: application/json' \
    --data @- \
    "$SLACK_WEBHOOK_URL"