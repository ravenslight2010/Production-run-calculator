# Sync and automatic tracking: integrated evidence baseline

## Decision for the owner

**Assessment complete; production reliability remains unproved. This is not a release GO.**

The architecture already has the right main boundaries: server-owned production
progress, transactional commands and claim receipts, canonical snapshot fencing,
durable cross-process delivery, and adoption before a waking browser can write.
Replacing these with browser catch-up, another transport, or faster retries would
not address the evidence presently missing.

The highest-priority unresolved outcome is **why published background work stalls,
and whether the integrated repairs prevent recurrence**. Historical resource
observations establish degradation, not its initiating cause. Recent fixes establish
specific repaired paths, not a resolution of every report with similar symptoms.

Two concrete inconsistencies remain in this inspected source: background alerts and
the manager sync-health projection still select by device index rather than the
canonical live lifecycle. The alert repair already has an owner. The health
inconsistency merits a bounded functional correction after approval; it is not
evidence that production counters themselves use the wrong run.

### Provenance and scope

- Inspection and primary-source retrieval: **2026-10-26 UTC**.
- Inspected application source: **`f71e12248feeeecaad7769949a96ceb9850a93a7`**.
  The tree was clean at intake. This document and the bounded checks below are
  additional work against that source, not a claim about the published revision.
- Evidence classes: source inspection; newly executed isolated unit/hook fixtures;
  retained reports of earlier disposable HTTP/convergence/browser checks; independent
  primary engineering documentation. No production access was used in this assessment.
- Task updates report the database health and alert repairs merged.
  Neither update changes this fork's inspected HEAD. Do not assume their code is
  included; reconcile their actual merged source before using this as a later baseline.
- No application, schema, data, dependency, workflow or production-rule change.
  No production write/read, load test, cache clearing, retained-work replay, publishing,
  physical-device session or full release/browser suite was performed.

### How to read classifications

| Code | Conclusion class | Meaning |
| --- | --- | --- |
| IE | Implemented and evidenced | Executed here at the stated layer on the inspected source; not production proof |
| IN | Implemented but not evidenced on the current integrated revision | Source and/or older focused checks exist; current end-to-end outcome not established |
| CD | Confirmed defect | A directly established contradiction at a named boundary; scope stated separately |
| SD | Suspected defect | Plausible failure path without sufficient reproduction |
| HE | Historical evidence only | Retained result belongs to its original source/conditions |
| ID | Intentionally different behavior | Different physical or ownership semantics are required, not inconsistency |
| BU | Blocked/unknown | Evidence unavailable, not collected, contradictory or insufficient |

`PASS`, `FAIL`, `BLOCKED`, `NOT REACHED`, `MISSING` and `NOT RUN` describe
checks, not these conclusion classes. A test's existence is not an executed PASS.

## 1. Research chronology and evidence index

Links below are the retained records, not fresh certifications. Where a report lacks
an exact executed Git revision, its last-edit commit identifies the document only.

| Record | Original contribution / later reconciliation | Binding and present use |
| --- | --- | --- |
| [Auto-track coordination research](autotrack-coordination-research.md) | Early coordination design, fencing and ownership discussion | Historical design. Its 11-channel inventory and broad correctness language are not current proof; see claim review below |
| [Sync deep dive, September 19](sync-deep-dive-2026-09-19.md) | Corrected full-document-only claims: sparse PUT and conditional partial SSE already exist | Historical contract description; complete recovery and base identity remain relevant. Its revision description is now stale |
| [Unified plan, reconciled October 8](sync-reliability-unified-plan-2026-09-19.md) | Causality, wake ordering, measurement, topology and capacity decisions | Separates implemented controls from deployment evidence; not a present release authority. Its ordinary-write revision claim is superseded |
| [Improvements plan](sync-system-improvements-plan.md), [operations research](../research/sync-reliability-operations-deep-dive-2026-09-19.md), [payload research](../research/sync-payload-research.md) | Optimization and operating hypotheses | JSON Patch/selective reads remain proposals; do not re-propose implemented sparse sync as absent |
| [October 19 reliability audit](auto-track-sync-reliability-audit-2026-10-19.md) | Exception propagation repair; station distinctions; transaction, convergence and emulated browser passes | HE: scoped result with its own fixture ledger, no current exact execution revision established by that report alone |
| [October 19 recovery performance](sync-recovery-performance-2026-10-19.md) | Priority wake lane, completion-driven retry, 503 handling, coalesced outbox drain, later-wake invalidation | HE: base `83f122731c0d7c8a1e9adf3e1579bf803de5839a` plus repairs, not an immutable final tested commit. Numeric baseline in §6 |
| [Packaging recovery](evidence/packaging-tracking-recovery.md) | Generation-bound Resume, no held-time replay, one reconstructed partial receive, all-station continuity | HE: pre-rebase eight-project browser matrix explicitly distinguished from subsequent canonical checks. Last document edit `fcd01a57e6c1c6d05d8f6084a446af59beaf9cc8` is not the matrix's revision |
| [Server authority](server-live-state-authority.md) | Command-owned lifecycle/counters, canonical retries, owner/session fencing, scoped review, End atomicity | HE/IN: 189 transaction and 11 convergence cases reported, plus bounded browser segments and retained failures. Last document edit `df2b972bf819ebbb8694966810f8b450225da6a1` does not bind every earlier pass |
| Sequential Packaging source, commit `a5ad7f1f8` | Worker selection uses lifecycle, not device selection; five-run regression in [freezer-surplus.spec.ts](../artifacts/run-calculator/e2e/freezer-surplus.spec.ts) | IN: integrated source and test inspected, not newly run. Five-run test is Packaging-focused, not all-channel two-device certification |
| [Shared station identity](shared-live-station-run-identity-verification.md), implementation commit `ee485962e` | Canonical shared calculation/projection selector and projection freshness | HE/IN: reported library, HTTP/SSE and provider checks. Preview session blocked; no new browser evidence implied |
| [October 24 runtime evidence](evidence/published-runtime-reliability-2026-10-24.md) | Confirms background degradation; distinguishes pool, request and loop timing | HE: its serving-build tuple, not this checkout. Trigger inconclusive |
| [October 26 stalls](evidence/production-stalls-2026-10-26.md), diagnostic commit `87868875e` | Prospective outbox SQL-phase sampling; primary snapshots and loop/acquisition overlap | HE/IN: instrumentation locally verified, production effectiveness NOT RUN; runtime/platform build-status contradiction retained |

