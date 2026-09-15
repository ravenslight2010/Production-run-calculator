# Mix Surplus Ledger (Approach A)

## Context

Backlog §1 (Mix Plan & Prep Mix Inventory) needs a traceable, auditable surplus
system so leftover mix in the freezer is known, remindable, and allocatable to
future runs — and so every pound is accountable for QC/traceability.

The first half already exists in `main` (Replit PR #40, commit `b6cd9f3d`):

- `POST /inventory/consume-day-start` deducts fresh mix component ingredients
  at day-start, plus daily supplies (Feature E7: tape/glue/ink). Idempotent via
  `inventoryConsumedRunsTable` (`runId = "day-start:{date}"`).
- Feature B2 carry-forward: when `actualMade` > fresh need, the excess is added
  to the mix row's `amountAlreadyMade`, so the next make-day plan
  (`remainingLbs = max(0, totalLbs - amountAlreadyMade)`) automatically makes
  less. `amountActualMade` (`n`) is editable per mix ("Made today" input).
- `buildMixPlan` (shared `@workspace/mixes`) and the server mix-plan snapshot
  (`GET /inventory/mix-plan-snapshot`) already power the Mixes tab.

What is **missing** is the audit/traceability half (backlog build order steps
2–5): a dated surplus ledger, a "X lbs of mix in the freezer" reminder, and
manager confirm/override allocations. Today the carry is a silent scalar update
on the mix row — no production date, no per-run allocation, no audit trail.

## Goal

Add a server-authoritative mix surplus ledger that:

1. Records every over-production of mix at its source (the day-start
   consumption moment) as a dated lot: mix, brand/flavor, production date,
   amount made, amount remaining, location (freezer).
2. Lets managers see current freezer mix stock per mix ("15 lbs of Bobo's
   Veggie Mix in the freezer, made 2026-09-14").
3. Lets managers allocate a lot to an upcoming run (confirm) or release/void it
   (override). Allocations are dated, audit-trail rows.
4. Survives the daily data wipe (rows live in their own relational tables, not
   the per-day sync payload — same guarantee as `freezer_surplus_lots`).

The plan math stays as-is: `amountAlreadyMade` is already the reducer that
auto-applies freezer stock to the next run. The ledger is its traceable,
auditable image — never a second, separate deduction (no double-count).

## Changes

### 1. Schema — `lib/db/src/schema/mixSurplus.ts` (new)

Mirror the `freezer_surplus` pattern exactly (additive tables, `(id, scope)`
unique index, `scope` default `"live"`, push-force-safe):

- `mixSurplusLotsTable` (`mix_surplus_lots`): `id`, `scope`, `mixId`, `name`
  (denormalized snapshot for stable history display), `brand`, `flavor`,
  `isPrep`, `productionDate` (text), `amountMade` (real, lbs), `amountUsed`
  (real, lbs), `amountRemaining` (real, lbs), `location` (text, default
  `"freezer"`), `createdAt`, `updatedAt`. Unique index `(id, scope)`.
- `mixSurplusAllocationsTable` (`mix_surplus_allocations`): `id`, `scope`,
  `lotId`, `mixId`, `runId` (text, default `""` — the day-state run id when the
  matching run is materialized, else empty), `runDate` (text — the make-day the
  surplus is reserved for), `brand`, `flavor`, `isPrep`, `amount` (real, lbs),
  `createdAt`, `updatedAt`. Unique indexes `(id, scope)` and
  `(lotId, runDate, scope)` — one allocation row per lot + make-day (the mix
  plan is make-day-keyed: `MixPlanGroup.date`, and future runs are resolved
  from `dailySyncTable`, not day-state run ids).
- Export both from `lib/db/src/schema/index.ts`.

### 2. Recording at the source — `artifacts/api-server/src/routes/inventory.ts`

In `POST /inventory/consume-day-start`, beside the existing B2 scalar
carry-forward (`mixesToUpdate`), when `surplus > 0` also insert/extend a
`mix_surplus_lots` row for that mix + production date:

- Same lot is extended when another run on the same date produces more surplus
  for the same mix (amountMade += n, amountRemaining += n) instead of creating
  a duplicate lot; otherwise a new dated lot is created.
- The scalar `mixesTable.amountAlreadyMade` update stays untouched — the plan
  math is unchanged.

### 3. API — `artifacts/api-server/src/routes/mixSurplus.ts` (new)

Mirror `freezerSurplus.ts` handler + zod patterns:

- `GET /mix-surplus` — ledger: `{ lots, allocations, balances }` where
  `balances` is `{ mixId, lbs, productionDates }` per mix with remaining > 0
  (the "freezer stock" reminder data).
- `POST /mix-surplus` (capability `manage-inventory`) — manually record a
  surplus lot (manager found/confirmed stock), creates the lot at
  `location = "freezer"`.
- `PUT /mix-surplus/allocations/:runDate` (capability `manage-inventory`) —
  replace allocations for a make-day: validates the date and each selected
  lot's product, decrements lot `amountRemaining`, upserts allocation rows
  (unique per lot + date), zeroed amounts release/void allocations.
- **Release/void keeps the scalar reducer in sync**: voiding a lot also
  decrements that mix's `mixesTable.amountAlreadyMade` by the released amount,
  so the plan's `remainingLbs` stops counting disposed surplus (ledger ==
  scalar invariant).
- Mount in `artifacts/api-server/src/routes/index.ts` + capability audit list.

### 4. API contract + codegen

- `lib/api-spec/openapi.yaml` — add the three endpoints + `MixSurplusLot`,
  `MixSurplusAllocation`, `MixSurplusLedger`, `MixSurplusBalance` schemas.
- Regenerate checked-in clients with `pnpm --filter @workspace/api-spec run
  codegen` (never hand-edit generated output).

### 5. Web — `artifacts/run-calculator`

- New `mixSurplusClient.ts` — typed fetch wrappers + defensive
  `parseMixSurplusLedger` (mirror the freezer-surplus client parse pattern,
  tolerating unknown/partial server shapes offline/older servers).
- `MixesTabContent.tsx` — per-mix "Freezer stock" strip under each mix card
  when `balances[mixId] > 0`: "15 lbs of {name} in the freezer (made
  {date})" + "Use on next run" (allocate to the selected make-day
  `ctx.mixMakeDay`) and "Release" (void — server zeroes the lot and decrements
  `amountAlreadyMade`). Allocation history + remaining balance per lot shown
  in a small read-only section.
