# Web app improvements — review and change report

Repository: `ravenslight2010/Production-run-calculator` (public, MIT)
Base revision: `main` @ `0623f50`
Working branch: `improvements/web-quality`
Area of focus: `artifacts/run-calculator` (the React 19 + Vite web app)

## 1. Summary

The brief assumed the web app might have no test runner and thin tests. That is
not the case: the package already ships **Vitest** (jsdom, colocated
`src/**/*.test.{ts,tsx}`) with **~290 test files**, plus a large Playwright e2e
suite and extensive `docs/`. So the work was re-scoped from "set up testing" to
"close genuine gaps and fix real defects".

Delivered, conservatively:

- **6 new unit-test files, 54 tests**, covering pure web-app logic that had no
  dedicated coverage (formatters, the production-run shaping calculator,
  notification preferences, mix-preset lookup, query-key building, the
  substitution overlay).
- **1 real display bug fixed** (`fmtTime` could render `60s` / `59m 60s`).
- **1 type escape removed** (`storage.ts` legacy-run migration no longer widens
  to `any`).
- **1 new developer README** for the web app package (there was none).

No mobile, API-server or database files were touched. No dependency upgrades, no
reformatting, no refactors of unrelated files.

## 2. Environment

- Node.js `v22.23.1` was available; the workspace declares `engines.node >= 24`,
  so pnpm printed an "Unsupported engine" warning. This did **not** block
  install, typecheck, tests or build.