### Claim-by-claim documentation review

Input scope: documents above compared with this checkout, not rewritten. Confidence
is high for direct source contradictions, medium for unexecuted integration outcomes.

| Claim identifier | Review label / confidence | Evidence and corrected scope |
| --- | --- | --- |
| September deep dive and October unified plan: ordinary day-state PUT retains revision | **contradicted / high** | `sync.ts:upsertProtected` now increments `canonicalRevision` when canonical snapshot content changes; repeats retain it. Existing integration case “advances revision for accepted changes and not for idempotent repeats” asserts this. No new transaction execution claimed |
| Coordination research: 11 independent channels | **contradicted / high** | `AUTO_TRACK_SCHEDULE_CHANNELS` lists 20, including physical stock consumption channels; inventory in §4 |
| Coordination research: generation is a textbook monotonic fencing token | **partially verified / high** | Claims compare exact canonical lifecycle generation and sequence. Generation includes run identity and lifecycle stamp; this does not establish a general monotonic distributed-clock guarantee |
| Coordination research: already-correct distributed protocol | **unsupported / high** | Current tests support bounded contracts; retained subsequent defects and missing integrated/production evidence preclude this broad claim |
| Existing partial PUT and partial SSE, with complete fallback | **verified / high**, implementation scope | Under-lock base check and per-peer delta/full broadcaster exist. Not selective per-run reads and not RFC 6902 |
| October 19 performance: small-fixture latency was fast | **verified / medium**, historical-report scope | Retained distributions and conditions support that historical statement only, not current production speed |
| October 26 instrumentation means the production stall is repaired | **unsupported / high** | The stalls report explicitly says prospective diagnostics, initiating workload and causal chain missing |

Counts: 2 verified, 1 partially verified, 2 contradicted, 2 unsupported;
0 stale-suspected, 0 needs-human. Release provenance itself remains BU, not an
additional factual claim silently accepted. The two contradicted old descriptions
must not guide a new protocol change.

## 2. Independently checked primary sources

Retrieved directly on October 26, not merely copied from earlier project research.
Principles are engineering constraints, never implementation test results.

