# Field-check diagnosis — 2026-10-16

## Scope and provenance

Owner: assigned field-check task agent. Surfaces: passive browser observer,
sync-write telemetry classification, authenticated ingestion/reporting, manager
Reported issues. No production observations, run data, retries, resets, merges,
or performance budgets were cleared, healed, or changed.

Sources:

- Isolated working-tree verification is based on source revision
  `0748b625755561a9002c6348e943be02646afe5c` plus this task's changes. It is
  not a claim about the revision serving production.
- User-supplied mobile screenshot, visually inspected. It shows three Sync
  acknowledgment failures and three Performance failures, all `local` /
  `mobile-chrome`. Relative ages alone do not identify an exact stored row.
- Official deployment metadata identified the active Replit production service.
  An unauthenticated `GET /api/field-checks` returned 401. The existing configured
  manager authentication path then allowed the authorized report GET, returning
  200 at **2026-10-16T02:04:33.143Z**. Credentials/session material were used only
  inside the request process and were not printed or retained.
- Repository implementation and retained history of the write-outcome
  classification and diagnostic-ingestion feedback-loop repairs were checked.
  Existing protections against counting SSE/peer/wake diagnostics as failed
  writes and recursively instrumenting diagnostic transport failures remain.

This document retains only the necessary timestamps, fixed categories, numeric
metrics and conclusions. It excludes request/response payloads, personal
identities, run IDs, tokens, raw URLs and free-form production errors.

## Retained report evidence

Report version: `1`. Both checks were **healthy**, with later successes and
historical failure rows still retained:

| Check | Latest success (UTC) | Lifetime failure count |
|---|---|---:|
| Sync acknowledgment | 2026-10-16 01:51:38.769 | 452 |
| Performance | 2026-10-16 01:51:38.024 | 285 |

All five returned sync failures had `appBuild=local`, category `mobile-chrome`,
and empty metrics. Their observation times (UTC) were:
2026-10-15 17:44:19.349, 14:29:55.488, 13:24:34.941, 13:05:49.348,
and 12:14:23.038.

Returned performance failures, also `local` / `mobile-chrome`:

| Observation time (UTC) | Retained duration (ms) | Source |
|---|---:|---|
| 2026-10-15 17:44:19.351 | 4,355,496.9 | not retained |
| 2026-10-15 13:24:34.942 | 232,037.8 | not retained |
| 2026-10-15 13:07:45.157 | 32,353.1 | not retained |
| 2026-10-15 12:07:01.952 | 30,841.2 | not retained |
| 2026-10-12 22:23:55.808 | absent | not retained |

These are genuine retained records, not proof of a currently failing write.
The API returns only five recent non-successes per check, and the UI displays
three actionable rows. Thus the screenshot cannot be matched conclusively to
all returned observations. Long durations alone do **not** establish network,
server, suspension, cancellation, or device causes.

`WEB_BUILD_ID` falls back to `local` whenever `VITE_APP_VERSION` is absent.
It does not establish hostname, deployment, source revision, or device hardware.
Local-labeled observations are present in the live facility report: they are
**not isolated by environment in that advisory report**. Field observations
are not revision-bound release evidence. No claim about the historical bundle's
exact deployed revision can be made from this label. The UI now states that an
unidentified local build is not release verification evidence.

## Isolated reproductions and repairs

1. **Lost sync cause:** terminal 401/403, stale/reset, and exhausted retries
   previously all emitted identical metric-free failures. Each remains a failure;
   v3 carries respectively numeric code 1, 2, or 3. A successful local write
   remains success. Transient non-terminal 503, stream interruptions, peer
   fallback, and wake recovery do not emit acknowledgment failures. Only the
   field-check metadata plumbing changed, not the write protocol.
2. **Lost timing source:** home bundle, navigation load, API timeout/abort and network
   failures previously collapsed into indistinguishable durations. v3 retains
   numeric source codes 1–4 plus bounded duration, never the event name or path.
   Diagnostic ingestion transport failures remain excluded. The existing timing
   transport groups TimeoutError and AbortError together; the display explicitly
   says “API timeout / abort” rather than claiming that an abort proved a timeout.
   Durations above the numeric ceiling are retained as capped failures and
   displayed with “≥”, not discarded.
3. **Budget mismatch:** the observer used 1,500 ms for home-chunk load, while
   `performanceDiagnostics` already applied the reviewed authenticated-startup
   10,000 ms budget to that exact event. The observer now reuses that constant.
   Boundary tests reproduce 10,000 ms as success and 10,001 ms as failure;
   navigation remains 1,500/1,501 ms and failed API timing retains the existing
   observer's 1,500 ms rule. No budget constant was raised.
   **This does not explain the retained long failures:** their sources are
   missing and all four available durations exceed even 10,000 ms.
4. **Deduplication:** previous IDs ignored build and metric category. v3 separates
   builds, sync causes, and timing sources. A bounded telemetry-only transition
   cache also prevents failure → recovery → failure in the same ten-minute
   bucket from losing the new failure. Replayed IDs are still idempotent at the
   API; repeated unchanged observations stay deduplicated. Legacy queued
   observations remain accepted and are not relabeled or rewritten.
5. **Visibility and privacy:** the manager view displays fixed cause/source
   labels and duration, or explicitly says details are unavailable on older
   evidence. V3 client sanitization and server rejection agree on allowed numeric
   metrics. The OpenAPI metric contract and generated documentation were updated.

## Evidence ledger and verification

