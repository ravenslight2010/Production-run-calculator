# Press/Oven and Frontline split — development verification

This is scoped development evidence for the four-section timer change, not a
production release decision. No production database, historical bulk rewrite,
or publishing operation was used. Factory-measured split times were not supplied:
the legacy half/half allocation is explicitly provisional and editable.

## Contract

- Physical display: Press/Oven → Frontline → Freeze Tunnel → Wrapper/Packaging.
- Press/Oven pair rate is half the existing individual-pizza rate; pizza demand,
  effective-speed multipliers, ingredients, and case totals are unchanged.
- Original numbered stages retain their original three-stage meanings for old
  readers. Additive sections use the same resolved settings and operational clock.
- Split settings are optional JSON values and nullable additive die-default
  columns. Zero is intentional for a split section; old positive-only die-default
  sentinels retain their prior behavior.
- Time-varying projection sections remain outside persisted sync snapshots.

## Checks

| Check | Result |
|---|---|
| Shared live-calc focused suite | PASS — 11 tests |
| Server automatic claim builders | PASS — 26 tests; conserved calculation, claim generation, cadence, and mutations for equivalent splits |
| Client phase/default/Line Map/interruption/context suites | PASS — original focused run 149 tests; expanded context suite separately rerun with 9 passing tests |
| Inventory math suites | PASS — 96 tests |
| Die-default disposable-DB integration | PASS — 14 tests, including explicit zero, update/reload, and legacy validation |
| Generated API consistency | PASS — regenerated output matches; scalar contract smoke 1 passed, 5 intentionally excluded by its name filter |
| Shared TypeScript project build | PASS |
| API main and route TypeScript projects | PASS |
| Calculator TypeScript project and reviewed-cast budget | PASS |
| Lifecycle ownership and pause-policy regressions | PASS — 22 tests, including intent-bound acknowledgement, original deadline, stale-pause rejection, and split values attributed to the settled form owner |
| Isolated local API build/readiness and Vite startup | PASS |
| WebKit runtime using existing Nix helper | PASS — actual browser launch and local document navigation |
| Chromium lifecycle, reload, independent-storage peer, resume, running reload | PASS — complete journey in the earlier bounded attempt; the other engine failed wrong-run fixture selection |
| WebKit lifecycle, reload, independent-storage peer, resume, running reload | PASS — complete journey in the latest bounded attempt; Chromium failed cold-client fixture selection in that invocation |
| Desktop / phone / tablet full/compact timer and settings bounds | PASS in both engines — 1440×960, 390×844, 768×1024, 1024×768; viewport emulation, not physical devices |
| Latest combined browser invocation | FAIL — one passed/one failed; final fixture-only readiness/selection correction syntax-checked, not rerun |
| Die-default browser case | Both individual engine cases advanced without failure before the earlier interrupted lifecycle run; no overall-suite PASS claimed |
| Physical Android Chrome / iOS Safari / installed PWA | NOT RUN — no physical devices supplied |
| Native applications | NOT APPLICABLE |
| Full release suites / production readiness | NOT RUN — not required for this feature |

TypeScript used `tsc --build` for shared libraries before dependent
`artifacts/api-server/tsconfig.json`, `tsconfig.routes.json`, and
`artifacts/run-calculator/tsconfig.json` checks. Focused Vitest commands used
installed package executables with one worker; these results are not a claim that
the full root `pnpm run typecheck` or a managed workflow passed.

## Failure ledger

