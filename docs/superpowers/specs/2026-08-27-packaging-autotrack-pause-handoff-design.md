# Packaging Auto-Track Pause Handoff

## Purpose

Restore packaging auto tracking after a paused production run resumes. When a pause allows product already in the line to keep moving through the tunnel, packaging must account for that output and then continue normal tracking immediately after Resume.

## Current Failure

Packaging progress during a continued-tunnel pause uses elapsed time since the pause began. On Resume, ordinary packaging tracking switches back to the run's net production clock. That clock is lower than the pause-relative value, so the incremental counter sees no positive progress until ordinary elapsed time eventually catches up. The result is a packaging counter that appears frozen after Resume.

## Decision

Use a stage-aware clock handoff.

- Packaging auto tracking remains active during a pause only when the operator selected that the tunnel continues and product is still moving through the packaging stage.
- On Resume, capture the output accumulated since the last packaging update during that pause.
- Apply that increment once through the existing automatic packaging-progress path.
- Re-baseline the normal packaging clock at the resumed run-clock value and schedule the next ordinary update from a full case interval.

This preserves real output that occurred during the pause while preventing the paused interval from being applied twice.

## Behavior

### Continued-tunnel pause

1. The pause policy marks the tunnel as continuing.
2. The packaging-stage clock advances while product can still reach packaging.
3. Packaging auto tracking advances incrementally, is capped at the run target, and continues to use the established sync-backed packaging register.
4. Dough tray and batch tracking remains stopped during this packaging-only phase.

### Resume handoff

1. Resume detects that the previous state was an active packaging drain.
2. It derives any remaining case increment from the pause-relative packaging clock.
3. It writes that increment only when the packaging register accepts an automatic update.
4. It then resets the case-progress baseline to the resumed normal production-clock value and re-arms the next case update from the full configured cadence.
5. Subsequent packaging updates use normal run elapsed time immediately; they do not wait for normal elapsed time to overtake pause duration.

### Tunnel-stopped pause

A pause that stops the tunnel does not create packaging output. Resume starts ordinary packaging tracking from a fresh normal-clock baseline without fabricating cases from paused time.

### Manual corrections

The existing manual packaging override is authoritative. If a manager corrected packaging progress during the pause, automatic catch-up must not overwrite it. The hook must still re-baseline and resume normal scheduling so tracking does not remain stalled after the override expires.

### Limits and persistence

- Packaging remains incremental and cannot exceed the run's case target.
- Existing skid/case conversion and case-per-skid guards remain unchanged.
- Accepted automatic updates continue to use the existing per-run packaging register, so the result reaches other devices through the established sync path.
- Resume must not produce a case write in the same render except for the explicitly reconciled, previously uncounted packaging output.

## Error and Edge Handling

- A reload or peer sync that opens during a continued-tunnel pause first establishes a baseline; it must not replay older output.
- Repeated Resume actions must be idempotent: only the first transition can reconcile the pause interval.
- If packaging configuration is invalid or the run has no valid rate, the transition re-baselines safely without writing.
- If the run target has already been met, no automatic catch-up may exceed it.
- Foreground-sync barriers and current manual-suppression rules remain in force.

## Verification

Add focused tests for:

1. Continued-tunnel pause followed by Resume: paused output is counted, normal updates continue after one ordinary case interval, and no output is duplicated.
2. Continued-tunnel pause resumed before the next scheduled update: the remaining paused interval is reconciled once.
3. Tunnel-stopped pause followed by Resume: no paused interval is counted.
4. Manual correction during a continued-tunnel pause: automatic catch-up is rejected while the override is active, but post-resume scheduling is healthy.
5. Reload or sync adoption during the pause: the new client establishes a baseline without backfilling output.
6. Run-target cap and dough-counter invariants across the handoff.

Run the existing live-state accuracy checks and the focused auto-track pause/resume and packaging-drain suites after implementation.

## Non-Goals

- Changing the pause-policy user interface or its safe default.
- Counting packaging during a pause where the tunnel is stopped.
- Changing dough, sauce, freezer, reset, LWW, or sync conflict semantics.
- Replacing the existing packaging-progress register.