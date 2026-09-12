# Codex Fixes Log

Running log of fixes made by Codex. Read before modifying code to avoid re-applying fixes.

---

## Warehouse Snapshot — Server-authority migration (feat/warehouse-snapshot-server)

**Date**: 2026-09-12
**Branch**: `feat/warehouse-snapshot-server`
**Files changed**:
- `artifacts/api-server/src/lib/warehouseSnapshot.ts` (new — pure functions)
- `artifacts/api-server/src/routes/warehouseSnapshot.ts` (new — GET /inventory/warehouse-snapshot)
- `artifacts/api-server/src/routes/capabilities/inventoryOperations.ts` (mount new route)
- `artifacts/api-server/src/lib/warehouseSnapshot.test.ts` (new — 6 tests)
- `artifacts/run-calculator/src/warehouseSnapshotClient.ts` (new — shared cache + hook)
- `artifacts/run-calculator/src/inventoryShared.ts` (added WarehouseSnapshot type + fetch)
- `artifacts/run-calculator/src/components/ReorderCard.tsx` (prefer server snapshot when online)
- `artifacts/run-calculator/src/components/UseFirstCard.tsx` (prefer server snapshot when online)
- `artifacts/run-calculator/src/components/InventoryTab.tsx` (prefer server snapshot when online)
- `artifacts/run-calculator/src/reorderNudgeCardParity.test.ts` (fixed stale assertion)

**What was wrong**:
- Warehouse advisory lists (reorder, use-first, transfer warnings) were computed client-side on every device on every inventory SSE tick — CPU/battery waste, numbers could drift between devices.
- Previous model wrote `warehouseSnapshot.test.ts` with a fixture that lacked `casesPerLayer` and `app1OzPerPizza`, causing `computeSummaryStats` to produce NaN values → all demand lines empty.
- `computeWarehouseSnapshot` computed transfer warnings from **scheduled** (future) run values, but the web client's `InventoryTab` uses **today's** active runs as the transfer basis — parity bug.
- `reorderNudgeCardParity.test.ts` asserted `buildReorderDemandByKey(DEFAULT_VALUES) === {}` but DEFAULT_VALUES now defaults `cartoned: "cartoned"` which legitimately generates `packaging:shipper-labels:count` demand — assertion was stale.

**What the fix was**:
- Server: new `GET /inventory/warehouse-snapshot` endpoint pre-computes reorder (from scheduled future runs), use-first (from today's item keys + FEFO lots), and transfer warnings (from today's runs) using the same `@workspace/inventory-math` functions the client uses.
- Transfer computation corrected to use `todayRunValues` (matching InventoryTab parity) instead of `scheduledRunValues`.
- Tests: realistic fixture with `casesPerLayer: 1, app1OzPerPizza: 8` so `computeSummaryStats` produces valid demand lines; demand keys match `computeRunLines` parity (`ingredient:Cheese:batches` keyed by applicator type, not recipe ingredient name).
- Client: `useWarehouseSnapshot()` hook (React `useSyncExternalStore`), module-level shared cache + deduped in-flight fetch. Cards prefer server snapshot when online, fallback to local computation when offline (fetch failure → null → local). SSE handler triggers `refreshWarehouseSnapshot()` on remote inventory events.
- Parity test: updated missing-profile assertion to check CHEESE_KEY absence instead of total empty demand map, accounting for DEFAULT_VALUES packaging.

**Why it was needed**:
- "Server is boss when online, local is backup" — server migration step 3 of the recommended order.
- Battery savings: server pre-computes lists once per request; clients skip local recomputation when online.
- Device parity: identical numbers across all devices online.

**Key gotchas**:
- `computeRunLines` keys demand by applicator TYPE (e.g. `ingredient:Cheese:batches`), NOT by individual recipe ingredient names (Mozzarella). The recipe expansion to per-ingredient lbs only happens in the warehouse **display** roll-up (`aggregateNeedRows` in home.tsx with `warehouse: true`), NOT in inventory consumption keys.
- `casesPerLayer` must be present in run values — without it `totalPizzasForSauce` becomes NaN, zeroing ALL applicator/pep demand lines silently.
- DEFAULT_VALUES now defaults `cartoned: "cartoned"` — any `casesNeeded > 0` produces `packaging:shipper-labels:count` even without a real profile. This is correct behavior (packaging labels apply to all cartoned runs) but tests relying on DEFAULT_VALUES = no demand need updating.
- UseFirstCard test mocks `/api/inventory/*` broadly — the new `/api/inventory/warehouse-snapshot` route matches the prefix and returns `server.inventory` (an array), which the snapshot client correctly rejects via `isValidSnap` guard (shape mismatch → null → local fallback).

