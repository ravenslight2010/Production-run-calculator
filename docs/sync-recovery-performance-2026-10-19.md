# Sync recovery performance — 2026-10-19

## Outcome and boundaries

**PASS — controlled code-level latency targets and convergence checks.**
No deployment was performed. **Live improvement is NOT VERIFIED.** This is not a release-readiness decision.

The baseline is the merged reliability audit plus base revision
`83f122731c0d7c8a1e9adf3e1579bf803de5839a`. Measurements below used that checkout
with this repair applied, except the explicitly paired scheduling experiment.
They are not measurements of the published app or physical devices.

## Confirmed causes and repairs

1. **Foreground reconciliation shared the serialized background-refresh lane.**
   A foreground signal received during an unrelated profile/factory request
   waited for that request, regardless of the recovery job's ordering.
   Canonical recovery now has an independently dispatched priority lane.
   Its existing guard, adoption barrier, complete-baseline checks and merge
   policies still own concurrency and write release. Background refreshes
   remain serialized; no faster polling was introduced.
2. **Recovery retries depended on a five-second periodic scheduler job.**
   That job could itself wait behind background requests. Transient failures
   now schedule completion-driven exponential backoff, at most three automatic
   timer retries. Success, disposal and permanent HTTP failures cancel the
   timer. Explicit wake/manual signals can retry retained work.
3. **Wake HTTP 503 was classified as permanent.** 408, 429 and 5xx now remain
   transient/retryable; authorization and other permanent 4xx failures do not
   enter an automatic retry loop. The existing ten-second deadline is unchanged.
4. **An outbox notification could be consumed while a drain was already running.**
   The listener now retains one coalesced drain request and services it after
   the active pass. Failed delivery also owns a backoff timer rather than
   unnecessarily waiting for the five-second safety poll. The durable cursor
   still advances only after successful delivery. Missing NOTIFY, retention-gap
   recovery and listener reconnection still retain the periodic fallback.
5. **A successful older recovery could settle a later sleep/wake cycle.**
   The first browser pass reproduced stale adoption during a third rapid wake
   on desktop Chromium and phone WebKit. Recovery attempts now carry a
   sleep/offline-boundary validity check; distinct transitions invalidate older
   attempts, while duplicate signals within a wake still coalesce. Visibility
   boundary invalidation runs before foreground dispatch.

These establish reproducible failure paths. They do **not** establish that any
one path explains the user's particular 30-second production incident.

## Before/after causal measurement

Real elapsed time, three paired samples per policy, visible document, an
independent refresh held for 5,200 ms. The baseline policy is the original
serialized dispatch behavior, exercised by disabling foreground priority in
the same scheduler fixture. This measures **dispatch only**, not convergence:

| Policy | n | min | median | nearest-rank p95 | max |
|---|---:|---:|---:|---:|---:|
| Original serialized lane | 3 | 5,202 ms | 5,202 ms | 5,206 ms | 5,206 ms |
| Priority recovery lane | 3 | 0 ms | 0 ms | 0 ms | 0 ms |

Zero means below the fixture's rounded millisecond resolution, not zero work.
Fake-clock tests separately prove retry bounds and ordering; they are not
included in elapsed-time latency distributions. There is no paired,
pre-repair whole-app/browser or production latency distribution. Do not present
the dispatch comparison as a measured end-to-end before/after speedup.

## Canonical acknowledgement and connected-peer convergence

One bounded authenticated browser pass was followed by a targeted verification
of the subtle failed wake sequence on the two failing targets and the one
unreached target. No second broad browser suite was launched. Ordinary samples
from the three originally passing Chromium viewport projects remain useful;
their initial wake numbers are deliberately excluded from the canonical HTTP
recovery distribution because the first fixture did not close existing SSE.

Browser conditions: disposable PostgreSQL, two authenticated browser contexts,
one run, production web/API bundles, loopback without bandwidth throttling.
Each project has three requests with no injected delay and three with an
additional 40 ms request delay (not a simulated 40 ms RTT). First sample is
document-cold/server-warm; subsequent samples are document/server-warm.
Autoscale cold-start and slow physical mobile networks were not simulated.

