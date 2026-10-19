# Sync and automatic-tracking reliability audit

**Audit date:** 2026-10-19  
**Scope:** Current web/PWA clients, live-calculation scheduling, API sync and server-owned automatic ticks. This is an engineering audit, not a release-readiness assessment.

## Findings

One confirmed defect was repaired: an exception while calculating net-second server claims was caught and converted to an empty claim list. The caller therefore could record a successful tick pass instead of entering its normal failure, backoff, and diagnostic path. The exception now propagates to that existing caller path; no production formula, capacity, persisted field, or data was changed.

The four requested names do not represent four independent automatic counters. Sauce and Frontline share the live Sauce Recipe flow. Dough has its own tray, batch, and mixer-related clocks. Packaging tracks cases and skids. This distinction is preserved below.

## End-to-end ownership and acknowledgment

1. **Scheduling and local edits:** `lib/live-calc/src/autoTrackSchedule.ts` derives due work from the selected run, current lifecycle state, operational values, and the relevant timing domain. The client hook schedules only eligible work and carries the selected run identity through queued claims. Manual corrections update the canonical run values and the applicable correction or manual-override fences.
2. **Claim and persistence:** The sync claim route validates the run, date/reset epoch, generation, sequence, event identity, baseline stamp, correction generation, and mutations. Claims are serialized against canonical sync state and recorded transactionally with their event receipt and sync outbox effects. Server ticks build net-second claims for Sauce and applicator registers, and wall-clock claims for cases, Dough, and related production stages. The active `LiveRunProvider` sets `authoritativeServerAutoTrack`; the browser hook therefore does not optimistically write automatic progress.
3. **Canonical acknowledgment:** An accepted or duplicate claim is the successful acknowledgment. The client adopts returned canonical values or the next canonical sync update. A stale/conflicting event is not success. In the client compatibility path, Sauce-barrel conflicts retire the rejected identity, adopt canonical values, and wait for explicit retry. Non-OK transport responses are not acknowledgments.
4. **Peer and wake adoption:** Peer updates are scoped to the sync date and canonical stamps. The foreground wake guard waits for a fresh canonical adoption before releasing writes. Server-owned counts do not accumulate a browser-side offline delta for later replay. Run identity and reset epoch fence delayed work from an earlier run or day.
5. **Failure handling:** Compatibility-path browser claims retain retry identity across a transport retry; server tick failures use per-date backoff and diagnostics. Accepted work is not intentionally re-applied as a new event. The repaired scheduling exception now reaches the same server failure path instead of being treated as an empty successful pass.

## Tracker comparison

