# Full-Mode Browser Regression Fixes

**Date:** 2026-09-24
**Status:** Approved; implementation in progress

## Problem

Task 2339 cannot produce complete full-mode release evidence because four
browser cases fail in a fresh disposable-database run:

1. Saving a manager setup succeeds, but a later run-refresh toast replaces the
   “Saved setup” acknowledgement.
2. On a 375×812 phone viewport, the schedule-date calendar is visually under
   its dialog and the dialog's scroll area intercepts day clicks.
3. After a manual case-count correction and stale whole-run write, the
   Packaging tab retains the corrected count, but the Run summary can continue
   displaying the prior confirmed server calculation. The independent
   packaging register and persisted run values are correct; the stale
   operational calculation receipt keeps the two client surfaces out of sync.
4. The tablet visual test captures a pending run, while its checked-in snapshot
   depicts a started run.

The original manager-queue and Mix Plan suites pass. The visual mismatch is a
fixture-state mismatch, not a reason to accept a different screenshot.

## Goals and boundaries

- Fix the behavior or deterministic test setup at the layer that owns it.
- Preserve the existing recipe-picker contract, sync/server acceptance rules,
  phone keyboard behavior, and started-run screenshot state.
- Generate retained release evidence only through the full release runner.
- Use disposable test data for browser verification.

Do not weaken assertions, extend timeouts to hide failures, force clicks,
regenerate the tablet snapshot to match a pending run, change server acceptance
based on client timestamps, or alter production data. Production source-library
reconciliation remains separate evidence; a development/test run cannot replace
it or establish a production GO decision.

## Approaches considered

### Recommended: focused owner-layer fixes

Correct acknowledgement ordering, the schedule dialog's local popover stacking,
the client's adoption of canonical packaging progress, and the tablet test's
missing lifecycle setup. This preserves existing contracts and limits changes
to the causes demonstrated by the failures.

### Alternative: relax browser assertions or snapshot a pending run

This is faster but would hide a real acknowledgement race, a blocked phone
control, a stale counter display, and a lifecycle-state mismatch. Rejected.
The existing tablet image does depict a started run, but its header also shows
the impossible combination “Synchronized 1” that the current sync contract
cannot produce. Refresh only the affected snapshots after the fixture asserts a
started run and a synchronized, drained header; do not replace them with a
pending-run capture.

### Alternative: broad shared-system refactors

Replace the global toast model, change all dialog/popover stacking, or redesign
the sync protocol. Those changes are not required by the evidence and would
increase regression risk. Rejected.

## Proposed design

### Manager setup acknowledgement

Keep the server-acknowledged save as the success boundary. After the save is
acknowledged, await the existing `onSaved` propagation callback and then show
the “Saved setup” acknowledgement so the callback's later ordinary toast cannot
replace it.

Separate server-save errors from post-save propagation errors. If the server
has acknowledged the profile but propagation fails, do not claim that the setup
was unsaved; report that the setup was saved but the follow-on run refresh did
not complete. An unchanged save keeps its existing message and does not fan out.

### Phone schedule calendar

Raise only the schedule-date `PopoverContent` above the schedule dialog by
setting its local stacking level above the dialog overlay. Leave the shared
popover defaults and the dialog's scrollable layout unchanged. This keeps
keyboard selection and existing hit targets intact.

### Operational calculation after packaging corrections

The manual correction and register already retain the correct case count. The
remaining defect is that `LiveRunContext` can keep using a previously confirmed
server calculation whose receipt predates the correction. Invalidate that
run's operational calculation receipt immediately after a local manual
packaging write, and when an inbound packaging register wins for the selected
run. This makes the Run summary fall back to the corrected form values until a
fresh server projection arrives. Keep the monotonic projection watermark so a
late older frame cannot restore the stale calculation. Preserve server
acceptance and LWW behavior; do not infer that a write is automatic from a
client-provided timestamp.

### Tablet visual fixture

Explicitly start the tablet run and wait for the visible running-state control
before capturing portrait and landscape screenshots. Also wait for the
confirmed operational baseline and synchronized, drained sync status. Keep the
started-run composition and refresh only the stale header snapshot after those
fixture assertions pass; this prevents the baseline from asserting an impossible
pending-write badge.

## Error handling and data flow

- A rejected server save remains a failed save and must not run `onSaved`.
- A successful server save remains acknowledged even if later run propagation
  fails; the user-facing message must distinguish those outcomes.
- Phone date selection remains an ordinary accessible calendar interaction;
  no forced clicks or pointer-event suppression.
- The server remains the authority for accepted packaging progress. Both the
  Packaging controls and Run summary must reflect the corrected counters; a
  cached server calculation is usable again only after a fresh projection.
- Visual setup must establish and assert its lifecycle state before capture.

## Validation

1. Add or extend component coverage for save acknowledgement ordering and the
   distinct server-save versus propagation-failure outcomes.
2. Re-run the four focused browser cases on a fresh disposable database.
3. Run the focused client sync/state-accuracy tests relevant to packaging
   progress adoption, plus the manager-queue and Mix Plan suites.
4. Run `pnpm run release:check:full` on a fresh disposable database and require
   every configured full-mode gate to pass.
5. Let the release runner produce the retained report, then verify the full
   evidence folder has both retained evaluations, the current revision, and no
   checkpoint or checkpoint report.

No retained release report, checkpoint, or browser snapshot is to be edited by
hand.