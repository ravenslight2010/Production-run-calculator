# Home-screen performance at production scale

## Goal

Keep the calculator responsive during a live run and on large production days
by measuring the expensive paths and avoiding work that does not depend on the
current screen or live clock.

## Design

- The privacy-safe performance ring records load, tab navigation, render,
  calculation, storage, and API timings. It records no form values, names,
  URLs with query strings, or payloads.
- The live calculation records its duration inside the existing
  `LiveRunProvider`, where the one-second clock already belongs. Home renders
  record commit duration and sample Chromium heap usage once per minute while
  mounted.
- Home builds persisted run values once per day-state/storage revision, then
  overlays the active form values without re-reading every other run while the
  operator types. Summary statistics and warehouse/inventory inputs are derived
  from that snapshot.
- Existing narrow contexts remain the subscription boundary: only live
  production surfaces use the per-second context; warehouse, inventory, and
  other non-live screens use memoized snapshots.

## Budgets and evidence

The browser budgets are 1,500 ms for initial load, 250 ms for tab/render
transitions, 16 ms for a live calculation, 100 ms for a storage scan, and
1,000 ms for an API request. A deterministic large-day test exercises 250 runs
and asserts snapshot construction and summary derivation remain within the
production-scale budget.