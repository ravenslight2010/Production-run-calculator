# Mix Surplus Ledger — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Server-authoritative, dated mix surplus ledger (lots + allocations) with a Mixes-tab freezer-stock reminder and Use/Release controls, recorded at the day-start consumption source.

**Architecture:** Mirror the proven `freezer_surplus` pattern end-to-end. Two additive Drizzle tables; recording hooks into the existing `POST /inventory/consume-day-start` surplus carry (Feature B2); a new `mixSurplus.ts` route mirrors `freezerSurplus.ts`; the web tab reads balances via a defensive parse client. Plan math (`amountAlreadyMade` reducer) is untouched — the ledger is its traceable image.

**Tech Stack:** Express + Drizzle (Postgres), zod/OpenAPI + orval codegen, React, vitest.

**Spec:** `docs/superpowers/specs/2026-09-15-mix-surplus-ledger-design.md`

## Global Constraints

- Additive-only schema: new tables + new endpoints; no drops/renames; `push-force` safe (schema applies at boot via `applyDatabaseSchema()`).
- Keep the API contract in sync: update `lib/api-spec/openapi.yaml`, regenerate with `pnpm --filter @workspace/api-spec run codegen` — never hand-edit generated output.
- Scope isolation: every row carries `scope` (default `"live"`); every query filters by `currentScope()`.
- Surplus use NEVER re-deducts inventory (ingredients were deducted when made); allocations are ledger/audit rows.
- Release/void decrements the mix's `amountAlreadyMade` so the scalar reducer stays in sync with the ledger.
- No force-push to `main`; work on `feat/mix-surplus-ledger`; CI-style checks pass before merge.
- Mobile out of scope; notifications out of scope (in-tab strip only).

---

## Task 1: Schema — `mix_surplus_lots` + `mix_surplus_allocations`

**Files:**
- Create: `lib/db/src/schema/mixSurplus.ts`
- Modify: `lib/db/src/schema/index.ts`

**Interfaces:**
- Produces: `mixSurplusLotsTable`, `mixSurplusAllocationsTable` (Drizzle tables + `$inferSelect` row types), exported from `@workspace/db`.

- [ ] **Step 1: Write the schema** — mirror `lib/db/src/schema/freezerSurplus.ts`:
  - `mixSurplusLotsTable` (`mix_surplus_lots`): `id` text, `scope` text default `"live"`, `mixId` text, `name` text (denormalized), `brand` text, `flavor` text default `""`, `isPrep` boolean default false, `productionDate` text, `amountMade` real default 0, `amountUsed` real default 0, `amountRemaining` real default 0, `location` text default `"freezer"`, `createdAt`/`updatedAt` timestamps. Unique index `(id, scope)`.
  - `mixSurplusAllocationsTable` (`mix_surplus_allocations`): `id`, `scope`, `lotId` text, `mixId` text, `runId` text default `""` (day-state run id when materialized, else empty), `runDate` text, `brand`, `flavor` default `""`, `isPrep` default false, `amount` real default 0, timestamps. Unique indexes `(id, scope)` and `(lotId, runDate, scope)`.
- [ ] **Step 2: Export both** from `lib/db/src/schema/index.ts` (`export * from "./mixSurplus";`).
- [ ] **Step 3: Verify** — `pnpm --filter @workspace/db exec tsc -p tsconfig.json --noEmit` clean (schema only; table applies at boot via push-force).
- [ ] **Step 4: Commit** — `feat(db): mix surplus lots + allocations tables`.

## Task 2: Pure surplus-recording helper (unit-testable)

