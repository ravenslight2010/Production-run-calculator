# Applicator Stock On Hand

## Goal

Replace the editable Frontline applicator “batches made” ticker with physical
on-hand stock in pounds. Keep calculated demand, old cumulative-made values,
and the Sauce, Dough, Packaging, and Warehouse behaviors separate and
unchanged.

## State and capacity

Store new on-hand stock in run-scoped values, independent of the existing
`appNBatchesMade` and its historical correction fields. Use a register for
each App 1–4 slot and each configured Pepperoni type on Pep 1/2, including
secondary B types. Stock is measured and displayed in pounds.

- Cheese and other App slots: capacity is two configured batch weights.
- Mix App slots: capacity is 100 lb (two 50 lb batches).
- Each configured Pep type: capacity is 50 lb (one 50 lb batch).
- Empty or unconfigured slots start at zero. A configured slot with no usable
  weight or consumption rate may retain stock, but cannot auto-deplete until
  its rate inputs are valid.

Initialize the run’s configured stock exactly once at its authoritative
transition to started. Persist an initialization marker so an intentional zero
or a later refill is not mistaken for uninitialized stock. Pause, resume,
reload, run switching, and wake preserve the same run’s registers. A new run
gets its own marker and registers.

## Consumption and operator changes

While a run is running, compute fractional pound consumption from that slot’s
per-pizza usage, the active line speed, and elapsed net production time. Use
the same effective batch-weight inputs that define configured capacity where
applicable; Mix and Pepperoni use their fixed 100 lb and 50 lb limits.
Consumption clamps at zero. Pending, paused, and ended runs do not deplete.

Automatic stock claims are run- and slot-scoped, compare against a complete
canonical baseline, and are idempotent. Corrections and refills set the new
on-hand pounds within capacity, rebase the elapsed-time anchor, and advance a
correction generation. A competing stale claim must conflict rather than
overwrite the correction. After wake or reload, adopt canonical stock before
issuing another claim.

The tracker does not reinterpret or overwrite historical cumulative-made
values. New depletion claims use dedicated stock fields and claim identities.
Manual edits use the existing authorized, run-scoped correction path and its
conflict handling.

## Operator display

Keep the “Batches Needed” panel as calculated demand only. Show adjustable
App and configured Pep stock in a separate “Applicator Stock On Hand” ticker,
with pounds and slot/type labels. Remove the made-count controls from demand
rows; do not display the same on-hand value in both panels. Preserve existing
recipe details and leave calculated demand formulas untouched.

## Verification

Add focused coverage for capacities, one-time full initialization, fractional
depletion, manual set/load/refill and correction-generation conflicts, zero
stock, paused/resumed and ended runs, run switches, reload/wake adoption, and
concurrent claims. Run the state-accuracy and sync-invariant suites, relevant
client/API tests, and the project’s configured type and release checks as
appropriate.