| Primary source | Applicable principle | Real producer → consumer boundary / conclusion |
| --- | --- | --- |
| [MDN Page Visibility](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API) | Background timers are throttled; callback counts are not durable elapsed production | `LiveRunProvider` enables server authority → `useAutoTrack` suppresses browser automatic mutations. IE at hook layer, IN for physical sleep |
| [Chrome Page Lifecycle](https://developer.chrome.com/docs/web-platform/page-lifecycle-api) | Frozen tasks stop; discard has no callback; hidden can be last reliable save transition | Scoped outbox persistence → cold/wake adoption, not unload-only delivery. IN for actual mobile OS suspension |
| [MDN SSE](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events) | Reconnect/event IDs are transport features; HTTP/1 connection limits differ from HTTP/2 streams | `connectSse` open/error → baseline gate, complete initial frame and recovery GET. Opening the stream does not certify peer adoption. No assumption of browser Last-Event-ID replay: this app's durable process cursor and canonical recovery are separate |
| [PostgreSQL NOTIFY](https://www.postgresql.org/docs/current/sql-notify.html) | Delivered after commit; identical transaction notifications can fold; long transactions delay delivery | Canonical transaction → `appendSyncOutboxEvent` row/cursor/`pg_notify` → ordered listener reads. NOTIFY carries a hint, not the canonical event |
| [PostgreSQL LISTEN](https://www.postgresql.org/docs/current/sql-listen.html) — expanded review | Subscribe/commit before initial state inspection to avoid initialization races | Listener attaches handlers, awaits LISTEN, then reads cursor state and drains. New-process seeding assumes no existing peers; established process cursors survive reconnect. Existing gap callback must succeed before advancement. Source + mocked recovery IE, actual restart/peer race IN |
| [AWS idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/) | Caller intent ID and effects must be atomic; same ID/different intent rejected; late retries matter | Manual-section / operational command identity checks → locked ledger/canonical row/outbox → current canonical response. IE for pure exact-identity comparison; atomicity remains historical transaction evidence |
| [AWS timeouts, backoff, jitter](https://builder.aws.com/content/3EumjoZascWd1oZiEgL8ORlv3qE/timeouts-retries-and-backoff-with-jitter) | Retry can amplify overload; timeout does not establish no effect; spread retries and bound ownership | One browser queue and wake guard → three automatic timer retries; outbox/date backoffs use jitter. Preserve original command identity after uncertain receipt; terminal review is not a network retry |
| [Google SRE monitoring](https://sre.google/workbook/monitoring/) | Percentiles and dependency boundaries expose tails hidden by averages | Queue/debounce → HTTP receipt → canonical merge → peer adoption versus SQL acquisition/lock/read/outbox phases. Missing per-operation correlation remains BU |

Retrieval note: the older AWS timeout URL returned no substantive matching article
text; the Builder URL above returned the article and was used. Chrome's first
response was truncated; a continuation supplied the hidden/discard guidance.
No source was treated as fully read beyond retrieved sections.

## 3. Source boundaries and shared contract

Paths identify maintained code at the inspected revision. Symbols are more stable
than line numbers; this is a bounded trace, not an assertion that every caller is
covered by the newly executed tests.

| ID | Boundary | Source / important distinction |
| --- | --- | --- |
| S1 | Bulk setup publication | [sync.ts](../artifacts/api-server/src/routes/sync.ts), `upsertProtected`: reset row before daily-row lock; complete and partial snapshot preconditions; operational-authority protection; revision increment on change |
| S2 | Manual physical corrections / Packaging Resume | Same file, `/sync/manual-section`: section allowlist, complete baseline, lifecycle/reset fence; exact actor/device/base/payload retry; receipt, state and outbox in transaction. Acquired/released notices are advisory, not correction receipts |
| S3 | Start/Pause/Resume/End and controls | Same file, `/sync/operational-intents`; [operationalIntentOutbox.ts](../artifacts/run-calculator/src/operationalIntentOutbox.ts): durable scoped request, explicit outcome, review retention; End finalization remains transactional |
| S4 | Automatic producers | [autoTrackServerTicks.ts](../artifacts/api-server/src/lib/autoTrackServerTicks.ts), `selectTrackingRun`, net/wall builders; [autoTrackSchedule.ts](../lib/live-calc/src/autoTrackSchedule.ts); [autoTrackEngine.ts](../lib/live-calc/src/autoTrackEngine.ts). `sync.ts:runAutoTrackServerTicks` executes under the canonical claim path and commits bookkeeping |
| S5 | Claim arbitration | [autoTrackCoordination.ts](../artifacts/api-server/src/lib/autoTrackCoordination.ts) and `/sync/auto-track/claim`: run/channel/generation/sequence/event/base/correction validation; only accepted/duplicate canonical outcomes acknowledge work |
| S6 | Durable delivery | [syncOutbox.ts](../artifacts/api-server/src/lib/syncOutbox.ts): per-scope cursor allocation serialized transactionally, commit notification, periodic fallback, drain coalescing/backoff, canonical gap recovery before cursor advancement |
| S7 | Peer adoption | `sync.ts:broadcast` and [home.tsx](../artifacts/run-calculator/src/pages/home.tsx) receive path: reconstruct partial once, validate canonical identity, session/revision checks; HTTP sender adopts its response, not its own SSE echo |
| S8 | Wake / queue | [useHomeSyncCoordination.ts](../artifacts/run-calculator/src/hooks/useHomeSyncCoordination.ts), [foregroundSyncWakeGuard.ts](../artifacts/run-calculator/src/foregroundSyncWakeGuard.ts): client-date no-store pull, priority lane, boundary invalidation, adopt before release, single in-flight queue |
| S9 | Display versus progress | [LiveRunContext.tsx](../artifacts/run-calculator/src/contexts/LiveRunContext.tsx), [useAutoTrack.ts](../artifacts/run-calculator/src/hooks/useAutoTrack.ts): authoritative server flag; local fallback calculation/interpolation is a projection, not persisted automatic progress |
| S10 | Shared read selection | [canonicalLiveRun.ts](../lib/live-calc/src/canonicalLiveRun.ts): latest started/unended including paused, else latest ended, else first pending. Never borrow another run's values |
| S11 | Divergent diagnostic/alert consumers | [syncHealth.ts](../artifacts/api-server/src/lib/syncHealth.ts) selects `currentIndex ?? 0` for projection health; [webPush.ts](../artifacts/api-server/src/lib/webPush.ts) does so at candidate/arming/delivery boundaries |

### C0 — rules inherited by every channel in the matrix

1. **Ownership/selection:** server owns automatic mutations. S4 chooses the latest
   eligible running lifecycle with values, not the operator's selected tab. With
   no running run it may choose an eligible paused/ended Packaging drain.
   S10's broader *display* selector intentionally differs: paused and expired-ended
   display does not authorize production. A running run takes priority over an
   older drain; no assertion that both are tracked simultaneously.
2. **Identity and caps:** claims bind run ID, lifecycle generation, channel, sequence,
   event ID, baseline and applicable correction generation. No brand/product/date-only
   identity. Six-hour lifecycle lookback/replay eligibility is a bounded server policy,
   not permission for browser offline catch-up. Demand/capacity/initialization remain
   channel-specific. A 15-second default worker beat is not a one-second persistence
   promise or an end-to-end latency target.
3. **Corrections/lifecycle:** S2/S3 own physical counters and lifecycle, not generic
   snapshots. Correction generations, holds, anchors and worker arms must change
   coherently. Pause excludes stopped production; rearm must not replay held time.
   Exact channel details below override any superficial “all timers are identical” rule.
4. **Retries/ack:** same uncertain command retains exact identity; changed intent is
   a new reviewed action. A non-OK response, local render, connection open, queued
   request or worker diagnostic is not an acknowledgment. Duplicate receipt must not
   rewind a newer correction. Server tick bookkeeping and claims have their own
   transactional recovery, not a browser-created compensating delta.
5. **Peer/recovery:** S6 durable read → S7 canonical adoption; S8 recovery releases
   writes only after current canonical state. Session/account/scope/date/reset and
   canonical-revision fences must reject late results. A fresh setup form is not a
   canonical live counter receipt.
6. **Operator action:** while offline/projected/recovering, retain the request and
   wait for canonical recovery; use the existing sync retry when available. A terminal
   rejection needs review against current counts, not repeated unchanged replay.
   Never recommend a reset, cache clear, run restart or second correction as a
   connectivity workaround.

## 4. Station/channel contract matrix

All rows inherit C0, including exact retry, canonical acknowledgment, peer adoption,
scope/reset and next-run fencing. There are **20 channels**, not four counters or
eleven channels. Paired columns list both channels explicitly; no pepperoni variant
is omitted. Physical line-phase timers and activity confirmations are read models/
explicit evidence, not additional auto-progress channels.

| Station / exact channels | Unit, time and eligibility/cap | Correction, pause, stop/drain, next-run behavior | Evidence / recovery guidance beyond C0 |
| --- | --- | --- | --- |
| Packaging: `case` | Cases folded into skids/remainder; wall-clock case cadence, valid pizzas-per-case, demand cap when positive; physical freezer-aware output | Packaging correction generation/hold; Resume shortens canonical hold without changing counts/generation; expiry/Resume rearms a full case period. Only this channel may progress in eligible paused/ended drain. Later active run chosen by lifecycle | IE builder correction/selection; IN canonical/browser integration. “Syncing automatic count…” / waiting-for-sync state is not a receipt |
| Dough: `tray-consume` | Trays consumed by line rate; wall-time/fractional remainder and supply constraints; no production after press done | Dough correction invalidates/rearms relevant channel; global or independent Dough hold excludes pause gap; no ended drain | IE builder subset; IN complete consumption journey. No separate staff retry-tick banner |
| Dough: `tray-produce` | Tray production interval distinct from tray consumption; staged/run-need constraints | Same Dough command/lifecycle fences; fresh rearm, not hidden-time burst; no ended drain; new run has own arm | IE builder subset; IN all states/peer rendering |
| Dough: `batch-consume` | Batches consumed; per-batch supply and elapsed wall-time, separate fractional carry | Correction/hold rebase; no ended drain or prior-run carry of accepted events | IE builder subset; IN integrated workflow |
| Dough: `batch-produce` | Batches ready; mixer timing, run-need cap, existing staged maximum-three policy (not a clamp on historical higher values) | Canonical timed/manual Dough hold/release; no held-time replay; crust mode is not dough-batch production | IE builder subset; IN complete timer-control journey |
| Dough: `hopper` | Hopper timing/engine event; own spin/hopper domain, not a case or Sauce clock | Dough hold/rearm; live eligibility, no Packaging drain eligibility inherited | IN full persisted/UI hopper outcome; scheduler inventory alone does not establish it |
| Sauce / named Frontline Sauce Recipe: `sauce-barrel` | Whole barrels made; net production seconds; positive conversion/cadence, press not done; ceil(run Sauce need) cap | Sauce correction generation/anchor; paused/stopped production excluded; no ended drain. Inventory effect belongs to accepted canonical transaction; missing mapping must not stop unrelated channels | IE builder subset; HE transaction continuity. Compatibility Sauce retry/dismiss alert is not the active server-worker recovery control |
| Sauce: `sauce-stock` | Separate fractional barrels on hand, maximum two; net-second depletion from oz/pizza × speed. Initialization/migration state distinct from made count | Own stock correction baseline/generation; no negative stock or extra fabricated made barrel; pause/End stop production depletion | IE builder subset; IN current integrated inventory/peer effect |
| Applicator 1: `app1-batch`, `app1-stock` | Batch made/fill and pounds on line/consumed are separate registers; net seconds, recipe/effective batch weight, valid case demand, initialized stock; capacity no more than two effective batches and physical capacity | Slot correction rebases stock and batch coordination; historical made is not current stock. Global pause/press-done/End gates; no Packaging drain | IE builder tests include all four slots and fractional final load; IN current end-to-end peer workflow |
| Applicator 2: `app2-batch`, `app2-stock` | Same contracts with slot 2's own recipe/weight/cadence/need | Slot 2 identity/correction; never borrow slot 1 values; C0 handoff | IE builder subset; IN integrated |
| Applicator 3: `app3-batch`, `app3-stock` | Same contracts with slot 3's own physical configuration | Slot 3 identity/correction; paused/ended no depletion claims | IE builder subset; IN integrated |
| Applicator 4: `app4-batch`, `app4-stock` | Same contracts with slot 4's own physical configuration | Slot 4 identity/correction; no universal batch cadence | IE builder subset; IN integrated |
| Pepperoni primary 1: `pep1-stock` | Physical pounds on line and cumulative consumption; net-second stock cadence; initialized stock, positive demand/conversion | `pep1` manual section owns related registers; correction/anchor generation; no independent automatic batch-production channel | IN current full outcome; existing stock/section tests, not a new browser PASS |
| Pepperoni alternate 1: `pep1b-stock` | Own alternate stock/oz rate; not interchangeable with primary | Same section, distinct stock register; C0 lifecycle/peer rules | IN; must be included when variant configured |
| Pepperoni primary 2: `pep2-stock` | Own physical stock consumption in pounds; same valid-input gates | `pep2` section; no invented made counter or ended drain | IN |
| Pepperoni alternate 2: `pep2b-stock` | Own alternate register/rate; same valid-input gates | Same section, distinct identity/anchor; C0 handoff | IN |

**ID:** Frontline is the Sauce Recipe terminology, while the physical Frontline
surface also presents applicator/pepperoni stock. This does not create a
`frontline` claim channel. Press/Oven/Frontline/Tunnel/Packaging phase countdowns
are projections; Tunnel/Warehouse activity requires explicit confirmation rather
than inference from counter edits.

## 5. Full journey and existing coverage before new work

Source-of-truth routing: pure schedule/engine for arithmetic; transaction suites
for receipt/state/outbox atomicity; convergence for independent processes; provider/
browser for visible adoption and controls. No browser is needed to prove SQL lock
ordering, and no pure test proves an actual sleeping phone recovered.

| Journey boundary | Existing coverage inspected / retained result | Current conclusion and exact remaining proof |
| --- | --- | --- |
| Start once; all eligible trackers begin | `sync.integration.test.ts` operational transitions; server-authority record; auto-track builder tests; five-run browser source | IE pure producers; IN integrated Start→all 20 applicable channels on this revision. Avoid double-counting disabled/unconfigured channels as failures |
| Connected edit, correction, second device | Manual-section and claim groups in `sync.integration.test.ts`; Packaging recovery matrix; `syncWriteResponse.test.ts` | IE response/identity subset; HE browser peer correction. Current multi-device canonical adoption latency MISSING |
| Correction hold, automatic expiry and explicit Resume | Packaging recovery report; server builder and coordination tests; section route | IE builder rebase; HE canonical cases/browser. Need exact one first case with retained correction, not a poll that misses the first transition |
| Offline/background/reconnect | `foregroundSyncWakeGuard.test.ts`, `useAutoTrack.serverSchedule.test.tsx`, outbox tests; [browser convergence/recovery spec](../artifacts/run-calculator/e2e/sync-convergence.spec.ts), [screen-off wake spec](../artifacts/run-calculator/e2e/screen-off-wake.spec.ts) | IE hook/guard/outbox boundaries; HE browser recovery timings; physical OS sleep NOT RUN |
| Pause/Resume, separate Dough hold, tunnel policy | Authority browser continuations; Packaging recovery; timer-control tests; schedule/engine | ID different timing domains; IN full current run/peer outcome. Paused Packaging drain must not authorize Dough/Sauce/applicator output |
| End, history/inventory, drain | Atomic finalization groups in integration suite; authority End/zero-surplus receipts; five-run spec | HE transactional/browser evidence; IN current complete End/drain outcome; never infer accepted End from HTTP 200 alone |
| Next run; repeated same product and date | Five-run spec seeds the same brand/flavor on distinct run IDs and asserts each Start/progress/End/none receipt; builder prior-run failure case | IE builder fence; IN combined five-run/all-channel two-device journey. Product/date must not collapse run identities |
| Late reply from prior run or earlier correction | Builder “rejects a failed prior-run claim and rearms a new run”; response obsolete-revision case; authority session/duplicate ledger; Packaging selected-run change | IE selected pure cases; HE targeted browser; IN combined delayed response during same-product next-run handoff |
| Retained rejection, reload, account/sandbox handoff | `operationalIntentOutbox.test.ts`; authority scoped review/browser ledger; section error handling | IE outbox subset; HE real logout/sandbox/return segments. Cold unverified session can show unavailable state; this is not proof of request deletion |
| Reset epoch, midnight/client date, stale queued snapshot | `syncReset.integration.test.ts`, `sessionBoundary.integration.test.ts`, complete/partial fence groups and convergence | IN current transaction outcome, HE retained passes. Source preserves reset-before-row lock; do not reset shared data to test |
| Lost acknowledgment / duplicate intent / cursor pages | Exact identity unit tests, authority transaction/cursor ledger, convergence suite | IE exact identity/outbox handling; IN actual loss after commit at all channels. Duplicate response uses current facts, original receipt identity |
| Missed notification / expired cursor / listener reconnect | `syncOutbox.test.ts`; `sync.convergence.integration.test.ts`; historical two-process suite | IE mock drain/retention failure ordering; HE real two-process delivery; IN current actual reconnect and peer adoption |

### Newly executed focused verification

These are the only new product checks for this assessment; no new tests were
authored and no application behavior was changed.

```sh
bash scripts/src/run-release-node.sh pnpm --filter @workspace/api-server exec vitest run \
  src/lib/autoTrackServerTicks.test.ts src/lib/syncOutbox.test.ts \
  src/lib/operationalCommandIdentity.test.ts

bash scripts/src/run-release-node.sh pnpm --filter @workspace/run-calculator exec vitest run \
  src/foregroundSyncWakeGuard.test.ts src/syncWriteResponse.test.ts \
  src/operationalIntentOutbox.test.ts src/domain/canonicalOperationalState.test.ts \
  src/hooks/__tests__/useAutoTrack.serverSchedule.test.tsx
```

- **PASS:** API selection, 3 files / 52 tests, 18:49:29 UTC, 2.33 seconds.
  Mocked/isolated tests, no live database. Supports only their builder, exact
  identity and listener scheduling assertions, not a new transaction certificate.
- Client selection result is recorded in the verification closure below.
- Historical pure and transaction passes were reused rather than rerunning all
  transaction, convergence or browser fixtures. No current performance claim
  requires another browser run: the missing current distribution remains explicit.
- Full release remains owned by #3692; no release time limit or coverage threshold changed.

## 6. Connected performance versus recovery

**No new connected-edit or recovery latency samples were collected.** Current
integrated and current production distributions are MISSING, not “unchanged.”
Existing controlled results are useful benchmarks, not a current SLO certificate.

| Population, historical October 19 | n | min / median / p95 / max (ms) | Boundary and errors |
| --- | ---: | --- | --- |
| Browser connected edit canonical acknowledgment | 36 | 278 / 320 / 341 / 418 | Two fixture contexts, one run; canonical PUT value asserted |
| Connected peer canonical adoption | 36 | 284 / 342.5 / 392 / 469 | Peer value, not sender local render; below 2 s in that fixture |
| Healthy wake HTTP canonical adoption | 9 | 65 / 125 / 238 / 238 | Only corrected SSE-closed fixture; below 5 s |
| One injected 503 then canonical retry | 3 | 113 / 116 / 302 / 302 | One failed GET per journey retained; separate degraded population |
| True ten-second client timeout then recovery | 1 | 10,408 / 10,408 / 10,408 / 10,408 | Expected degraded tail, not healthy-target pass |
| Two-process canonical acknowledgment | 10 | 8 / 9.5 / 11 / 11 | Warm loopback API fixture, smaller body; not browser latency |
| Two-process peer frame/value asserted | 10 | 10 / 12 / 16 / 16 | Receiver reads after ack: upper bound on receipt, not render |

Browser conditions: Chromium desktop/phone/tablet portrait/landscape and WebKit
phone/tablet portrait; three no-injected-delay and three +40 ms request-delay
samples per project. This is not 40 ms simulated RTT, a large-facility workload,
Autoscale cold-start or physical mobile network. First sample document-cold/
server-warm; later samples warm. Small n p95 often equals max; no extrapolated p99.

Historical stage samples (overlapping operations, not additional independent
trials): queue/debounce n=61, median/p95/max 121.1/123/126 ms;
request/ack n=61, 27/67/143; merge n=78, 2.9/13/19; peer apply n=17,
8.7/19/19. Do not sum overlapping stages or subtract unrelated populations.
The dispatch-only paired experiment was n=3 each: original median 5,202 ms,
priority lane below rounded-ms resolution. It is not measured whole-app speedup.

### Latency attribution contract

| Stage | Observable boundary | What cannot be inferred |
| --- | --- | --- |
| Browser elapsed lifetime / hidden interval | Visibility/wake and request start/end | A 10 s suspended-page lifetime is not 10 s server execution |
| Queue/debounce | Local enqueue→dispatch diagnostic | Not DB checkout; `serverQueueAgeMs` is not a pure acquisition metric |
| Acquisition | `sync_acquire`, transaction start→callback after BEGIN | Includes pool checkout/BEGIN and scheduling; not pure SQL |
| Lock/read | `sync_lock_read` | Includes round trips/wait; cannot separate lock waiting from execution |
| Transaction / handler | `sync_transaction`, `sync_handler` | Nested overlapping envelopes, not additive independent costs |
| Outbox | Commit cursor→ordered read→handler; sampled fixed SQL phases | SQL read success is not broadcast success, and broadcast is not browser adoption |
| Canonical peer adoption | Receiver has accepted expected run/revision/value | Open SSE/200/heartbeat alone does not establish convergence |

The October 26 production report records acquisition failures of 3.298–25.402 s,
outbox retry notices of 3.402–37.299 s, and event-loop maximum 29.108 s in overlapping
windows. Sparse primary samples showed estimated 433–438 ordinary slots remaining,
one observed lock waiter and one failed sample. These are not current measurements,
unique failed-write counts, a provider outage, sustained capacity exhaustion or
causally paired sync requests. Exact successful-release provenance is contradictory.
Prospective outbox phase instrumentation is IN for production effectiveness.

## 7. Single failure and recurrence ledger

This ledger consolidates outcomes; historical fixture failures remain in their
linked original reports rather than being erased or miscounted as new incidents.

| ID / status | Classification and evidence | Recurrence interpretation | Owner / next action |
| --- | --- | --- | --- |
| F1 — MISSING current production resolution | BU: October 24/26 degradation and missing workload/lock/loop causality; §6 | Similar symptom can have different causes; recurrence not attributable as a regression or incomplete repair | Application operator: bounded, serving-build-bound observation after authorized publication; do not enlarge pool/timeouts |
| F2 — FAIL source consistency at inspected revision, alert consumer | CD at source-selection boundary, not reproduced alert delivery failure; S11 has three index-based reads | Incomplete earlier shared-selection coverage, not proof of server counter regression; task update now says repair merged, but this fork has not adopted it | #3707 owns candidate/arming/delivery repair; use its merged verification, no duplicate code/task |
| F3 — FAIL source consistency, manager health | CD: S11 can derive the first ended run's projection while the actual shared display follows a later active run | Different consumer with similar run-identity symptom, not proof canonical tracking is wrong | Manager diagnostic maintainer, functional approval required: compare health to real GET projection for absent/stale index and later active run |
| F4 — MISSING combined current journey | IN: row-by-row evidence in §5, different revisions and scopes | Cannot classify an unobserved recurrence as old or new | Assessment identifies exact gaps; release owner #3692 retains integrated release evidence, no extra full run here |
| F5 — Historical repair, current outcome unproved | IN/HE: hidden scheduler exception, serialized wake delay, stale later-wake adoption, partial double-apply, Packaging Resume hold | Confirmed earlier causes repaired at their named layer. Another “stuck” count does not prove any one returned | Use relevant regression/phase evidence on actual affected build before labeling regression |
| F6 — MISSING original validation cause | BU: Packaging report's 400 and performance card refer to one request; rejected field absent | Old retained incident, not two new failures; unchanged terminal replay is unsafe | Operations correlate future bounded validation stage/request/build; operator reviews retained request |
| F7 — NOT RUN physical sleep | BU: historical emulation does not exercise actual Android/iOS suspension | OS freeze and network outage may look alike; no inferred common cause | Product operator: consented physical observation when available; no physical-only task manufactured |
| F8 — Historical console evidence MISSING reasons | HE: October 19 report retained 47/33/32 console-error counts, zero page errors and passing targeted assertions | Cannot retrospectively label every console message expected | Future observer retain fixed categories, never raw credential-bearing console dumps |
| F9 — MISSING / contradictory serving provenance | BU: October 26 runtime reports platform artifact listed failed while deployment metadata says successful | Cannot map checkout merges or device screenshot times to successful live build | Release/platform operator reconcile official metadata/runtime identity before causal attribution |
| F10 — PASS focused checks / nonfatal tooling notices | IE API check above; client closure below. npm warns about pnpm-only settings, no code failure | Tool warnings are not production sync incidents | No dependency/runner change; preserve exact command and exit |
| F11 — RESOLVED research lookup limitations | Old AWS URL lacked article text; Chrome truncated; initial guessed manual-hook/health-sentinel paths absent; document check found a nonexistent browser-spec link | Research lookup issue, not app failure | Used returned Builder article/Chrome continuation; located maintained home/outbox/syncHealth boundaries with search; replaced link with existing convergence and screen-off specs |

## 8. Prioritized recommendation and acceptance criteria

One repair order across the system, not separate station repair projects. No
architecture, rule, infrastructure or application change is authorized by this
report. Proposed functional work requires approval; existing owners retain scope.

| Priority / kind | Benefit and evidence | Risk / owner | Acceptance criteria before calling it resolved |
| --- | --- | --- | --- |
| P0 operational evidence | Identify actual stalled phase before guessing; F1/F9 | Unbound builds/aggregates can misattribute cause. Application operator + release/platform owner | Establish actual serving artifact; at most ten minutes/200 sanitized records with truncation/cursor status; separate acquisition, post-checkout, outbox delivery, loop and worker results; unknown lock/workload facts stay unknown. No live synthetic writes/load/replay |
| P1 existing code defect owner | Close alert lifecycle selection mismatch, F2 | Not evidence of count repair; #3707 reported merged, outside inspected fork | Candidate, arm and delivery agree on canonical run; pause/end/next-run, stale candidate and same-product repeats tested; use that owner's result and recheck actual merged source |
| P1 proposed diagnostic correction | Manager health must describe the run operators actually see, F3 | Health false alarms/false reassurance; do not change worker policy or physical math. Manager diagnostic maintainer, after approval | Pure later-active/no-index/stale-index fixture; real disposable health vs GET projection comparison; health GET leaves document/counters unchanged; preserve manager/scope auth and unknown evidence |
| P1 evidence gap, not new architecture | Establish combined journey on one integrated revision, F4 | Expensive duplicate browser runs can obscure revisions; #3692 owns release campaign | Reuse per-layer tests; record one revision/build and per-boundary receipts for Start→applicable channels→correction→wake→Pause/Resume→End/drain→same-product next run with peer and delayed prior response. Count each unreached/failed boundary, not assembled PASS from old reports |
| P2 UX/status consistency review | Staff distinguish server progress, accepted correction and waiting for canonical sync, C0/F5 | Misleading “connected” or a compatibility retry banner can imply worker health. Approved functional scope needed | Use existing state/receipt diagnostics first; exercise offline, recovering, terminal review and accepted outcome; no new banner that treats server ticks as local retryable increments or prompts duplicate correction |
| Not recommended without new evidence | JSON Patch/new transport, universal station clock, broader sparse coverage, pool/timeout increases | Can weaken causality, inflate load or alter production | Only revisit after measured bottleneck and explicit owner decision; preserve complete recovery, reset epoch, exact retries, correction generations, durable cursors and job leases |

For a later **authorized disposable** comparison, reuse October 19's small-fixture
conditions first: six connected edits per named project (three with +40 ms request
delay), three healthy wakes per selected project, then 503 and true timeout as
separate populations. Retain n/min/median/nearest-rank p95/max, ack and peer
adoption separately, every rejection/error category, byte counts and stage numbers.
The historical <2 s connected and <5 s healthy-wake values are comparison targets,
not new product rules. A real worker's first rearmed case has a different timing
budget based on its 15 s beat and configured cadence. Do not silently raise either
budget or repeat a full release suite to collect these samples.

### Compatibility applicability

| Target | This assessment | Retained evidence, not current certification |
| --- | --- | --- |
| Desktop Chromium/Chrome | New browser run NOT RUN: source/report-only work; focused hook fixtures instead | October 19 recovery, authority and Packaging scoped emulated journeys |
| Phone Chromium; tablet portrait and landscape Chromium | NOT RUN: no layout/browser behavior changed | Historical emulation only, with original per-flow limits |
| Desktop/phone/tablet portrait/landscape WebKit | NOT RUN: no new interactive evidence necessary for this source comparison | Packaging all four viewports; authority selected continuations; October 19 latency only phone/portrait tablet |
| Physical Android Chrome, iOS Safari and installed PWA | NOT RUN: no physical device service used | No OS-suspension proof inferred from emulation |
| Native app | Not applicable | Web-only assessment |

### Agent-owned execution and safeguards

The assigned assessment owner owns this report, primary-source comparison, focused
verification and ledger together. Existing database, alerts, break planning and
release work are not re-scoped. No approval was needed for read-only source/public
research or isolated unit fixtures. Changes beyond this report require the explicit
functional/production decision stated above.

Applied task-execution-rules, documentation-claim-review, test-gap-triage,
sync-invariant-check, state-accuracy-check, evidence-hygiene and verify-before-commit.
No sync or timer fields were modified. Public research excerpts were summarized;
no raw production data, payloads, credentials, personal records or large artifacts
are committed. Documentation verification includes local link/source-anchor checks
and whitespace validation. There is no UI artifact change requiring a screenshot,
no service change requiring a restart and no fresh release claim.

### Verification closure

- **PASS:** focused client selection, 5 files / **96 tests**, 18:50:01 UTC,
  12.65 seconds, on the same `f71e12248feeeecaad7769949a96ceb9850a93a7`
  application source. Tests exercise isolated state/hook fixtures, not actual
  peer browsers or mobile suspension.
- **PASS:** API selection, 3 files / **52 tests**, command and timestamp in §5.
  Together these are 148 executed checks, not 148 independent user journeys.
- No new transaction, convergence, browser or performance campaign; no current
  integrated or production PASS inferred from historical results.
- **PASS:** 31 local link targets, all 20 exact channel names, result totals and
  unchanged source HEAD checked by a local Python assertion script; source
  symbols checked against maintained files. The initial missing link was repaired
  (F11). `git diff --no-index --check /dev/null
  docs/sync-tracking-baseline-2026-10-26.md` passed for this new document.
- Final source recheck remains `f71e12248feeeecaad7769949a96ceb9850a93a7`.
  Completion validation, if configured, remains a separate gate, not a substitute
  for these scoped results.

No new project-memory rule was needed: the standing sync-priority, station
semantics and revision-bound evidence constraints are already recorded. Source
inventory and execution results belong in this report, not memory.
The two independent approval outcomes suitable for follow-up are manager-health
diagnostic correctness and post-publication operational observation. Neither
splits this assessment into station variants, changes another task's scope, or
authorizes application/infrastructure changes now. Full release evidence remains
with its existing owner.

Unknown production, physical-device and combined journey evidence above are
deliberate assessment findings, not hidden task passes.