| Result | Finding/check | Evidence, owner and next action |
|---|---|---|
| PASS | Authorized live report access | Read-only manager report GET above; no production business-data writes. |
| MISSING | Exact historical sync cause | Original rows contain `{}`; cannot recover erased metadata. Owner: diagnostics maintainer. Inspect a naturally occurring v3 record if the issue recurs; do not replay production writes. |
| MISSING | Historical timing sources and exact bundle revision | Not stored; `local` is an unknown build identity. Owner: diagnostics maintainer. Use future v3 source codes and a configured build identity; do not infer a cause from duration. |
| PASS | Focused client tests | `fieldChecks`, `syncDiagnostics`, `syncWriteResponse`, `performanceDiagnostics`: first pass 57 tests before the additional recurrence-dedup case. Final pass recorded below. |
| PASS | Run Calculator typecheck | `pnpm --filter @workspace/run-calculator run typecheck`, exit 0. |
| FAIL → repaired | First disposable API integration setup | `relation "users" does not exist`: a pre-existing static import bound the DB pool before the disposable URL was selected. Removed that static runtime import; load the constant dynamically after selecting the test DB. No shared DB was involved. Final pass recorded below. |
| FAIL → repaired | New recovery assertion initially depended on tied-row ordering | Distinct failure fixtures shared one observation timestamp, so Postgres could return them in a different tie order after recovery. Assert retained set membership rather than unsupported ordering; no production sorting behavior changed. |
| FAIL → repaired | Focused API route typecheck found untyped new test responses, then optional lookup results | Response JSON is `unknown` in this toolchain. Added type-only `FieldChecksReport` annotations and an explicit check-presence assertion; neither eagerly binds the DB pool. |
| FAIL → repaired | Completion's project-wide typecheck found a fixture-array inference error | The new negative-case array inferred optional `undefined` keys, incompatible with its numeric-record helper. Added an explicit numeric-record array annotation. The root check aborted the concurrent web check after this API error; it was not a separate web runtime failure. Final full validation is rerun by completion. |
| FAIL → resolved | Local API workflow build raced generated-file updates | Build identity correctly rejected a changing source tree. Restarted after generation finished; startup completed successfully at 02:17:30 UTC and the development health request returned `ok`. No identity guard was bypassed. |

### Final focused checks

| Result | Check |
|---|---|
| PASS | Client `fieldChecks`, `syncDiagnostics`, `syncWriteResponse`, `performanceDiagnostics`: **60 tests**, including category preservation, source separation, recovery/recurrence, saturation, budget boundaries, and ingestion-failure exclusion. |
| PASS | API field-check library plus integration tests: **16 tests**, disposable PostgreSQL only. |
| PASS | `pnpm --filter @workspace/api-spec run codegen` and `pnpm run check:api-generated`; the full generated-validator test step passed all six tests. The check-generated smoke intentionally selected one test (five others skipped in that preliminary smoke only). |
| PASS | `pnpm --filter @workspace/run-calculator run typecheck`. |
| PASS | `pnpm --filter @workspace/api-server run typecheck:routes`, after the typed-fixture repairs above. |
| PASS | Final timeout/abort label asserted directly against the same pure formatter used by the manager view. |
| PASS | `git diff --check`. |
| PASS | Managed API/web workflows restarted; development health and signed-out app screenshot confirmed serving. The screenshot showed expected unauthenticated 401 responses, not a signed-in console-health result. |

Command for the bounded browser lane:

```sh
bash scripts/src/run-release-node.sh env NODE_ENV=development \
  BROWSER_TEST_INSTALL_WEBKIT=1 bash scripts/src/run-isolated-browser-suite.sh \
  --playwright-config=playwright.field-checks.config.ts .
```

Browser data is synthetic and disposable, not production proof. This lane creates
its own database, API, web server and manager-capable accounts. It exercises real
ingestion/reporting, fences passive page submissions so they cannot recover the
fixtures, and inspects the actual manager display and horizontal overflow.

| Emulated viewport | Chromium | WebKit |
|---|---|---|
| Desktop 1440×900 | PASS | PASS |
| Phone portrait 390×844 | PASS | PASS |
| Phone landscape 844×390 | PASS | PASS |
| Tablet portrait 820×1180 | PASS | PASS |
| Tablet landscape 1180×820 | PASS | PASS |

Result: **10 passed** in the single 3.1-minute browser pass. Ten fixture-only
`safe-field-check-details.png` captures were written under the existing ignored
`artifacts/run-calculator/test-results/field-checks/` directory. The tester visually
inspected desktop Chromium and WebKit captures. Source-3 copy was subsequently
clarified from “API timeout” to “API timeout / abort”; that wording alone was
confirmed by the cheaper direct formatter assertion, not a second browser matrix.
The required behavior/source/duration assertions passed before that wording
clarification. No claim is made that this pass exercised final-copy text on every
engine.

Nonblocking runner warnings: optional WebKit host dependencies, npm config
deprecations, large bundle/deprecated build options, and a notice that no
published target was supplied for published-version verification. Both isolated
servers built and all ten browser cases launched successfully. Signed-in browser
console errors were **NOT COLLECTED** independently by this lane; owner:
diagnostics maintainer, next action only if a runtime error is reported is a
targeted console capture in the same disposable journey, not an assumed pass.

Physical Android Chrome and iOS Safari/PWA: **NOT RUN**, deliberately out of
scope; no emulated result represents physical-device proof. A full
release-readiness assessment and published-version verification are **NOT RUN**,
out of scope. The pre-existing release workflow's missing published-evidence
state is not a result of these focused checks or a readiness decision for this
task. Owner for any future release check: release maintainer; next action is to
run that separately authorized workflow with its required evidence. Owner for
physical-device checks: device-testing owner; next action only if explicitly
requested is the physical-device protocol, not relabeling emulation as hardware.
