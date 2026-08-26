# Live Gemini failure alert design

## Goal

Notify the existing Slack operational channel when the live Gemini
skill-trigger benchmark starts a failure streak, while keeping one-off provider
outages quiet and leaving the offline benchmark gate unchanged.

## Approach

The `gemini-live-benchmark` job will:

1. Continue to run the credentialed benchmark and upload its three retained
   artifacts on every outcome.
2. On a benchmark-step failure, query recent runs of the same workflow through
   the read-only GitHub Actions API.
3. Inspect the `Live Gemini skill-trigger benchmark` job in those runs, count
   the consecutive failures immediately before the current failed run, and
   stop at the first successful or non-failed run.
4. Send Slack only when the current run reaches the configured threshold
   (default: two consecutive failures). This creates one alert per failure
   streak rather than one alert per failed run.
5. Link to the failed workflow run and its `#artifacts` section, where the
   retained results, report, and review queue can be opened.

The workflow will grant the job `actions: read` and `contents: read`
permissions. GitHub API or Slack delivery problems will be logged and will not
change the benchmark's result.

## Configuration

`GEMINI_FAILURE_ALERT_THRESHOLD` is an optional repository Actions variable.
It must be an integer of at least two; otherwise the workflow skips the alert
instead of risking noisy notifications. `SLACK_WEBHOOK_URL` remains the
existing optional Actions secret. If it is unset, the benchmark continues
without notification.

## Success criteria

- A first failed Gemini run does not notify.
- The second consecutive failed Gemini run notifies the existing Slack
  channel once with links to the run and retained artifacts.
- Additional failures in the same streak do not duplicate the alert.
- A later failure after a successful Gemini run starts a new streak.
- Offline `test:gemini` and the existing benchmark behavior are unchanged.
