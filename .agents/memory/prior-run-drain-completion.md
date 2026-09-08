---
name: Prior-run drain completion
description: Manual completion in the prior-run freezer-drain panel must preserve cases already moved onto the next skid.
---

The prior-run drain panel has different completion semantics from the active-run
packaging controls: a manual skid completion adds one completed skid without
resetting the current-skid case count. Those cases may have arrived
automatically from the freezer immediately before the operator taps completion.

**Why:** Resetting the current-skid count made a 10-case skid completion replace
an automatic partial total such as 2 with 10, losing the cases already recorded
and producing a visible counter mismatch after the next run started.

**How to apply:** Keep the drain action scoped to the ended run ID and preserve
its current-skid count; do not generalize this behavior to the active-run
packaging control, whose full-skid action intentionally resets its current skid.