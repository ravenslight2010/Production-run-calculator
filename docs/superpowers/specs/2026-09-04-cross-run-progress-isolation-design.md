# Cross-Run Progress Isolation

## Problem

When one production run is active, selecting a different unstarted run can render
the selected run's identity and status alongside the active run's live form
values. This produces impossible combinations such as “Not started” with a
completed-case total above the selected run's target.

## Required behavior

Every progress surface must display values attributed to the selected run.
An unstarted run normally displays zero completed cases and its full target
remaining, even while another run is active.

## Design

Treat the selected run ID and the form-attribution run ID as an atomic rendering
boundary:

- When they match, live calculations may render normally.
- When they differ during a run switch or hydration handoff, completion surfaces
  use the selected run's stored, default-merged values rather than the stale live
  form.
- Apply the same rule to the main Completion tile and the compact run header.
- Do not alter auto-tracking, autosave, synchronization, or active-run timing.

The attribution check should be centralized in a small pure helper so both
surfaces use one contract and regression tests can exercise the handoff without
depending on timing.

## Error and transition handling

The fallback must fail closed: if selected-run values are unavailable during the
handoff, show zero progress rather than another run's counters. Once the form is
attributed to the selected run, live rendering resumes without an extra user
action.

## Verification

Add regression coverage for:

1. Active run A has completed cases.
2. Pending run B has its own target and zero saved progress.
3. Selection changes to B while the form still contains A.
4. Both Completion and the compact header show B's zero progress and full
   remaining target.
5. Normal same-run live progress remains unchanged.

Run the focused regression tests, run-calculator typecheck, and the applicable
state-accuracy checks.