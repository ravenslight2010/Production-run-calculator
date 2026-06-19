---
name: Inventory consume idempotency & finalization wiring
description: How auto-deduct on run completion stays correct across web+mobile — marker table, transactional consume, and every run-finalization path.
---

# Inventory auto-deduct: idempotency & completion wiring

The "Stock" feature deducts inventory once per completed run via `POST /api/inventory/consume` (keyed by `runId`). Three durable rules keep it correct.

## 1. Run-level idempotency needs a dedicated marker, not a ledger check
**Rule:** Idempotency uses `inventory_consumed_runs` (runId PK), claimed via `insert().onConflictDoNothing({target: runId}).returning()`. The marker is written even when 0 lines are drawn down.
**Why:** A run can legitimately consume 0 (no matching items exist yet). The old "does a consume ledger row exist for this runId?" check wrote nothing for zero-consume runs, so a later restock + re-consume of the same runId would double-deduct. The unique PK + onConflictDoNothing also makes concurrent same-run requests race-safe (only the first inserts and proceeds).
**How to apply:** Never revert to inferring idempotency from ledger rows. Keep the claim atomic.

## 2. Consume (and adjust) must be transactional
**Rule:** The claim insert + per-line `drawDown` + ledger inserts run inside one `db.transaction(tx => …)`; `drawDown(exec, …)` takes a db-or-tx executor. The `adjust` route is likewise wrapped.
**Why:** If the claim commits before drawdown and drawdown then fails mid-loop, the run is permanently marked consumed and can never be retried → missed/partial deduction. Wrapping the claim in the same txn means any failure rolls the claim back, so retry applies exactly once.

## 3. EVERY run-finalization path must call consume
**Rule:** Not just explicit endRun. Web `home.tsx` has TWO additional rollover paths (visibility/poll `checkDateRollover` and the midnight timer) that close active runs on a day change; both loop active runs and call `consumeRun`. Mobile `RunContext.tsx` has its day-rollover archive path (on load, when stored date != today) that calls `consumeRunInventory` per active run. There is also the **auto-stop-on-start** path: `startRun` finalizes any OTHER currently-running run (one active run at a time, web+mobile parity) and must consume each stopped run from its OWN stored values (web `loadRunValues(r.id)`, mobile `r.settings`) — never the current form/run.
**Why:** Those paths set `endedAt`/archive without consuming, so runs ended by rollover were never deducted. Per-runId idempotency (rule 1) makes it safe to call consume from multiple finalization paths without double-counting.
**How to apply:** When adding any new way a run can end/close/archive, wire consume into it too. In web `[]`-dep rollover effects, read `currentRunIdRef.current` (a render-updated ref), NOT the captured `currentRunId`, when choosing `form.getValues()` vs `loadRunValues(r.id)` — the bare value goes stale on run switch. `form` (react-hook-form) is stable. Mobile consumes from each run's own `r.settings` (no closure issue).

## Item-key parity
Keys are quantity-independent stable identities shared by both apps via the same backend. computeRunLines must produce byte-identical keys on web and mobile: e.g. pepperoni type must be `.trim()`-ed before building the key AND before `DEFAULT_PEP_TYPES` std-vs-batch classification on BOTH platforms, or stray whitespace diverges keys/units.