| Tracker | Source of truth, unit, and cadence | Limits and run-state gates | Manual correction, lifecycle, and cross-device behavior | Retry, acknowledgment, errors, and visible guidance |
|---|---|---|---|---|
| **Sauce** | Two distinct registers: whole `sauceBarrelsMade` production, scheduled by net run seconds and Sauce depletion timing; and `sauceStockBarrels`, a separate stock register depleted fractionally using Sauce ounces per pizza and line speed. Canonical run values and per-channel coordination state are synchronized through `/api/sync`. | Barrel production stops at `ceil(computeSauceRunRequirement(...).totalUnits)`. Stock capacity is two barrels; stock depletion does not create a second barrel-production counter. Both are gated by a live, unpaused run and `pressDone`; stock depletion also requires stock and a valid cadence. | Manual Sauce changes are fenced by correction generations and canonical stamps. Net-time scheduling excludes paused/stopped production time. Run switches and reset epochs invalidate stale claim responses. Wake adopts canonical state before writes resume. | Server-owned net-second claims use the shared claim receipt/outbox path. The staff alert with retry/dismiss is for Sauce-barrel client-claim failures in the compatibility path; the active provider uses server ticks, whose backoff is visible to managers. Server-owned failures do not become local catch-up increments. |
| **Dough** | Tray consumption/production, batch consumption/production, and hopper timing use separate wall-clock intervals derived from line rate, tray/batch needs, and mixer/hopper timing. Values remain trays, batches, and the existing hopper measure; they are not collapsed into Sauce net seconds. | Requires an eligible live run and incomplete press supply. Run pauses and recorded stoppages are excluded from elapsed work. Staged batch production retains its existing maximum-three behavior; an already-higher stored count is not clamped by this audit. | Dough timers have their own pause/resume controls, independent of Packaging. Resume re-arms a full interval rather than replaying paused elapsed time. Run identity fences queued work; foreground recovery adopts canonical run state before writes resume. | Server wall-clock claims persist canonical outcomes. The scheduler has a bounded client compatibility fallback when server ownership is absent or expired, but the active provider remains server-authoritative. Failed server work retries through the existing backoff and manager diagnostics. There is no separate Dough-only staff retry banner. |
| **Frontline** | There is no independent Frontline auto-track claim channel in the current live scheduler. “Frontline” is the live Sauce Recipe path; its recipe and ingredients do not create another automatic production counter. | Sauce production gates and Sauce register limits apply. Applicator slots (`app1`–`app4`) are separate channels and are not an independent Frontline counter. | Recipe/run values follow the normal canonical sync and run-switch fences. Corrections to Sauce registers use Sauce correction handling; no Frontline-specific timer or correction generation is introduced. | Recovery follows the Sauce path. No separate Frontline retry or acknowledgment is generated. |
| **Packaging** | Case and skid counters use wall-clock case cadence based on line speed and pizzas per case. Packaging progress is stored separately from Sauce and Dough production registers. | Automatic case progress is demand-capped when `casesNeeded` is positive. A valid positive pizzas-per-case value is required for case-based need. After run end, only the existing freezer/tunnel drain window can advance cases; the drain is bounded by `freezerTime`. The server also preserves the existing permitted paused-drain behavior; ordinary paused production does not become a catch-up interval. | Packaging corrections have their own progress/correction and manual-override fences so a stale automatic snapshot cannot replace an operator correction. Run switching and canonical stamps prevent another run from adopting that correction. Wake/offline recovery waits for sync; there is no hidden-time replay. | The UI shows “Syncing automatic count…” or “Automatic count paused — waiting for sync” while coordination is not ready. Server failures use automatic retry/backoff and manager diagnostics; there is no separate staff “retry tick” action. |

**Dough corrections:** Manual tray/batch edits suppress automatic writes and re-arm the affected timer baseline. Canonical run stamps and run identity prevent an older completion from replacing the correction.

### Shared rules versus station-specific rules

The common reliability contract is run identity, date/reset fencing, per-channel event identity and sequence, canonical response adoption, correction-generation protection, durable server idempotency, and wake/adopt-before-publish. A retry of accepted work retains its event identity; a rejected stale event cannot be mistaken for an acknowledgment. The active web provider is server-authoritative and remains read-only for automatic progress while offline; it does not turn hidden time into a local delta. The scheduler also retains a bounded client-fallback path for contexts that do not enable server-authoritative auto-tracking. That compatibility path must not be confused with the active provider's ownership policy.

The cadence, units, caps, and stages remain station-specific: Sauce uses net production time and its separate barrel/stock registers; Dough retains tray, batch, mixer, and hopper timing; Packaging retains case/skid and drain timing. Frontline does not get a fabricated fourth cadence. No formulas or physical production rules were changed.

## Repair and regression coverage

**Repair:** `artifacts/api-server/src/lib/autoTrackServerTicks.ts` no longer suppresses exceptions from `schedule(payload, nowMs)`. `artifacts/api-server/src/lib/autoTrackServerTicks.test.ts` asserts a scheduling exception propagates. The API tick runner already owns failure recording, backoff, logging, and manager diagnostics.

| Verification | Result |
|---|---|
| Live calculation schedule/engine tests | **PASS** — 25 tests across 5 files. |
| Run-calculator lifecycle, applicator, Sauce barrel, screen-wake, server-schedule, foreground-wake, sync-response, and blank-run tests | **PASS** — 130 tests across 8 files. |
| API auto-track coordination and server-tick tests, including the new exception regression | **PASS** — 48 tests across 2 files. |
| Focused API sync claim/correction integration cases | **PASS** — 14 selected cases; 156 unrelated cases skipped. Covers competing claims, duplicate retry, correction fences, reset epoch, transaction rollback, Sauce stock correction, and Packaging correction. |
| Isolated two-process sync convergence suite | **PASS** — 11 cases; `sync-convergence status=passed`, elapsed 79.7 seconds. |
| Isolated browser wake/retry flow | **PASS** — 2 cases. Two sessions converge after offline wake with visible retry; cancellation does not replay a pre-wake write. |
| Browser compatibility configuration | **PASS** — 8 emulated cases across Chromium desktop, phone, tablet portrait, tablet landscape, and WebKit phone/tablet projects. |
| API-server typecheck | **PASS** — DB, API Zod and integration declarations; API TypeScript; route typecheck. |
| `git diff --check` | **PASS**. |
| API development workflow restart | **PASS** — server started and sync outbox listener connected. |