**Files:**
- Create: `lib/inventory-math/src/mixSurplus.ts` (or a sibling of `computeMixComponentConsumptionLines` in `lib/inventory-math/src/index.ts` — follow the file's existing organization)
- Test: `lib/inventory-math/src/mixSurplus.test.ts`

**Interfaces:**
- Consumes: `MixPlanGroup[]` from `@workspace/mixes` (fields `runs[].mixes[]` + `prepMixes[]`: `mixId`, `name`, `totalLbs`, `remainingLbs`, `components`), and a `mixId → { amountActualMade }` lookup.
- Produces: `buildMixSurplusRecording(planGroups, actualMadeByMixId): Array<{ mixId, name, brand, flavor, isPrep, amountMade, amountRemaining }>` — pure, one entry per (mix, surplus>0).

- [ ] **Step 1: Write failing tests** — helper derives, per plan entry, `freshLbs = actualMade > 0 ? actualMade : remainingLbs` and `surplus = max(0, actualMade - remainingLbs)`; only entries with `surplus > 0` produce a lot row; blank actualMade produces no row; prep mixes included.
- [ ] **Step 2: Run** — expect FAIL (module missing).
- [ ] **Step 3: Implement** `buildMixSurplusRecording` (mirror the B2 math already in `inventory.ts`).
- [ ] **Step 4: Run** — `pnpm --filter @workspace/inventory-math exec vitest run` green.
- [ ] **Step 5: Commit** — `feat(inventory-math): pure mix surplus recording helper`.

## Task 3: Day-start records surplus lots + B2 basis fix

**Files:**
- Modify: `artifacts/api-server/src/routes/inventory.ts` (Feature B+E7 block, ~lines 2180–2326)
- Test: extend `lib/inventory-math` helper tests (Task 2) for the corrected basis; api-server integration test added in Task 8 (CI-only)

**Interfaces:**
- Consumes: `buildMixSurplusRecording` from Task 2 + the existing per-entry `dbMix.amountActualMade`.
- Produces: the route writes/extends `mixSurplusLotsTable` rows inside the existing transaction flow; same-date second run extends the same lot (amountMade += n, amountRemaining += n) instead of duplicating.

- [ ] **Step 1: Fix the B2 fresh basis** — replace `Math.max(entry.totalLbs, actualMade)` with `actualMade > 0 ? Math.max(0, actualMade) : entry.remainingLbs` (Open Decision 1; under-production deducts only what was made, blank still assumes needed). Keep `surplus = max(0, actualMade - entry.remainingLbs)` carry logic unchanged.
- [ ] **Step 2: Record lots** — after computing `mixesToUpdate`, call `buildMixSurplusRecording(plan, mixById → amountActualMade)`; for each entry, insert a new `mix_surplus_lots` row or extend an existing same-`mixId`+`productionDate` lot within the same `db` batch (no transaction requirement change beyond what exists).
- [ ] **Step 3: Verify** — helper tests cover basis fix; `pnpm --filter @workspace/api-server exec tsc -p tsconfig.json --noEmit` clean; existing `sync.liveCalcTick` suite still green (no sync change).
- [ ] **Step 4: Commit** — `feat(api): record mix surplus lots at day-start + correct fresh basis`.

## Task 4: API contract (OpenAPI + codegen)

**Files:**
- Modify: `lib/api-spec/openapi.yaml`

**Interfaces:**
- Produces: generated zod + React Query types `MixSurplusLot`, `MixSurplusAllocation`, `MixSurplusLedger`, `MixSurplusBalance`, `RecordMixSurplusInput`, `ReplaceMixSurplusAllocationInput` in `@workspace/api-zod` / `@workspace/api-client-react`.

- [ ] **Step 1: Add schemas + endpoints** — mirror the `/freezer-surplus` block: `GET /mix-surplus`, `POST /mix-surplus`, `PUT /mix-surplus/allocations/{runDate}` (runDate path param, `YYYY-MM-DD`). Responses: ledger (`lots`, `allocations`, `balances`) and mutation response.
- [ ] **Step 2: Regenerate** — `pnpm --filter @workspace/api-spec run codegen`; then `pnpm -w run check:api-generated` passes (never hand-edit generated output).
- [ ] **Step 3: Commit** — `feat(api-spec): mix surplus endpoints + generated clients`.

## Task 5: API route `mixSurplus.ts` + mount

**Files:**
- Create: `artifacts/api-server/src/routes/mixSurplus.ts`
- Modify: `artifacts/api-server/src/routes/index.ts` (mount + writes capability list)

**Interfaces:**
- Consumes: `mixSurplusLotsTable`, `mixSurplusAllocationsTable`, `mixesTable`, generated zod bodies, `currentScope()`, `consumeRun`/draw-down (NOT used for surplus — allocation is ledger-only).
- Produces:
  - `GET /mix-surplus` → `{ lots, allocations, balances }` where `balances = [{ mixId, name, lbs, productionDates }]` (rows with remaining > 0).
  - `POST /mix-surplus` (capability `manage-inventory`) → insert lot at `location="freezer"`; validate mix exists + amount > 0.
  - `PUT /mix-surplus/allocations/:runDate` (capability `manage-inventory`) → transaction: fetch existing allocations for (scope, runDate) `.for("update")`; apply deltas to lot `amountRemaining` (never negative); upsert allocation rows (zeroed amount deletes/releases); when a lot is fully released, decrement `mixesTable.amountAlreadyMade` by the released amount (scalar sync). Return updated ledger.

- [ ] **Step 1: Write route** — handlers mirror `freezerSurplus.ts` (zod `safeParse`, `randomUUID`, `db.transaction`, scoped selects, `req.log` info entries, 400/500 responses).
- [ ] **Step 2: Mount** — `routes/index.ts`: `router.use(mixSurplusRouter)` (check existing use pattern) + add `"POST /mix-surplus"`, `"PUT /mix-surplus/allocations/:runDate"` to the `manage-inventory` writes list.
- [ ] **Step 3: Verify** — api-server typecheck clean; no existing suite breaks.
- [ ] **Step 4: Commit** — `feat(api): mix surplus ledger + allocation routes`.

## Task 6: Web ledger client

**Files:**
- Create: `artifacts/run-calculator/src/mixSurplusClient.ts`
- Test: `artifacts/run-calculator/src/mixSurplusClient.test.ts`

**Interfaces:**
- Produces: `fetchMixSurplusLedger(): Promise<MixSurplusLedger | null>`, `recordMixSurplus(input)`, `replaceMixSurplusAllocations(runDate, allocations)`, and `parseMixSurplusLedger(value): MixSurplusLedger` (defensive, tolerant of unknown/partial shapes, same pattern as `parseFreezerSurplusLedger`).

- [ ] **Step 1: Write failing tests** — parse tolerates `null`/partial/unknown keys; balances map keyed by mixId; unknown shapes don't throw.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** using generated client types + fetch.
- [ ] **Step 4: Run** — suite green.
- [ ] **Step 5: Commit** — `feat(web): mix surplus ledger client`.

## Task 7: Mixes tab freezer-stock strip

**Files:**
- Modify: `artifacts/run-calculator/src/components/MixesTabContent.tsx`
- Test: new `artifacts/run-calculator/src/components/MixesTabContent.surplus.test.tsx` (component-level, mirror existing tab test patterns)

**Interfaces:**
- Consumes: `useMixPlanSnapshot` refresh pattern (re-fetch ledger on data-change), `ctx.mixMakeDay`, capability gate (`canManageInventory` or equivalent used by MixesTabContent), `fetchMixSurplusLedger`, `replaceMixSurplusAllocations`.

- [ ] **Step 1: Write failing test** — renders "X lbs in the freezer (made Y)" per mix when balances exist; hides strip when balance is 0; Use/Release buttons only when capable; optimistic update then server-ledger refresh.
- [ ] **Step 2: Run** — expect FAIL (no strip yet).
- [ ] **Step 3: Implement strip** — fetch ledger on mount + after mix saves; under each mix card where `balances[mixId] > 0` show balance/date; "Use on next run" allocates the remaining to `ctx.mixMakeDay`; "Release" sends zeroed allocation (server decrements `amountAlreadyMade`); small read-only allocation history. Row/column styling matches the tab (emerald/amber card conventions).
- [ ] **Step 4: Run** — new suite + existing MixesTab/MixAlreadyMadeInput suites green; run-calculator typecheck clean.
- [ ] **Step 5: Commit** — `feat(web): mix freezer-stock strip with use/release`.

## Task 8: Integration + no-double-count regression

**Files:**
- Create: `artifacts/api-server/src/routes/mixSurplus.integration.test.ts`
- Test: `artifacts/api-server/src/routes/inventory.test.ts` (or extend existing consume-day-start coverage if present)

**Interfaces:**
- Consumes: the Task 5 routes + Task 3 day-start behavior against a real DB (CI `DATABASE_URL`).

- [ ] **Step 1: Write integration tests** — create lot via POST; allocate decrements remaining; zero/void releases + decrements `mixesTable.amountAlreadyMade`; one row per (lot, runDate); scope isolation; day-start records a lot for `actualMade > remaining` and extends on a same-date second run.
- [ ] **Step 2: No-double-count test** — day-start (fresh basis) + subsequent allocation sequence never draws the same pound twice (assert total `inventory_consumed` matches the fresh basis once).
- [ ] **Step 3: Verify** — integration suite passes with `DATABASE_URL` set (CI); not run locally without one.
- [ ] **Step 4: Commit** — `test(api): mix surplus integration + no-double-count regression`.

## Task 9: Docs, memory, regression, merge

**Files:**
- Modify: `docs/idea-backlog.md` (§1 status → Done/partial with ledger shipped), `.agents/memory/codex-fixes.md`

- [ ] **Step 1: Full regression** — `pnpm --filter @workspace/live-calc exec vitest run`; api-server non-DB suites; run-calculator focused sets (MixesTab, MixAlreadyMadeInput, warehouseCoverage, LiveTabMemo.snappy); `CI=true pnpm run typecheck` at root (includes check:api-generated + shell-inventory).
- [ ] **Step 2: Docs + memory** — backlog §1: mark deduction done + ledger done, remaining = notifications/reminder polish; log the slice in `.agents/memory/codex-fixes.md` (files, what/why, verification, B2 basis fix note).
- [ ] **Step 3: Commit docs** — `docs: mark mix surplus ledger slice done`.
- [ ] **Step 4: Merge + push** — `git checkout main && git merge --no-ff feat/mix-surplus-ledger && git push origin main` (PR tooling unavailable; branch protection has accepted prior direct merges). Delete local branch after.

## Notes

- The B2 basis fix (Task 3 Step 1) changes consumption only for mixes where "Made today" was entered below the plan — blank entries (the common case) are unchanged (`remainingLbs` basis). Call this out in the memory log.
- Do NOT touch `useAutoTrack`/run-end ledger writes; surplus allocation is a separate, ledger-only write path.
- Recheck `origin/Replit` before merge (latest push was assets/docs/skills only — no code conflict expected).
