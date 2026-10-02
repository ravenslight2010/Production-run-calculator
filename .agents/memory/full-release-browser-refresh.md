---
name: Full release browser refresh
description: Full-mode release evidence depends on the entire current stateful browser contract, not only retained-evaluation validation.
---

The full release evidence folder cannot be considered refreshed when the browser gate fails or remains checkpointed, even if standard-mode retained-evaluation verification passes. Use the shared browser case contract at the current revision, not a count from an older task description.

**Why:** State-dependent browser failures can leave the full report stale while the release runner preserves an incomplete checkpoint; treating the retained inventory as sufficient would produce misleading release evidence.

**How to apply:** Run full mode against a fresh disposable database, keep the generated checkpoint until the browser gate is resolved, and only accept the folder after the runner writes and verifies a current full report with no checkpoint. A local disposable run may skip production reconciliation only under the runner's CI/test-database guard; never invent a deployment revision to bypass published-readiness checks. For a focused `-g` check, override the release-duration reporter with `--reporter=list`; it expects the complete case inventory otherwise.

A passing case in the full Chromium inventory does not replace a failing dedicated browser matrix. For keyboard calendar selection, prove focus reached a different enabled day before Enter and that the selected date changed before checking the popover closed; otherwise a missed activation looks like a close failure.

A workspace restart can interrupt a background full run while leaving checkpoint state but losing its log or checkpoint report. Treat that as incomplete, never as retained evidence. After repeated interruptions, resume only a checkpoint verified against the exact current revision and its completed gate statuses; the browser gate must still start on a fresh disposable database. `E2E_TEST_DB=1` isolates the browser gate, not other database-backed preflights, so give those preflights a disposable database too when the development database is unavailable.

Case-count changes are not coverage evidence by themselves. Compare the removed and added case identities, verify that every moved scenario has a destination lane, and restore deterministic cases that otherwise have no owner before changing the expected count. **Why:** an exact-count guard detects enumeration drift but cannot distinguish a legitimate lane move from an accidental deletion. **How to apply:** diff the previous and current Playwright case lists, record each intentional move and its destination, then set the contract to the adjudicated inventory.

Focused browser runs must disable the full-inventory reporter without bypassing
the isolated server lifecycle. **Why:** a filtered run can correctly fail the
full case-count guard, while a narrow test config that assumes an existing dev
server can fail during fixture setup before any browser assertion runs.
**How to apply:** use the isolated runner with a focused config that starts its
local servers, or another explicit local-server setup; treat the result as
focused evidence only, never as a replacement for the complete contract run.

Playwright's `browserContext.close: ENOENT` for a missing temporary `recording.trace` can mask a case reaching its test timeout; it does not establish that the preceding UI assertion failed. **Why:** a long reload journey exhausted the 60-second budget during a full run, and trace cleanup replaced the useful timeout diagnostic. **How to apply:** compare elapsed time to that case's configured timeout and inspect the trace/case journey before changing product behavior or accepting a screenshot baseline.

In one workspace run, clean-start Chromium navigation exited with Node code 13 while preview workflows were active; standalone and subsequent release reruns passed with those workflows paused. This is an observed correlation, not a proven cause. **Why:** resource contention can resemble an application regression, but the available evidence does not isolate which process interaction caused the failure. **How to apply:** pause existing preview workflows during resource-sensitive clean-start and full-browser release gates when contention is observed. Preserve the original failure classification; only accept the gate after a complete isolated rerun passes.

During a separate clean-start failure, an orphaned Chromium process group from a completed app-preview screenshot was identified; after stopping that specific group, the resumed clean-start passed. **Why:** browser processes can outlive the action that spawned them and exhaust thread resources, making infrastructure failure look like an application defect. **How to apply:** inspect process ancestry when Chromium cannot create threads, stop only the confirmed orphaned preview process group, and accept the gate only after a complete isolated rerun passes.

An emitted per-test pass line does not establish that an isolated Playwright command or its descendants exited. In this workspace, stopping a long shell run has left Playwright and disposable PostgreSQL processes alive, and a later schema push aborted until the confirmed test process group was stopped. **Why:** a wrapper can report or be stopped while child resources still own CPU, ports, and database files, making cleanup status ambiguous. **How to apply:** preserve the sanitized result log; verify process ancestry, listener ownership, and database-process exit after the test; stop only the confirmed test process group; and clean only its exact disposable database after PostgreSQL exits. Never stop or restart a configured API workflow whose database target is unknown.
