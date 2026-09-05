# Gemini skill-trigger benchmark

- Provider: **gemini**
- Model: **gemini-2.5-flash**
- Run at: **2026-09-03T14:25:20.586419+00:00**
- Scope: Gemini classification only; this is not evidence of Claude behavior or Claude tool selection.

## Metrics

- Evaluated: **102**; excluded: **10**
- Accuracy: **0.922**
- Precision: **0.871**
- Recall: **1.000**
- False-positive rate: **0.167**
- False-negative rate: **0.000**

Excluded cases are not treated as do-not-trigger decisions. See the manual-review queue for provider failures, invalid or uncertain responses, and disagreements.

## Credentialed scheduled check

The nightly large-spec workflow also runs a live Gemini check at 03:00 UTC and
supports `workflow_dispatch`. It supplies
`AI_INTEGRATIONS_GEMINI_API_KEY` and `AI_INTEGRATIONS_GEMINI_BASE_URL` from
repository Actions secrets, then invokes:

```sh
python scripts/gemini_skill_trigger_benchmark.py \
  --fail-on-provider-error \
  --results gemini-live-results.json \
  --report gemini-live-report.md \
  --queue gemini-live-review-queue.json
```

The strict flag is intentionally opt-in: the normal benchmark and
`test:gemini` remain offline-safe. In the scheduled check, missing credentials,
request failures, and invalid structured output fail the job after all three
artifacts have been written. The workflow retains those artifacts for 14 days,
including failed runs, so provider incidents can be reviewed.

Repeated live failures notify the existing Slack operational channel. The
workflow checks the Gemini benchmark job in recent runs (rather than the
overall workflow, so unrelated large-spec failures do not count) and sends one
notification when a streak reaches two failures. Later failures in the same
streak do not duplicate the alert; a successful Gemini run resets the streak.
The notification links to the failed workflow run and directly to its retained
artifacts section. Set the optional repository Actions variable
`GEMINI_FAILURE_ALERT_THRESHOLD` to an integer of at least `2` to change the
streak length. Without `SLACK_WEBHOOK_URL`, the check remains notification-free
and the benchmark result is unchanged.

Before the live benchmark starts, the workflow runs an offline alert-policy
fixture using fake GitHub and Slack commands. It verifies that the first
failure is silent, the configured threshold sends exactly one request with
both operator links, later failures in the same streak remain silent, and a
successful run resets the streak. Run the same check locally with:

```sh
python scripts/test_gemini_failure_alert.py
```

## Manual review

The queue is intentionally read-only input for review. List unresolved cases
with:

```sh
python scripts/gemini_skill_trigger_benchmark.py review \
  list
```

Record a manual decision and its reason in the separate
`gemini-skill-trigger-manual-decisions.json` artifact:

```sh
python scripts/gemini_skill_trigger_benchmark.py review \
  decide \
  --id customer-import-audit-near-miss-1 \
  --decision do_not_trigger \
  --reason "This is a post-import data audit, not an import-pipeline change."
```

Use `--queue` and `--decisions` to work with alternate artifact paths. Manual
decisions are never read by the benchmark evaluator and therefore never
change Gemini metrics. Re-running the benchmark refreshes only the Gemini
results, report, and review queue; the separate decisions artifact remains
untouched.
