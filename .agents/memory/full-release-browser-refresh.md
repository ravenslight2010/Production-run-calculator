---
name: Full release browser refresh
description: Full-mode release evidence depends on the entire current stateful browser contract, not only retained-evaluation validation.
---

The full release evidence folder cannot be considered refreshed when the browser gate fails or remains checkpointed, even if standard-mode retained-evaluation verification passes. Use the shared browser case contract at the current revision, not a count from an older task description.

**Why:** State-dependent browser failures can leave the full report stale while the release runner preserves an incomplete checkpoint; treating the retained inventory as sufficient would produce misleading release evidence.

**How to apply:** Run full mode against a fresh disposable database, keep the generated checkpoint until the browser gate is resolved, and only accept the folder after the runner writes and verifies a current full report with no checkpoint. A local disposable run may skip production reconciliation only under the runner's CI/test-database guard; never invent a deployment revision to bypass published-readiness checks. For a focused `-g` check, override the release-duration reporter with `--reporter=list`; it expects the complete case inventory otherwise.

A passing case in the full Chromium inventory does not replace a failing dedicated browser matrix. For keyboard calendar selection, prove focus reached a different enabled day before Enter and that the selected date changed before checking the popover closed; otherwise a missed activation looks like a close failure.

A workspace restart can interrupt a background full run while leaving checkpoint state but losing its log or checkpoint report. Treat that as incomplete, never as retained evidence. After repeated interruptions, resume only a checkpoint verified against the exact current revision and its completed gate statuses; the browser gate must still start on a fresh disposable database. `E2E_TEST_DB=1` isolates the browser gate, not other database-backed preflights, so give those preflights a disposable database too when the development database is unavailable.

Playwright's `browserContext.close: ENOENT` for a missing temporary `recording.trace` can mask a case reaching its test timeout; it does not establish that the preceding UI assertion failed. **Why:** a long reload journey exhausted the 60-second budget during a full run, and trace cleanup replaced the useful timeout diagnostic. **How to apply:** compare elapsed time to that case's configured timeout and inspect the trace/case journey before changing product behavior or accepting a screenshot baseline.