| Project / viewport | edit ack n; min / median / max ms | peer adopted n; min / median / max ms |
|---|---|---|
| Chromium desktop 1280×800 | 6; 291 / 326.5 / 334 | 6; 309 / 351 / 360 |
| Chromium phone 390×844 | 6; 285 / 307 / 323 | 6; 304 / 322.5 / 356 |
| Chromium tablet portrait 768×1024 | 6; 281 / 317.5 / 327 | 6; 290 / 338 / 362 |
| Chromium tablet landscape 1024×768 | 6; 278 / 316 / 331 | 6; 284 / 330 / 368 |
| WebKit phone 390×844 | 6; 289 / 320 / 341 | 6; 323 / 346.5 / 384 |
| WebKit tablet portrait 810×1080 | 6; 301 / 332 / 418 | 6; 319 / 355 / 469 |

Combined **36 edit acknowledgements**: min 278, median 320, p95 341, max 418 ms.
Combined **36 connected-peer adoptions**: min 284, median 342.5, p95 392,
max 469 ms. All were below 2,000 ms. These are representative small-run
workloads, not a capacity or large-facility soak.

The UI harness first checks the PUT's canonical response for the edited value,
then the connected peer's value. A local render alone is not an acknowledgement.
Browser requests were 3,687–3,701 bytes; sampled responses 2,769–4,530 bytes.

### Foreground/network adoption

The corrected fixture closes its owned EventSource connections before sleep:
Playwright's offline switch alone does not close existing SSE sockets. It
requires both the remote value and completed canonical recovery status.
Each wake combines online, focus and visibility signals.

| Condition | n | min | median | p95 / max |
|---|---:|---:|---:|---:|
| Healthy wake (desktop Chromium, phone/tablet WebKit) | 9 | 65 ms | 125 ms | 238 ms |
| One 503, then canonical retry | 3 | 113 ms | 116 ms | 302 ms |
| One true ten-second client timeout, then retry | 1 | 10,408 ms | 10,408 ms | 10,408 ms |

All healthy and injected-503 recoveries were below 5,000 ms. The timeout case
is intentionally degraded and **not** a healthy-target pass: it exceeded the
unchanged ten-second client deadline, retained the previous displayed value
and visible `recovering` status, then adopted canonically and reached `outcome`.

Peer `/sync/today` GET/PUT totals over the complete targeted journeys:
desktop 14/5 (five wakes), phone WebKit 12/0 (four wakes), tablet WebKit 12/0
(four wakes). Each includes one rejected GET; desktop also includes one
timed-out GET. Assertions cap each method below 20 requests per journey.
No new periodic HTTP poll was added. These are bounded journey counts, not
proof about arbitrary sustained outages or fleet-scale backend load.

### Two-process durable delivery

Ten real writes crossed two independent API processes and PostgreSQL's durable
outbox, rather than relying on process-local SSE:

| Measurement | n | min | median | p95 / max |
|---|---:|---:|---:|---:|
| Canonical HTTP acknowledgement | 10 | 8 ms | 9.5 ms | 11 ms |
| Peer outbox frame received and value asserted | 10 | 10 ms | 12 ms | 16 ms |

Request size: 956–985 bytes; loopback/unthrottled, warm API processes after
fixture setup. The receiver reads after HTTP acknowledgement, so this is an
upper bound on peer-frame receipt latency, not a browser-render measurement.
The same suite passes lost-notification fallback, listener reconnection,
retention-gap authoritative reconciliation, transient handler failure,
cursor ordering/rollback, duplicate intents, reset epochs, date/sandbox scope
isolation, stale/blank protection and offline merge convergence.

## Stage diagnostics and overhead

Existing bounded numeric client measurements provide queue/debounce,
request/acknowledgement, merge and peer-apply timings. Across the six retained
browser records (including later wake-related writes), observed stage samples:

| Stage | n | min / median / p95 / max ms |
|---|---:|---|
| Queue/debounce wait | 61 | 120 / 121.1 / 123 / 126 |
| Request/ack latency | 61 | 17.6 / 27 / 67 / 143 |
| Client merge | 78 | 1 / 2.9 / 13 / 19 |
| Client peer apply | 17 | 2.5 / 8.7 / 19 / 19 |