| Observation | Repair / disposition |
|---|---|
| API validation initially allowed zero in old pre/post die defaults | Reinstated old positive-only behavior; zero remains supported only for new split fields. Integration rerun: 14 passed. |
| A projection test expected 54 seconds after a 5-second delta from 60 seconds | Corrected the fixture expectation to 55 seconds; shared suite passed. |
| Comparing independent server claims included random event IDs | Used the supported fixed event namespace; all 26 claim-builder tests passed. |
| A confirmed old three-stage payload could lose legacy adoption or restore the combined display | Preserve numbered-stage interpolation and derive only additive sections from the confirmed clock when omitted. Focused context coverage includes legacy and explicit sections. |
| Managed app startup recursively bootstrapped pinned pnpm through the older global pnpm, exhausting process capacity | Stopped the confirmed failed bootstrap subtree. Installed-tool focused checks and isolated app startup succeeded. Managed artifact workflows are not recorded as passing. |
| Browser command initially waited behind stalled local release validation | Stopped the local release/client validation workflows through their workflow manager, without bypassing the lock. Protected pinned-Node runner then succeeded. |
| Standard browser config cannot collect because baseline `manager-attention.spec.ts` is malformed | Not changed by this feature. The scoped harness selects and syntax-checks only the changed spec. Global browser preflight remains blocked; no whole-suite pass claimed. |
| Temporary focused config omitted `baseURL` | Added the isolated runner's web URL. Initial navigation failures reached no app behavior. |
| Raw WebKit launch reported missing Debian host libraries on Nix | Switched to the repository's existing Nix WebKit launch helper; actual runtime smoke passed without disabling browser TLS/security. |
| Initial paired-run DB fixture left a different blank run selected | Removed direct daily-sync replacement. Fixture now fills the actual selected run through UI controls and waits for canonical persisted values before Start. Initial lifecycle assertions were not reached. |
| Phone setup waited for Operator although the account was already Supervisor | Setup now accepts either actual role state and unlocks only when needed. Initial phone/tablet/landscape behavior was not verified. |
| Browser shell timed out before its earlier multi-viewport suite completed | No final suite pass claimed. Disposable database was stopped/removed. Retrying only the repaired journey, with viewport bounds asserted inside it. |
| Browser worker could not keep its focused command alive | No new application evidence from that attempt. A direct protected background invocation successfully started the isolated browser runner instead. |
| Corrected UI fixture selected Crust mode, which hides the cycle controls it tried to fill | Chromium timed out waiting for Crusts Per Cycle before Start. Changed fixture to Dough mode; both engines subsequently reached the complete paired-run journey. |
| Transport provenance initially accepted only new phase version 2 | Restored readable versions 1 and 2 while new server output remains version 2. Regenerated clients/validators, consistency check, shared tests, and dependent typechecks passed. |
| Earlier screenshot showed “App updates · Update failed” while Sync was connected | Retained as separate update/recovery evidence, not a successful PWA update. Existing Frontline/update-sync recovery work owns that independent behavior. |
| Canonical Pause acknowledgement removed the policy prompt before a pointer click completed | The client used an unrelated optimistic stoppage ID while the server used `offline:<intent ID>` and could omit `pausedStoppageId`. Reused the exact intent-bound ID, accepted that same open canonical pause, rejected other pauses, and retained the original ten-second deadline. Lifecycle/policy tests: 22 passed. Both engines subsequently passed Pause, upstream drain, stopped Tunnel, and reload assertions. |
| Browser fixture expected empty upstream section names in the compact summary after drain | Corrected the assertion to the selected occupied section, `Freeze Tunnel — stopped`. The full timer still renders all section rows; compact intentionally selects the relevant transition/occupied section. No production display change was needed. |
| Independent browser selected its own pending blank rather than the paused run | Keep its operational storage empty and select the canonical run through UI. Server currentIndex or equal settings can identify an earlier matrix case instead; the rendered owner ID now binds API assertions and peer selection. Complete peer/resume journeys passed in each engine. |
| Cold-client selection was skipped while the server still had one run but the UI already had a second local blank | Removed the server-count condition. Wait for the confirmed baseline, compare rendered owner identity, select the intended run when different, then assert identity. Final fixture-only correction was syntax-checked, not followed by another full browser pass. |
| Attempt to distinguish fixtures by creating Brand/Flavor timed out without an actionable browser stack | Removed that unrelated metadata-creation setup; bind to the read-only rendered owner instead. This is not proof of a product metadata defect or passing timer evidence. Disposable DB cleanup completed. |

The independently owned Packaging manual-correction recovery and Frontline
supply/recovery lifecycle were not changed. Release or global test repairs are
not silently treated as passed by these bounded checks.

## Completion-review scope and limitations

Implementation and bounded feature verification are ready for completion review.
Each engine has completed the entire lifecycle and independent-storage journey,
in separate attempts. The latest combined invocation remains recorded as FAIL,
not rewritten as green. Its fixture-only readiness/selection fix was checked
statically rather than launching another full pass.

The peer test now uses independent browser storage, transferring only the same
actor's session cookies and no cached origins. Unchanged counters are compared
while safely paused, before legitimate resumed production could advance; resume
is then observed in the peer and followed by a running reload. Full/compact
timer/settings bounds are asserted at desktop, phone, tablet portrait and
landscape sizes. Physical Android Chrome, iOS Safari and installed PWA remain
NOT RUN because no physical devices are available.

The permanent guarded harness is `playwright.line-transit.config.ts`, exposed as
`test:e2e:line-transit`. Each engine asserts all four viewports inside the same
journey rather than repeating the lifecycle per viewport. The ordinary suite's
full preflight is unchanged. Temporary task-named config and installed-command
adapter were removed.

The general browser preflight failure and managed pnpm startup failure are still
separate unresolved environment/baseline limitations, not successful checks.
Broader update/sync recovery, server authority, responsive repair and branch
repair already have existing task owners. No remaining part of the timer outcome
is being split into new follow-ups.