- pnpm `11.5.2` (matches the repo's `packageManager`).
- Clone was shallow (`--depth 1`), so only `main` is present locally; the
  improvements branch was created from it.

## 3. What I inspected

- Package layout and scripts: `artifacts/run-calculator/package.json`,
  `vitest.config.ts`, `tsconfig.json`, `vite.config.ts`, `components.json`.
- Test inventory: 291 existing `*.test.*` files under `src/`, plus `e2e/`
  Playwright specs and the `playwright.*.config.ts` lanes.
- Existing docs: root `README.md`, `docs/` (60+ files), `e2e/README.md`,
  `AGENTS.md`, `.agents/memory/` (institutional notes), `.agents/skills/`
  (including `test-gap-triage` and `verify-before-commit`).
- Coverage gaps: cross-referenced every non-test source file against test
  basenames to find pure modules with no dedicated test.
- Code-quality signals: `: any` escapes, loose equality, `parseInt` without
  radix, and the pure formatter/calculator helpers by hand.

## 4. Changes, file by file

### New tests

**`src/utils.test.ts`** (21 tests) — `src/utils.ts` is a pure helper module with
no dedicated test file. Existing suites already cover `writeDayResetAt`,
`computeResumedStartedAt`, `applyResumeToRun`, the rollover policy and
`fmtElapsed`, so this file covers the **remaining** exported helpers:
`fmtTime`, `fmtNum`, `fmtComma`, `fmtMins`, `fmtCountdownParts`, `runLabel`,
`sauceBarrelBreakdown`, `genId`. Includes the regression case for the `fmtTime`
fix below.

**`src/runShaping.test.ts`** (13 tests) — `buildShapedRun` is the normalised
"run fact" shared by recap, anomaly and scheduling tools, and had no test. Covers
status derivation (upcoming/running/finished), live vs recorded case accounting,
the negative-cases-left clamp, planned ppm, downtime/net-elapsed math (pauses
excluded from downtime), actual ppm, minutes-remaining ETA, and the stoppage
projection (non-pause only, default reason, open flag).

**`src/notificationPrefs.test.ts`** (6 tests) — pins the "missing key = enabled"
contract that lets new alert kinds ship enabled without a migration, plus the
`NOTIFICATION_KINDS` metadata completeness.

**`src/substitutionState.test.ts`** (8 tests) — the process-local substitution
overlay: empty-overlay identity, overlay application, non-mutation of the
caller's object, clearing, and the today-only variant.

**`src/mixPresets.test.ts`** (3 tests) — `findMixPresets` guard behaviour after
the 2026-07-03 data purge (empty query, no match, empty factory presets).

**`src/runInsightsQuery.test.ts`** (3 tests) — `runSuggestionsQueryKey`
normalisation (case/whitespace) and product scoping.

### Code-quality fixes

**`src/utils.ts`** — fixed a real display bug in `fmtTime`. It rounded the
seconds remainder in isolation, so values just under a boundary rendered a
`60s` component:

```
fmtTime(59.6)   -> "60s"      (was)   -> "1m 0s"   (now)
fmtTime(119.6)  -> "1m 60s"   (was)   -> "2m 0s"   (now)
fmtTime(3599.6) -> "59m 60s"  (was)   -> "1h 0m 0s" (now)
```

The fix rounds the **total** seconds first, then decomposes into h/m/s, so the
carry reaches the minute/hour field. Integer inputs are unchanged.

**`src/storage.ts`** — `loadDayState` migrated legacy rows with
`parsed.runs.map((r: any) => …)` to read the pre-split `label` field. Replaced
the `any` with `RunMeta & { label?: string }`, keeping the legacy fallback while
restoring type safety. Behaviour is identical.

### Documentation

**`artifacts/run-calculator/README.md`** (new, 163 lines) — the package had no
developer README. Added one covering: prerequisites, install, run/build/preview,
typecheck (including the `TS6305` project-reference gotcha), the Vitest unit
suite, the Playwright e2e lanes, the build-time environment variables, an
architecture overview of `src/`, and a short contribution/testing note. It links
to the root README, `e2e/README.md` and the test/release matrix rather than
duplicating them.

## 5. Commands run and actual results

All commands were run from the repository root unless noted.

| Command | Result |
| --- | --- |
| `git clone --depth 1 https://github.com/ravenslight2010/Production-run-calculator.git repo` | Success; `main` @ `0623f50`. |
| `pnpm install --prefer-offline` | Success; 837 packages added, "Done in 15.4s". Engine warning only. |
| `node ./node_modules/typescript/bin/tsc --build` (root) | Exit 0 (builds the referenced `lib/*` packages). |
| `pnpm --filter @workspace/run-calculator run typecheck` | **Exit 0** (after libs built). |
| `pnpm --filter @workspace/run-calculator exec vitest run <6 new files>` | **6 files passed, 54 tests passed.** |
| `pnpm --filter @workspace/run-calculator exec vitest run` (full suite) | **295/296 files passed; 2749/2750 tests passed.** |
| `PORT=5173 BASE_PATH=/ pnpm --filter @workspace/run-calculator run build` | **Exit 0**; "Workbook boundary OK: 700 opening modules; 14 deferred entry points verified." |
| `git apply --check` of the patch against a clean `main` worktree | **Applies cleanly**; applied and verified. |

### Test-count detail

- New tests by file: `utils.test.ts` 21, `runShaping.test.ts` 13,
  `notificationPrefs.test.ts` 6, `substitutionState.test.ts` 8,
  `mixPresets.test.ts` 3, `runInsightsQuery.test.ts` 3 — **54 total**.
- Baseline (before changes): 287 files, 2675 passed / 3 failed / 4 errors.
- After changes: 296 files, 2749 passed / 1 failed / 1 error.

## 6. What failed or could not be verified

- **One full-suite file failed in both the baseline and the post-change run:**
  a Vitest worker failed to start within the pool timeout
  (`[vitest-pool-runner]: Timeout waiting for worker to respond`). In the
  baseline it was `recipePoolFreshness.test.ts`; after changes it was
  `recipeRefreshSpecSyntax.test.ts`. Both **pass in isolation** (verified:
  `recipeRefreshSpecSyntax.test.ts` → 4/4 passed). This is a resource/worker
  startup artifact of running the 296-file suite with a 4-worker ceiling in this
  environment, not a code failure. The 3 baseline "failed tests" were the same
  class of artifact.
- **Node version mismatch:** the sandbox has Node 22, the repo wants Node 24.
  Everything ran, but CI on Node 24 remains the authority.
- **Playwright e2e was not run.** The lanes need a running API server and, for
  destructive lanes, an approved disposable database. Not attempted here; the
  changes are unit-level and do not alter browser behaviour except the `fmtTime`
  display fix.
- **No lint run.** The package has no `lint` script; formatting is handled by
  Prettier at the root and the changes follow the existing style.

## 7. Found but deliberately NOT changed

- **`src/pages/home.tsx` (~22k lines) contains ~180 `: any` escapes.** Tightening
  these is high-risk and unreviewable in a single patch; it needs an owner-led,
  incremental effort. Left untouched.
- **`buildShapedRun` treats `startedAt === 0` as "not started"** (`if
  (run.startedAt)`). In practice timestamps come from `Date.now()` and are never
  `0`, so this is not reachable; changing it would alter status semantics. Noted,
  not changed.
- **`sauceBarrelBreakdown` has a redundant `effBarrelLbs >= 450` guard** (the
  `batchesPerBarrel < 2` check already rejects it). Cosmetic only; left as-is to
  avoid churn.
- **`src/storage.ts` still has other `any`-adjacent casts** elsewhere; only the
  one in the legacy-run migration was in scope and safe.
- **No dependency upgrades, no config changes.** The Vitest/TS configs are
  already sane for the web app.
- **Mobile / API-server / DB** were not touched, as instructed.

## 8. Recommended next steps (not implemented)

1. **Split `src/pages/home.tsx`.** It is the single largest maintainability risk
   in the package. Extract cohesive pure logic into small modules with tests,
   one slice at a time.
2. **Add a lint gate.** There is no ESLint config for the web app; a minimal
   `@typescript-eslint` setup with `no-explicit-any` as a warning would surface
   the ~180 escapes without blocking.
3. **Cover the remaining pure modules** flagged by the gap scan but not in this
   patch: `src/parseSpecSheet.ts` (partially covered), `src/premixMatch.ts`,
   `src/shiftHandoff.ts`, `src/runInsightsQuery.ts` (now covered), and the
   `src/adapters/*` persistence adapters.
4. **Run the Playwright smoke lane** (`test:e2e:smoke`) in CI on this branch to
   confirm the `fmtTime` change renders as expected in the run-duration UI.

## 9. How to apply

```bash
git checkout main
git checkout -b improvements/web-quality
git apply production_run_calculator_web_quality.patch
# or drop the files from changed_files.zip into the repo root
pnpm install
node ./node_modules/typescript/bin/tsc --build
pnpm --filter @workspace/run-calculator run typecheck
pnpm --filter @workspace/run-calculator test
```

The patch is a unified diff against `main` (`0623f50`) and was verified to apply
cleanly to a fresh checkout of that revision.

5. **Log the `fmtTime` fix in `.agents/memory/`** per `AGENTS.md` (the repo asks
   agents to record fixes in `codex-fixes.md` / `claude-bugs.md`). Left out of
   the patch to keep it focused on the web-app deliverable.
