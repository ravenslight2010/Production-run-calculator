# Screen-off/wake section correction snapshots

**Date:** 2026-09-24  
**Status:** Approved design; implementation pending

## Context

The latest isolated screen-off/wake run passed 9 of 15 focused cases. It exposed
three related correction failures: rapid Packaging decrements settled above the
requested count, Dough field edits appeared in the form but were not fully
acknowledged by the server, and two occupancy tests displayed the server's
live projection instead of the deterministic projection installed by the
fixture.

The manual section lock already permits repeated claims by the same owner.
Changing or weakening that lock is not part of this fix. The client must keep
the server's complete-baseline conflict check; a real peer conflict remains
distinct from sequential edits by the same operator.

## Design

Every local manual correction will be represented as an immutable transition
between complete section snapshots:

- `before` contains every field in the protected section immediately before the
  user action.
- `after` contains every section field immediately after that action.
- A partial control edit changes only its target field in `after`; unchanged
  fields are copied from `before`.
- The serialized outbox computes the action delta from these complete
  snapshots and rebases queued same-device actions on the previous server
  acknowledgement while the chain is active. Missing fields must never be
  interpreted as zero.

The Packaging control adapter already owns the exact in-memory counts before
each click. It will pass those counts to the persistence callback, and the
Packaging producer will use them instead of rereading a run-value store that
may lag an optimistic click. Existing two-argument adapter callbacks remain
compatible.

Dough controls may continue to submit a one-field edit to the server API, but
the client correction queue will construct a complete `after` snapshot from
the exact complete pre-edit section snapshot. This prevents an unchanged tray
or batch counter from being treated as an implicit zero or as a repeated
delta.

Other section producers that already provide complete snapshots remain
unchanged. The server route and its complete-baseline validation are not
changed. Same-owner lock behavior, peer lock behavior, and the API's 409
conflict handling remain intact.

## Projection fixture

The occupancy tests will install their deterministic operational projection
across the read-model paths that can update the page, including the sync
response and the server-sent-event path. The fixture may replace only the
operational projection; it must not mock or rewrite canonical sync state.
Production projection calculation is out of scope.

## Verification

1. Add unit coverage proving that twelve consecutive Packaging decrements each
   use the preceding in-memory pair and produce twelve one-case transitions.
2. Add correction-queue coverage for sequential Dough edits, including that a
   partial edit preserves the other section field.
3. Keep coverage that a different peer owner remains locked and that stale
   server baselines still produce a conflict.
4. Rerun the 15-case focused screen-off/wake suite, then the fresh full
   170-case browser contract.
5. Create development-only full-mode evidence only through an explicitly
   supported checker path. Do not publish, invent deployment metadata, or
   change readiness/deployed fields from N/A. If the checker has no supported
   development-only path, leave that gate blocked and report the limitation.

No click delays, weakened assertions, API contract changes, or production
readiness-gate relaxations are included.