These stage samples are not 61 independent user-edit trials. They overlap
whole-journey measurements and must not be added to overlapping header stages.
The client `serverQueueAgeMs` field is not a pure database checkout metric.

Authenticated changed `/sync/today` writes additionally return optional,
constant-cardinality `Server-Timing` durations:
`sync_acquire`, `sync_lock_read`, `sync_transaction`, `sync_handler`.
Acquisition includes pool checkout and BEGIN; lock-read includes SQL round
trips plus any lock wait. Transaction and handler overlap those stages.
These do not separate pure SQL execution from pure lock waiting, and browser
hidden-time elapsed duration must not be relabeled server execution time.

Outbox failure logs now classify a bounded cause chain into fixed permission,
schema, capacity, timeout, connection or generic delivery-failure categories.
They never include raw errors, arbitrary error codes, SQL, payloads or identities.
No new persisted diagnostic table, retention period, public diagnostic route,
per-request identifier store, or recursive diagnostic write was introduced.
Headers use four bounded numbers; existing client retention remains unchanged.

## Independently observed published behavior — read-only

Official deployment metadata identified
`https://Lucias-Production-Assistant.replit.app`, Autoscale. `/api/build-info`
reported verified revision `11815dbd0049b59daa92a147b01a3505ab2a5af8`,
build `app-build:e96adcf2-1bd0-4914-892b-d805f096ca74`, fingerprint
`58d718ab532d7a98b5fc1041585512e85e92f96a870f8f88299f91ac57f74010`,
release completion `2026-10-19T14:13:06.379Z`.
Platform deployment `411f3a0b-be0f-499a-9b85-b35deec43e5d`,
platform build `1ee8406d-f804-4681-a680-fb105e806c02`.

A bounded log query returned **41 outbox retry entries** between
20:56:57.469Z and 21:49:39.391Z, none with a classified cause. These are log
entries, not proven distinct failures, and cannot be causally assigned to the
reported incident.

A later read-only log snapshot, on that same served build, contained:

| End of capacity window (UTC) | window | checkout n; p95 / max ms | event-loop n; p95 / max ms | checkout errors |
|---|---:|---|---|---:|
| 22:15:36.268 | 62,000 ms | 231; 118 / 2,798 | 424; 401 / 7,801 | 0 |
| 22:16:38.568 | 60,300 ms | 117; 4,301 / 6,798 | 84; 2,701 / 4,802 | 3 |
| 22:17:35.069 | 60,100 ms | 97; 3,501 / 8,100 | 44; 4,303 / 17,415 | 1 |

A primary-capacity sample at 22:15:58.368Z was unavailable because of
`pool_checkout_timeout`; an auto-track pass failed at 22:16:22.768Z.
These are meaningful resource/queueing observations, but are **not correlated
to a particular sync request** and do not establish whether CPU capacity,
application work or upstream database service was responsible.
No topology/resource changes, production writes, resets or data repairs were made.
The new cause classification cannot be observed on that older published build.

## Failure ledger