---

## Merge: Replit 4 commits + Claude cherry-pick + typecheck fix

**Date**: 2026-09-12
**Branch**: `main` + `feat/warehouse-snapshot-server`
**Files changed**:
- `AGENTS.md` (claude-bugs.md reference)
- `.agents/memory/MEMORY.md` (acknowledged-master-data-propagation)
- `.agents/memory/claude-bugs.md` (new — claude's fix log)
- `lib/db/src/schema/users.ts` (lower(username) uniqueIndex)
- `artifacts/api-server/src/routes/sync.ts` (facilityDate() alignment)
- `artifacts/api-server/src/routes/sandboxIsolation.integration.test.ts` (facilityDate() fix)
- `artifacts/run-calculator/src/contexts/__tests__/useLiveRun-allowed-callers.test.ts` (LineMapDashboard allowlist)
- `artifacts/run-calculator/src/hooks/useRunLifecycleManager.ts` (deferred lifecycle race fix)
- `artifacts/run-calculator/src/hooks/useHomeSyncCoordination.ts` (fetchWithTimeout)
- `artifacts/run-calculator/src/hooks/useHomeFormLifecycle.ts` (profile write guard)
- `artifacts/run-calculator/src/profileServerSync.ts` (fetchWithTimeout + strict flush)
- `artifacts/run-calculator/src/contexts/LiveRunContext.tsx` (occupancy rebase)
- `artifacts/run-calculator/src/pages/home.tsx` (batch weight chain, sync recovery, timeouts)
- `artifacts/run-calculator/src/components/CheeseRecipesManager.tsx` (await onSaved)
- `artifacts/run-calculator/src/components/MixesManager.tsx` (await onSaved)
- `artifacts/run-calculator/src/components/NamedRecipesManager.tsx` (await onSaved)
- `artifacts/run-calculator/src/specImport.ts` (PARSE_VERSION 38→39, unresolved field)
- `artifacts/run-calculator/src/fetchWithTimeout.ts` (new — timeout wrapper)
- `artifacts/run-calculator/src/components/ui/toast.tsx` (z-index 100→45)
- Plus e2e browser fixtures, webkit results, release evidence, render.yaml

**What was fixed**:
- Username case-race: concurrent sign-ups for "Bob"/"bob" no longer create duplicate rows
- Daily-reset boundary: clientToday() fallback aligned to facilityDate() — no more UTC-vs-local date mismatch
- Lifecycle start/pause/resume: deferred until canonical adoption settles — prevents dropped commands
- Batch weight save: propagation chain error handling with proper retry
- Recipe manager saves: mutation awaited before UI reports success — fixes stale pending-run rows
- Sync write recovery: stale partial fallback → replay as complete write
- Profile write guard: debounce won't overwrite shared profile for started/paused/ended runs
- fetchWithTimeout: all client API calls capped at 10s to prevent hangs on autoscale cold starts
- LiveRun occupancy: casesOnLine/casesInFreezer rebased onto local clock after wake/reload
- Toast z-index: lowered to not overlap dialogs

**Why it was needed**:
- Replit merged 4 commits (browser fixtures + release gate + render deploy)
- Claude found 3 real bugs (username case-race, facilityDate boundary, LineMapDashboard allowlist)
- Claude's cherry-pick left one stale `todayStr()` reference in sandboxIsolation test — fixed with `facilityDate()`

**How to apply**:
- All merged into main, feature branch rebased on top
- Pushed: main (65107e86) + feat/warehouse-snapshot-server (881b4711)

---

## Mix Plan Snapshot — Server-authority migration (feat/mix-plan-snapshot-server)

**Date**: 2026-09-12
**Branch**: `feat/mix-plan-snapshot-server`
**Files changed**:
- `artifacts/api-server/src/lib/mixPlanSnapshot.ts` (new — pure functions)
- `artifacts/api-server/src/routes/mixPlanSnapshot.ts` (new — GET /inventory/mix-plan-snapshot)
- `artifacts/api-server/src/routes/capabilities/inventoryOperations.ts` (mount new route)
- `artifacts/api-server/src/lib/mixPlanSnapshot.test.ts` (new — 5 tests)
- `artifacts/run-calculator/src/mixPlanSnapshotClient.ts` (new — make-day-keyed shared cache + hook)
- `artifacts/run-calculator/src/inventoryShared.ts` (added MixPlanSnapshot type + fetch)
- `artifacts/run-calculator/src/components/MixesTabContent.tsx` (prefer server plan when online)

**What was wrong**:
- The Mix Plan tab computed the make-day plan locally on every device from
  localStorage profiles + synced schedules — CPU waste and potential drift
  between devices.

**What the fix was**:
- Server: `GET /inventory/mix-plan-snapshot?makeDay=...&today=...` builds the
  plan with the SAME `@workspace/mixes buildMixPlan` the web tab uses, fed from
  canonical daily-sync runs (today's live dayState runs + future scheduled runs
  resolved via brand profiles) and the server mix pool. Run resolution mirrors
  the web `valsToMixRun` (computeSummaryStats totalPizzasForSauce + totalCases,
  computeCheesePerPizzaOz expansion across the 4 applicator slots).
- Client: `useMixPlanSnapshot(makeDay)` (make-day-keyed module cache, deduped
  in-flight per day, drop-on-failure → local fallback). `MixesTabContent` uses
  `serverSnap.plan` when online and only builds the local runs+plan inside a
  lazy IIFE when the snapshot is unavailable. Refreshes when make-day or the
  canonical mix pool signature changes.

**Why it was needed**:
- Final step of the server-side migration order: calc adoption, summaryStats,
  warehouse snapshot, mix plan. App slot validation was already server-authored
  via the auto-track schedule (`buildAutoTrackScheduleFromPayload` computes per
  app cadence + validForClaim and broadcasts over SSE; local math = offline
  fallback).

**Key gotchas**:
- Route must be under `/inventory/...` prefix (family routers mounted at API root).
- `normalizeMix` returns `Mix | null` — filter before typing as `Mix[]`.
- Server run values from the DB may lack optional recipe fields; recipes are
  normalized through `toRecipeRows` before `computeCheesePerPizzaOz` and values
  are cast `unknown as SummaryStatsInput` (the lib guards reads).
- The live-runs inclusion uses `row.date === facilityDate()`; scheduled rows use
  `date >= today` with `clientToday` semantics (client `?today=` param mirrors
  `/sync/scheduled`), so the boundary can't drift for a user behind UTC.

## Orval 8.31.0 upgrade with react-query v5 output (chore/orval-8.31)

**Date**: 2026-09-12
**Branch**: `chore/orval-8.31`
**Files changed**:
- `lib/api-spec/package.json` (orval 8.26.0 → 8.31.0)
- `lib/api-spec/orval.config.ts` (added `query: { version: 5 }` to api-client-react output override)
- `lib/api-client-react/src/generated/api.ts` (regenerated — v5 hook signatures)
- `lib/api-client-react/src/generated/api.schemas.ts` (minor null-type fix)
- `lib/api-zod/src/generated/api.ts` (regenerated)
- `lib/api-zod/src/generated/types/operationalProjectionFactsPaceStatus.ts` (null-type fix)
- `pnpm-lock.yaml`

**What was wrong**:
- Orval was at 8.26.0, two minor versions behind.
- When upgraded to 8.31.0, orval 8.31 warns that without `query.version: 5`, it generates react-query v4 hooks (positional `useQuery(key, fn, options)`) which are incompatible with the app's `@tanstack/react-query ^5.90.21`.
- pnpm `minimumReleaseAge: 1440` blocks 8.32.0 (published same day), so 8.31.0 is the correct latest.

**What the fix was**:
- Bumped orval to 8.31.0 (latest allowed by maturity policy).
- Added `query: { version: 5 }` to the `api-client-react` output's `override` block in `orval.config.ts`.
- Regenerated all output; the generated hooks now use v5 types (`DataTag`, `DefinedInitialDataOptions`, object-style `{ queryKey, queryFn, ...options }`).
- Verified: freshness check passes, full typecheck (`typecheck:libs` + web app) all clean.

**Why it was needed**:
- Without the version pin, regenerated hooks break at runtime with v5 — `useQuery` positional args are no longer accepted in v5.
- Keeps generated client aligned with the project's react-query v5 dependency.

## Dependabot security advisories — all resolved (chore/security-vuln-fixes)

**Date**: 2026-09-12
**Branch**: `chore/security-vuln-fixes`
**Files changed**:
- `pnpm-workspace.yaml` (override bumps: adm-zip 0.6.0→0.6.1, js-yaml 4.3.1→4.3.2, js-yaml@4 4.3.2, new vitest + @vitest/mocker pins)
- `pnpm-lock.yaml` (re-resolved)
- `lib/api-zod/package.json` (vitest 4.1.9→4.1.11)

**What was wrong** — 4 advisories on main (`pnpm audit`):
- **High** GHSA-2883-xcg3-v3hh: js-yaml `maxTotalMergeKeys` DoS (empty merge sources) — js-yaml 4.3.1 via orval; fix is 4.3.2.
- **Moderate** GHSA-82fw-gwwq-j7x9: vitest/@vitest/mocker path traversal via redirect mock — 33 dependent packages were on 4.1.9; fix is 4.1.11.
- **Moderate** GHSA-vwc7-r8mq-g2x9: adm-zip extraction follows destination symlinks (arbitrary file overwrite) via github-actionlint; fix is 0.6.1.

**What the fix was**:
- Bumped the three override pins and `vitest` in `lib/api-zod/package.json`.
- Added workspace-level overrides `vitest: "4.1.11"` and `"@vitest/mocker": "4.1.11"` so every dependent workspace resolves the patched version — matches the repo's existing security-override pattern in `pnpm-workspace.yaml`.
- Also pinned `"js-yaml@4"` from `^4.2.0` to `4.3.2` in overrides; the range form re-resolved to a stale 4.3.1.

**Why it was needed**: supply-chain/DoS/file-write exposure in dev + tooling deps. `pnpm audit` now reports zero vulnerabilities.

**Gotchas encountered**:
- `pnpm install --force` after editing overrides can leave bin links broken and optional platform binaries missing. On ARM64 (aarch64) host machines, vitest/rollup tests cannot run at all because the workspace excludes non-x64 rollup platform binaries (size optimization for x64 Render/Replit). Use typecheck as the local gate; CI runs tests on x64.
- The `overrides` key at workspace scope takes precedence, but package-specific range overrides (e.g. `js-yaml@4`) must also be bumped, or pnpm keeps the stale resolution.

## Dependency refresh — within declared ranges (chore/dep-updates)

**Date**: 2026-09-12
**Branch**: `chore/dep-updates`
**Files changed**: 37 `package.json` files, `pnpm-workspace.yaml` catalog, `pnpm-lock.yaml`

**What was wrong / intent**:
- After the security pinned versions landed, the workspace had drifted on minor/patch releases within existing `^` ranges (radix-ui, tailwind, tanstack-query, types, tooling).
- User asked for all remaining minor/upgrade opportunities.

**What the fix was**:
- `pnpm update -r` — bumps every package to the newest version its declared range allows, and bakes the updated ranges back into the manifests/catalog.
- Highlights: @tanstack/react-query 5.100.9→5.102.8, tailwind 4.3.0→4.3.3, @types/react(-dom) 19.2→19.3, @types/node 25.6.2→25.9.6, framer-motion 12.38→12.43, esbuild 0.28.1→0.28.2, @playwright/test 1.61.1→1.63.0, tsx 4.23.12→4.23.13, prettier 3.8.3→3.9.6.
- Deliberately left at current majors (breaking): vite 8, vitest 5, zod 4, typescript 7, react 19.3+, framer-motion 13, recharts 3, pino 10, openai 7, date-fns 4, jsdom 30, chokidar 5, @vitejs/plugin-react 6, p-retry 8, @hookform/resolvers 5, react-resizable-panels 4, react-day-picker 10, lucide-react 1.x. These need dedicated migration work.

**Why it was needed**: hygiene — avoid transitive drift, stay on patched releases, reduce future audit noise.

**Verification**: `typecheck:libs`, all artifact typechecks (api-server, run-calculator, mockup-sandbox, scripts), and `check-generated.sh` all pass.
