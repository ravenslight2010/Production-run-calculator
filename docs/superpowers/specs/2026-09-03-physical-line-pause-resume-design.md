# Physical Line Pause and Resume

## Purpose

Make packaging auto tracking follow the factory's physical line during a pause, a stopped Freeze tunnel, and Resume. A run pause stops the Press; it does not instantly stop every downstream station.

This design supersedes the simplified tunnel-stopped behavior in `2026-08-27-packaging-autotrack-pause-handoff-design.md`.

## Physical Flow

Product moves through these relevant zones:

1. Press and the line before the Freeze tunnel
2. Freeze tunnel
3. Wrapper and Packaging

The Freeze tunnel and Packaging react to a Press pause at different times because product already occupies the downstream zones.

## Decisions

### Pause always stops the Press first

- Press-fed production stops immediately.
- Dough tray, dough batch, and other upstream production auto tracking stops immediately.
- Completed cases and skids continue only when product is physically reaching Packaging.

### Pause with the Freeze tunnel left running

- The Press stops, but the remaining product continues through every downstream zone.
- Completed cases and skids continue increasing until all in-flight product clears Packaging.
- Once the line has drained, packaging auto tracking stops.

### Pause with the Freeze tunnel selected to stop

The tunnel does not stop immediately:

1. The Press stops.
2. The pre-tunnel line continues moving until all pizzas before the tunnel have entered it.
3. The Freeze tunnel then stops while full.
4. Product already beyond the tunnel continues through Wrapper and Packaging.
5. Packaging auto tracking stops only after the Wrapper/Packaging zone empties.
6. Product inside the stopped tunnel remains held and is not counted as completed.

### Resume after the tunnel was left running

Because the line drained during the pause, Resume behaves like a new run:

1. The pre-tunnel line fills.
2. The Freeze tunnel fills.
3. Wrapper and Packaging fill.
4. Completed-case and skid auto tracking starts when the Wrapper/Packaging timer reaches zero.

No packaging catch-up is applied immediately on Resume.

### Resume after the tunnel was stopped

The Freeze tunnel starts this transition full:

1. The Press restarts.
2. The pre-tunnel line fills while the Freeze tunnel remains stopped.
3. When pizzas reach the tunnel entrance, the full Freeze tunnel restarts.
4. A new Freeze-tunnel-fill delay is skipped because that section is already full.
5. Wrapper and Packaging fill.
6. Completed-case and skid auto tracking starts when the Wrapper/Packaging timer reaches zero.

No packaging catch-up is applied immediately on Resume.

### Run Stop

Stopping or ending a run stops the Press and allows the downstream line to drain through Packaging. Existing end-of-run drain behavior remains bounded by the product that was already in flight.

## Architecture

Introduce one pure, phase-aware line-flow calculation as the source of truth for:

- whether the Press, Freeze tunnel, and Packaging are moving;
- which fill, drain, or waiting timer is active;
- whether completed-case auto tracking may advance; and
- which elapsed clock completed-case tracking uses.

The calculation receives the run timestamps, pause policy, configured pre-tunnel, Freeze-tunnel, and Wrapper/Packaging durations, and current wall time. It returns explicit phases rather than a single `packagingDrainActive` boolean.

`LiveRunContext` supplies the phase result to both visible line status and `useAutoTrack`. `useAutoTrack` remains responsible for bounded incremental writes, manual-edit suppression, coordination claims, and conversion between cases and skids.

## Clock and Counter Rules

- Press production uses the normal pause-excluded run clock.
- Downstream movement during Pause uses a pause-relative wall clock.
- Resume starts a fresh fill sequence selected by the prior tunnel policy.
- A stopped, full tunnel preserves that fullness across the pause.
- A tunnel left running is treated as drained on Resume.
- Completed cases never exceed the run target.
- A transition may rebase tracking clocks, but it must not emit an immediate catch-up burst.
- Product counted before or during a pause must not be counted again after Resume.
- Reloads and synchronized peer updates must derive the same phase from persisted run and pause timestamps.

## Error and Edge Handling

- The existing conservative default remains: until the operator chooses otherwise, a pause is treated as requesting a tunnel stop.
- A late, dismissed, or timed-out choice keeps the safe stop policy.
- Invalid timing or production-rate inputs disable automatic advancement rather than inventing output.
- Manual packaging corrections remain authoritative under the existing suppression rules.
- Repeated Pause or Resume actions must not duplicate phase transitions or counter writes.
- If Resume occurs before a drain phase would naturally finish, the phase calculation still rebases without double-counting.

## Verification

Add focused regression coverage for:

1. Pause, choose No: Packaging continues through a full-line drain, then stops.
2. Resume after No: all three startup fill stages run before packaging auto tracking restarts.
3. Pause, choose Yes: the tunnel keeps moving until the pre-tunnel zone empties, then stops full; Packaging continues until the post-tunnel zone empties.
4. Resume after Yes: pre-tunnel fill, full-tunnel restart, and Wrapper/Packaging fill occur; the tunnel-fill stage is skipped.
5. Completed cases and skids do not jump on either Resume path.
6. Dough, tray, and batch counters stop immediately during Pause.
7. End run drains downstream product through Packaging.
8. Reload and peer-sync adoption preserve the same phase and do not replay output.
9. Manual corrections and run-target caps remain authoritative.

Exercise the real pause-dialog policy transition through `LiveRunContext`; tests that inject `packagingDrainActive: true` directly are not sufficient.

Run the focused line-phase and auto-track suites, the state-accuracy checklist, and an operational browser check of both pause choices and both Resume paths.

## Non-Goals

- Changing the physical station order.
- Changing inventory consumption or run-target calculations.
- Adding new operator choices.
- Changing the ten-second pause-policy decision window or its conservative default.
- Treating the Freeze tunnel as warehouse freezer storage.