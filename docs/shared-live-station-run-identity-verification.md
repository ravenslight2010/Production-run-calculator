# Shared live station run identity — local verification

Date: 2026-10-26. Scope: repository and disposable fixtures only. This is not
production evidence, a release certification, or physical-device evidence.
Fixture IDs and values are synthetic; no credentials or customer records are
retained here.

## Outcome and execution boundary

The missing-selection regression is reproduced: an ended first run followed by
a later active run produces the first run's calculation through the explicit
index-based calculation API when `currentIndex` is absent. Shared consumers
previously used that API directly. The shared read path now selects by
canonical lifecycle, while explicit-target calculations remain unchanged for
historical reports and independently selected tracking/drain targets.

The shared selection order is latest started/unended run (including paused),
then latest ended run for drain displays, then first pending run on an
unstarted day. Lifecycle ties use schedule order. An active run without values
does not borrow another run's settings. Device selection is neither persisted
nor consulted for this shared choice.

The implementing agent owns reproduction, repair, integration and verification.
No schema, HTTP contract, production math, tracking mutation, authorization,
merge-stamp, reset-epoch, or database-heal change was made.

## Verification matrix

| Surface | Result and scope |
| --- | --- |
| Missing, stale, out-of-range device selection | PASS: shared calculation/tick fixtures select the later active run |
| Distinct run settings | PASS: calculation equality against explicit target includes speed, packaging progress and temporary overrides |
| Paused/multiple-active/ended/pending lifecycle | PASS: deterministic selector fixtures, including equal-time tie and missing-value behavior |
| Projection identity | PASS: calculation, run metadata, due schedule and lifecycle generation must agree |
| Full and unchanged sync GET | PASS: disposable HTTP fixtures return the later active projection; reads leave stored canonical state unchanged |
| Timed SSE | PASS: later active run ID agrees across server calculation, schedule and projection without `currentIndex` |
| Stale client projection | PASS: expired capture, expired receipt, future capture, different run and different lifecycle generation fall back locally |
| Clock isolation and wake | PASS: focused provider clock/calc/line-phase/wake checks |
| Focused server regressions | PASS: 86 tick, automatic server tick and coordination tests |
| Shared calculation package | PASS: all 39 tests |
| Full workspace typecheck | PASS: `CI=true pnpm run typecheck` through the pinned release runner, including shared-library, API, API-route, calculator, sandbox and scripts checks |

Commands use `bash scripts/src/run-release-node.sh`. The focused integration
selection is `snapshot conditionals|operational projection|later active
lifecycle` in `src/routes/sync.integration.test.ts` (8 passed; unrelated tests
filtered, not claimed as run). Each integration pass starts a private local
PostgreSQL cluster, and the test itself creates/drops its own database. The
cluster and temporary directories are removed afterward.

## Compatibility and startup applicability

No DOM, CSS, layout, controls, navigation, browser API or platform-specific
code changed. The station behavior is verified at the shared calculation,
real HTTP/SSE and React-provider layers rather than inferred from screenshots.

| Platform | Status |
| --- | --- |
| Desktop Chromium | Preview attempted; BLOCKED at staff-session probe by unavailable existing API workflow; not station-flow evidence |
| Phone and tablet portrait/landscape Chromium | NOT RUN: no responsive rendering changes; same platform-independent derivation/provider tests apply |
| Desktop/phone/tablet portrait/landscape WebKit | NOT RUN: no WebKit-specific or layout changes; no compatibility pass claimed |
| Physical Android Chrome, iOS Safari/PWA | NOT RUN: no physical devices; emulation would not establish physical evidence |

The web workflow was restarted and starts cleanly. The existing API workflow
reported `Build source changed. Run prepare:publish again before publishing.`;
the preview therefore returned 502 for its staff-session probe. Its normal
startup runs a schema push against the shared development database, outside
this task's disposable-fixture access boundary, so it was not restarted against
that database. The repaired API behavior was instead verified in a disposable
HTTP server. Shared startup/version and database health work remain with their
existing owners; this task does not certify preview or release health.

## Failure ledger

| Finding | Resolution / owner / next action |
| --- | --- |
| Index-zero shared read and tick selection | Repaired here; covered at library, HTTP and SSE layers |
| Stale same-run projection retained by provider | Repaired here: age, lifecycle and status guards precede timer adoption |
| Paused test expected production despite starting and pausing at the same instant | Fixture repaired here to include the intended production minute; focused provider tests pass |
| New GET regression expected a write-style `data` envelope | Fixture assertion repaired here to use raw GET document plus snapshot header; integration checks pass |
| TypeScript rejected spreading untyped `response.json()` | New fixture response explicitly typed here; full workspace typecheck passes |
| SSE fixture tried to create accepted lifecycle via generic sync PUT | Fixture repaired here to seed canonical lifecycle directly; no lifecycle fence weakened; SSE check passes |
| Existing API startup/version failure and preview 502 | Not a repaired station-path failure; shared startup requires access outside this task. Existing startup/version owners must restore normal preview after safe setup |
| Background alert candidate index-based selection | Separate notification outcome; proposed follow-up, not a reproduced production alert failure |
| Manager health diagnostic index-based selection | Separate diagnostic outcome; proposed follow-up, not a reproduced production health-status failure |

## Safeguards

Applied task-execution-rules, state-accuracy-check, sync-invariant-check,
test-gap-triage, verify-before-commit and evidence-hygiene. Sync persistence,
scope/date routing, body limits, LWW stamps, reset fencing and write ownership
are untouched. Projection transport remains outside canonical snapshot hashes.
No production queries/writes, push notifications, publish, or release gates
were performed as part of this verification.