- Default-capability concerns: allocation/void is manager-gated by the server;
  the UI hides the buttons when the capability isn't granted (follow the
  existing capability-gate pattern in MixesTabContent).

### 6. Correctness check on the existing deduction (no double-count)

Audit + focused test that consuming surplus mix never re-deducts ingredients:

- Ingredients are deducted once, when the mix was made (day-start).
- Using leftover mix later reduces only the *fresh make amount*
  (`amountAlreadyMade` reducer) — no second draw-down.
- Also validate the B2 consumption basis: when `actualMade` is entered, the
  fresh basis should be `actualMade` (what they actually made), not
  `max(totalLbs, actualMade)`; when blank, `remainingLbs` (assume needed —
  existing convention). If the current `Math.max(totalLbs, actualMade)` is
  confirmed wrong for under-production entries, fix it in this slice with a
  regression test (see Open Decisions).

## Safety

- Additive tables + additive endpoint only; `push-force` safe, no data
  destruction.
- Server-authoritative amounts; client only displays and sends confirm/override
  allocations.
- Allocation is a ledger action, NOT a consumption action — never writes
  inventory, never re-deducts (no double-count with day-start).
- Ledger rows survive the daily data wipe: separate relational tables, excluded
  from the per-day sync payload/day-state reset.
- Offline/older-server: the Mixes tab renders without the strip (no crash), and
  re-fetches when online (same pattern as mix-plan snapshot).

## Tests

- `lib/db` typecheck + `pnpm run push-force` on dev DB (schema applies).
- `mixSurplus.integration.test.ts` — CRUD + allocation flows (create lot,
  allocate decrements remaining, zero/void releases, one row per lot+run,
  scope isolation).
- `inventory.ts` day-start test — surplus lot recorded when `actualMade` >
  remaining; lot extended on second same-date run; scalar carry unchanged;
  zero-surplus days create no lots.
- Web unit tests — ledger parse tolerates unknown shapes; balances render per
  mix; allocation/void buttons only when capable; no regression on existing
  MixesTab suites.
- No-double-count test — day-start + allocation sequence deducts each pound
  exactly once.
- Full regression: `pnpm --filter @workspace/run-calculator exec vitest run`
  focused sets, api-server suites, root typecheck (`CI=true pnpm run
  typecheck`).

## Out of scope

- Mix surplus in mobile (mobile not in use).
- Freezer reminder *notifications* (proactive alerts / push) — the in-tab
  reminder strip is this slice; push notifications stay a future idea.
- Replacing the `amountAlreadyMade` scalar reducer with a fully allocation-
  driven reducer (would touch all plan math; keep scalar + ledger in sync).
- Prep-mix surplus UI polish beyond the same strip.

## Rollback

- Feature branch → merge to `main` only after CI-style checks pass.
- All additions are additive; rollback = revert the merge with no data
  migration needed (new tables simply stop being written; existing mix rows
  unchanged).

## Open Decisions (confirm at spec review)

1. **B2 under-production basis** — current `freshLbs = max(totalLbs,
   actualMade)` over-deducts when the mixer enters an amount below the plan.
   Proposal: `actualMade > 0 ? actualMade : remainingLbs` with a regression
   test. (Recommend: fix in this slice.)
2. **Allocation semantics** — "Use on next run" is an audit/reminder row that
   matches the existing `amountAlreadyMade` reducer (auto-applied), NOT a
   second math reduction; only "Release/void" changes plan numbers (by
   decrementing `amountAlreadyMade`). Confirm no one expects confirmations to
   independently change the plan.
3. **Manual POST /mix-surplus** — include (manager can log found/confirmed
   stock), or defer to later? (Recommend: include — it makes the reminder
   honest when the mixer pre-records surplus before day-start.)
