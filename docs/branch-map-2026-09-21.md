# Fresh Branch Map — App vs GitHub Main

**Captured:** 2026-09-21  
**Initial functionality baseline:** `Replit` at `bf695fd5983e2813017b83e5ca596e8aaf313672`
**Protected rebase base:** `main-repl/main` at `e8dc4a0a`
**Reconciled review revision:** `1c773002949213c6a78d5ab9b6b7580603e9f1c6`
**GitHub main:** `8885c9a523aeb6035d4690679c3487174a00a6fa`  
**Merge base:** `afa300299e41c12458120ba1e2c1a4aba9a6c53f`  
**Recovery baseline:** branch and tag `recovery-baseline-task-2415-20260921`

## Fresh divergence

| Measure | 2026-09-20 snapshot | 2026-09-21 refresh | Change |
|---|---:|---:|---|
| Main-only commits | 5 | 5 | No upstream movement |
| App-only commits | 121 | 153 | 32 later app commits |
| App-side files from merge base | 300 | 356 | 56 more changed files |
| App-side line churn | about +16k / -6.8k in web plus smaller areas | +63,289 / -7,972 overall | Later recovery, release, API, and UI work expanded the app line |

GitHub `main` did not move after the attached snapshot. During protected delivery, the app line incorporated concurrent reviewed work through `e8dc4a0a`; the reconciled review revision is 32 commits beyond the captured Replit tip `3840f5d3`.

## Main-only classification

| Commit | Classification | Reconciliation |
|---|---|---|
| `860d99ea` route mounts, heartbeat, repair evidence | **Functionally superseded / conflicting** | Current app already has route composition, schedule-gated heartbeat, source-library repair reruns/fingerprints, and broader sync tests. Do not cherry-pick over newer code. |
| `f9e1cf85` research pack | **Mixed: useful research, later authority on app** | Current app plans independently contain newer sync/import/AI conclusions. Preserve those authorities; incorporate the corrected battery evidence and record the remaining historical documents as superseded research rather than replacing current plans. |
| `a796abe2` first battery audit | **Superseded** | Replaced by `8768ec88`. |
| `8768ec88` corrected battery audit | **Unique and incorporated** | Reconciled into `docs/battery-performance-research.md`, with a current implementation/evidence boundary. |
| `8885c9a5` merge commit | **Aggregate only** | No independent patch to replay. |

Patch IDs were not treated as proof of absence: the route/heartbeat work is not byte-equivalent because the app branch continued to evolve, but focused source and test review shows the behavior is present in newer form.

## Preserved app-only areas

- Extracted live station modules and `liveTabsSupport`.
- Wake recovery timing and diagnostics.
- Partial PUT and conditional peer SSE with complete recovery fallback.
- Complete PUT snapshot fencing with canonical no-write fallback.
- Expanded sync convergence, lifecycle, rollover, and SSE integration coverage.
- Sauce/Frontline staged supply and correction behavior.
- Packaging progress and server authority.
- Whole-day timeline and fixed breaks.
- Safe offline break-plan recovery, hidden-tab timer scheduling, and Floor Mode Wake Lock.
- Server live calculation projections, warehouse snapshots, atomic inventory physical-event accounting, safe sync/capacity telemetry, and recovery/release evidence.

## Conflict hotspots reviewed

- `artifacts/run-calculator/src/pages/home.tsx`: main-only commits do not modify it; preserve the extracted app boundary.
- `artifacts/api-server/src/routes/sync.ts` and `sync.integration.test.ts`: upstream heartbeat intent is already present amid newer app protocol work; no wholesale replay.
- Repair catalog/fingerprint files: upstream definitions are superseded by later app repairs; preserve current generated evidence.
- Planning and memory: current `docs/` authorities win; memory mirrors are marked historical rather than copied back over current plans.
- Generated API packages: the main-only range does not change generated OpenAPI clients.

## Evidence boundary

This map proves repository ancestry and file-level reconciliation only. It does not prove that a particular revision is published, that Autoscale or Reserved VM is active, that SSE fans out across deployed instances, or that production database pressure and device battery behavior meet targets.