The API-server package-wide test suite and full release suites were not run: this was a localized API repair, and focused unit, integration, convergence, browser, and package type checks covered the changed boundaries. All test databases used by integration and browser runs were disposable local fixtures.

## Browser compatibility record

| Browser target | Viewport/project | Result |
|---|---|---|
| Chromium | Desktop | **PASS** |
| Chromium | Phone-sized emulation | **PASS** |
| Chromium | Tablet portrait emulation | **PASS** |
| Chromium | Tablet landscape emulation | **PASS** |
| Playwright WebKit | Phone-sized emulation | **PASS** |
| Playwright WebKit | Tablet emulation | **PASS** |
| Two-session wake/retry | Desktop Chromium context plus phone-sized Chromium peer | **PASS** |
| Physical Android Chrome | Physical device | **NOT RUN** |
| Physical iOS Safari/PWA | Physical device | **NOT RUN** |

The browser results are emulation only. Playwright WebKit is not evidence from physical iOS Safari or an installed iOS PWA; no physical-device behavior is inferred.

## Failure and blocker ledger

| Item | Evidence and boundary | Resolution / risk | Owner and next action |
|---|---|---|---|
| **Product defect: server schedule exception hidden as an empty claim list** | A throw from `schedule(payload, nowMs)` was caught inside net-second claim construction. That prevented the tick caller from reaching its failure/backoff/diagnostic path. | **FIXED.** Exception now propagates; regression is covered by the 48 passing API service tests. No remaining defect at this boundary. | Current task owner; none. |
| **Convergence fixture omitted a required recipe route** | Initial isolated process returned `404` for `/api/dough-recipes`, so the intended master-data fanout assertion did not reach the route. | **FIXED.** The child process fixture mounts the route actually exercised by the test; all 11 isolated cases pass. | Current task owner; none. |
| **Convergence fixture omitted public readiness routing/order** | Initial isolated process returned `401` for `/api/readyz` because the minimal fixture did not mirror the public health route order. | **FIXED.** The fixture mounts the health router before auth; all 11 isolated cases pass. | Current task owner; none. |
| **Convergence child and case timeouts were too short for isolated startup** | The process failed the original 20-second child-start deadline; the subsequent case also exceeded 30 seconds while bringing up isolated processes. | **FIXED in test harness.** The minimal process fixture and 45-second child/120-second case bounds let the same test complete. Final run passed in 79.7 seconds. | Current task owner; none. |
| **Isolated setup output was hidden, making setup stall diagnosis difficult** | A synchronous schema push captured output instead of streaming it; a direct disposable-schema probe succeeded. | **FIXED in test harness.** Setup now inherits output, and the isolated suite passes. | Current task owner; none. |
| **Pinned Node bootstrap delayed test start** | The release runner selected its `npx` provisioning path even though pinned Node 24.21.0 was already present in the Nix store; one command hit the shell time limit before tests began. | **RESOLVED for verification.** The unchanged runner was invoked with the installed pinned Node first on `PATH`; this was a runtime-selection issue, not a product or test assertion failure. | Validation environment; select the installed pinned runtime before retrying this command. |
| **Nonfatal WebKit host-dependency warning** | Playwright printed a host package warning during WebKit setup; the repository's Nix WebKit wrapper launched successfully and all 8 compatibility cases passed. | **No failing check remains.** Warning is recorded; no OS-wide dependency change was made. | Current task owner; none. |
| **Release evidence status outside this task** | An existing `release:standard` workflow log reported missing published release evidence and that no release gates ran. This audit did not invoke or rely on that workflow. | **BLOCKED / NOT A TASK GATE.** Release readiness is not assessed here, as required by task scope. | Release owner; generate the required evidence and run release checks only in a separately authorized release task. |

## Scope and limitations

No production operational data was queried or changed; no data heal, live reset, authored schema/data change, publish, or release-readiness decision was performed. The API workflow restart was the configured development workflow and ran its existing schema-startup check. Browser/integration suites used isolated local test databases. The emulated browser matrix passed, but physical Android/iOS testing remains unverified.