| Finding | Status / action / owner |
|---|---|
| Recovery blocked by unrelated serialized refresh | FIXED; real paired dispatch measurement and deterministic scheduling regression. Executing agent. |
| Periodic-only retry, temporary HTTP treated permanent | FIXED; bounded timer/classification tests and canonical 503/timeout browser recovery. Executing agent. |
| Notification lost during active drain; failed drain waits for poll | FIXED; mock-clock overlap/backoff tests plus durable two-process suite. Executing agent. |
| Older successful wake settles a later cycle | FIXED; boundary validity regression and targeted desktop/WebKit recovery pass. Executing agent. |
| First scheduling implementation deferred invocation by a microtask | FIXED; restored synchronous priority dispatch, retaining asynchronous guard ownership. Date-scope regression passes. |
| Old five-second timer expectations; Strict Mode fixture called an already disposed registration | FIXED fixtures; test actual in-flight Strict Mode cancellation and completion-driven backoff. |
| Initial browser run failed on third wake (two targets), timed out before final target | RESOLVED by product boundary fix, targeted verification, and background execution of long test commands. First run remains recorded as partial, not retroactively passed. |
| Offline fixture left existing SSE alive | FIXED test isolation; initial wake timings excluded from canonical HTTP distribution. |
| Durable authenticated screenshot attachment not retained by list reporter | MISSING image evidence, not a failed assertion; fixture input image was attached in memory. No redundant journey run solely for an image. Development login screenshot retained separately; it does not prove authenticated convergence. |
| Browser console events retained as counts, not reasons | HISTORICAL EVIDENCE GAP: 47/33/32 console-error events on targeted desktop/phone/tablet runs cannot retrospectively be classified. Zero page errors and all journey assertions passed; these counts are not proof that every console event was expected. Raw console text was not retained. Do not claim a clean-console pass. |
| Published outbox retries lack causes; checkout/event-loop delays and auto-track failure | LIVE CAUSE UNRESOLVED; no incident-level correlation or authorization for production resource changes. Application operator owns post-publish observation below; executing agent supplies bounded diagnostics, not a speculative resource change. |
| Development health scan reported existing master-data findings | DATA REVIEW ONLY; startup completed. Not evidence of sync loss; no data changes authorized by this task. Owner may review existing manager health results separately. |
| Standard-release workflow reports missing published evidence; development update cannot be confirmed | EXPECTED RELEASE GUARDS, not this task's gates. No release evidence was fabricated or safety check weakened. |

## Verification

- **PASS:** focused web sync/retry/queue/state-machine tests, 95 tests/12 files.
- **PASS:** final affected scheduling/recovery/timeout tests, 57 tests/7 files,
  including the new distinct-boundary regression and real dispatch experiment.
- **PASS:** outbox/automatic coordination/server ticks, 51 tests/3 files.
- **PASS:** station/lifecycle/claim/suppression regressions, 53 tests/6 files.
  Packaging, Dough and shared Sauce/Frontline production formulas were not changed.
- **PASS:** isolated convergence suite (11 cases), including two independent API
  processes; final invocation completed in 30,134 ms.
- **PASS:** final web typecheck, API typecheck and focused API-route typecheck.
- **PASS:** OpenAPI regeneration, generated-contract check, task-policy check,
  touched shell-script ShellCheck and diff whitespace check.
- **PASS:** one bounded authenticated multi-context browser pass plus targeted
  repair verification; no unhandled page errors in targeted runs.
- **PASS:** managed API/web workflow restart; startup ready and outbox listener
  connected. Preview login loads; unsigned/local update warning remains explicit.
- **NOT RUN:** physical Android Chrome, iOS Safari and installed phone PWA checks:
  no authorized physical-device service was available. Chromium/WebKit viewport
  emulation is not physical browser or OS suspension evidence.
- **NOT RUN:** full/standard release campaign; not a prerequisite for this repair.
- **NOT VERIFIED:** post-publication latency, fleet load and Autoscale cold starts.

Retained sanitized numeric files are under the ignored
`artifacts/run-calculator/generated-artifacts/sync-latency/` directory:
`scheduling.json`, `two-process.json`, `timings-sanitized.json`,
`targeted-followup-sanitized.json` and `console-evidence-review.json`.
They contain numeric/fixed-label evidence, not request bodies, account IDs,
cookies or recipes. This tracked report preserves the summary if ignored
test output is not available in another checkout.

## Bounded post-publish check (operator-controlled, not performed here)

1. Read official deployment metadata and `/api/build-info`; verify the expected
   new revision/fingerprint before attributing observations to this repair.
2. Read a five-minute log window for bounded outbox reasons, checkout timing,
   event-loop delay, listener state and delivery lag. Do not treat a successful
   HTTP status as peer adoption or hide retry warnings.
3. With authorized operators' consent, observe ordinary real edits and wake
   adoption on already connected devices; retain only numeric stage timings,
   payload byte counts, build identity and network/warm-cold conditions.
   Do not replay this task's mutating fixture scenarios against live data.
4. Compare canonical ack/peer <2 s and healthy wake <5 s, recording every miss.
   If live resource delays persist, classify and correlate first. The operator
   must approve any resource/topology or production-data change separately.
