# Field-evidence filters — isolated verification

## Scope and provenance

Owner: assigned field-evidence filtering agent. Base source revision:
`1731d8cedd8deafd0ab23e9803f1af33f75c2711`, plus the filtering changes in this
working tree. Environment: isolated task workspace and disposable test
databases. This is implementation evidence, not production revision or release
approval. Original diagnostic context:
[field-check diagnosis](field-check-diagnosis-2026-10-16.md).

The approved objective is optional build/browser selection in Reported issues,
with server-derived counts, recovery and recent rows for that population.
Existing phone tap-size and support-download tasks own their separate outcomes.
No production queries, observation repairs, run edits, sync/timing-budget changes,
physical-device checks or publishing were performed.

## Query and display contract

- Default `GET /api/field-checks` remains unfiltered and preserves facility
  lifetime issue counts/status. Last-success details and recent rows still come
  from retained observations.
- Optional `appBuild` is an exact, case-sensitive scalar of 1–100 characters,
  without leading/trailing whitespace. `local` identifies an **unknown build**,
  not a development environment or a revision.
- Optional `deviceCategory` is one existing ingestion category. Browser
  categories are retained as observed; guided hardware categories are explicitly
  labeled in the selector. There is no inferred browser version or device ID.
- Filters combine with AND, inside the server-owned live/sandbox scope. Repeated,
  empty, structured and unsupported filters are rejected with safe 400 JSON.
  Existing review capability and authentication remain required.
- A filtered report uses all matching observations received within 30 days,
  before limiting recent non-success rows to five per check (three detailed
  actionable rows displayed). Failure/incomplete counts are retained-population
  counts, not lifetime issue counters or a subset of global recent rows.
- Filtered recovery requires a matching success strictly newer than the latest
  matching non-success. Equal timestamps fail closed as open. Other builds,
  browsers and out-of-order older successes cannot recover the selection.
- No matches produce zero counts, null issue/success state, and
  collecting/unsupported status. Fewer than three incomplete observations are
  not actionable. Existing catalog freshness/expiry rules remain unchanged.
- The response documents population and count basis. The manager view labels
  applied selections, counts, recovery, retention and advisory limitations.
  Controls use an explicit Apply; Clear and a fresh mount/reload default to all.
  Changed queries have distinct cache keys and do not show the previous group's
  rows while loading or after a failed read.
- All filtering is read-only. No observation, lifetime issue or run is changed.
  There is no new payload, identity, screenshot or fingerprint collection.

## Regression strategy

First source of truth: scoped retained observations in the API. Extend existing
field-check contract/integration tests rather than create another test task.
API coverage proves filtering before row limits, independent build/browser and
combined selection, unknown/case-sensitive/empty populations, retention/sandbox
exclusion, recovery ordering, incomplete escalation, strict bounds, authorization
and read-only behavior. The existing isolated manager browser test covers the
request/control boundary and responsive presentation.

## Verification

| Check | Result |
|---|---|
| API code generation and library declarations | PASS |
| Focused field-check contract and disposable-DB integration | PASS: 20 tests |
| Generated API consistency/toolchain checks | PASS, including 6 generated Zod contract tests |
| Client filter controls inside an outer form | PASS: 2 tests |
| Client typecheck | PASS, including final select-presentation markup |
| API route typecheck | PASS after validator correction |
| Managed API/web restart | PASS; startup initialization ready / Vite ready |
| Signed-out preview | PASS; sign-in screen renders (expected unauthenticated 401s) |
| Authenticated responsive browser matrix | PASS: 10 projects after label and native-submission repairs |
| WebKit selected-text contrast | PASS: one authenticated tablet-portrait visual follow-up after presentation repair |
| Main-project merge integration | PASS: 12 focused filter/export tests, client typecheck and merged browser-spec syntax check |

Commands:

```sh
bash scripts/src/run-release-node.sh pnpm --filter @workspace/api-spec run codegen
bash scripts/src/run-release-node.sh pnpm --filter @workspace/api-server exec vitest run src/lib/fieldChecks.test.ts src/routes/fieldChecks.integration.test.ts
bash scripts/src/run-release-node.sh pnpm run check:api-generated
bash scripts/src/run-release-node.sh pnpm --filter @workspace/run-calculator run typecheck
bash scripts/src/run-release-node.sh pnpm --filter @workspace/run-calculator exec vitest run src/components/FieldEvidenceFilters.test.tsx
bash scripts/src/run-release-node.sh pnpm --filter @workspace/api-server exec tsc -p tsconfig.routes.json --noEmit
bash scripts/src/run-release-node.sh bash scripts/src/run-isolated-browser-suite.sh --playwright-config=playwright.field-checks.config.ts
```

### Browser applicability matrix

| Emulated viewport | Chromium | WebKit |
|---|---|---|
| Desktop 1440×900 | PASS | PASS |
| Phone portrait 390×844 | PASS | PASS |
| Phone landscape 844×390 | PASS | PASS |
| Tablet portrait 820×1180 | PASS | PASS |
| Tablet landscape 1180×820 | PASS | PASS |

After fixing Apply, the initial invocation completed seven passing projects
before the foreground shell limit. Only the three unreached WebKit projects
were continued, and all passed. The existing tester confirmed cleanup of the
disposable databases and temporary PostgreSQL directories. No broad app suite
was repeated and no additional tester was started.

Screenshot review then found a WebKit native-select contrast issue. A
presentation-only repair was verified in just tablet-portrait WebKit
(820×1180, one test, 30.3 seconds), not another matrix pass. The selected build
and browser text is readable on dark controls with visible decorative chevrons:
foreground `#f8fafc`, background `#131720`, `appearance: none`. No browser errors
were reported, and the disposable PostgreSQL directory was absent afterward.
Retained visual:
`artifacts/run-calculator/test-results/field-checks/field-check-diagnostics-ma-18d7b--from-isolated-API-evidence-tablet-portrait-webkit/field-evidence-filters.png`.
This ignored output is the final targeted capture; earlier per-project captures
were replaced by the focused runner's normal output cleanup.

This matrix is responsive browser emulation, **not physical Android Chrome,
iOS Safari or installed PWA proof**. Hardware checks are not run: excluded by
the accepted scope. Native mobile is not applicable to this web-only product.
Release/full-suite/production-readiness checks are not applicable to this
bounded read-only feature.

## Failure and limitation ledger

| Finding | Disposition, owner and next action |
|---|---|
| Initial validator used an unavailable Zod method | Fixed in this task by using the installed schema API; API route typecheck passed afterward. |
| New fixture used an observation ID shorter than the existing 8-character minimum | Fixed the disposable fixture; production validation was not weakened. All 20 focused tests passed afterward. |
| Exact Build selector could not resolve the wrapping label because it included option text | Fixed the markup using explicit unique label/select associations. Initial Chromium runs stopped here; remaining projects were not reached in that attempt. All 10 projects subsequently passed the corrected filter journey. |
| Applying the filter reset its selection in actual Home | Reported issues sits within Home's outer form; removed invalid nested form/native submit. Replaced with a semantic group, type=button actions, explicit blank-ID protection and Enter handling that prevents outer submit. Two client regressions rendering inside an outer form and all 10 browser projects now pass. |
| Foreground browser command reached its five-minute execution limit | Continued only unreached projects; all passed. Existing tester verified no disposable PostgreSQL directories remained after cleanup. No shared database writes. |
| WebKit native selects drew a light background with near-white selected text | Screenshot review caught this despite passing behavioral checks. Fixed with appearance-none, explicit foreground styling and decorative chevrons. One authenticated WebKit visual follow-up passed; no handler, query or state changes. |
| Final synchronization conflicted with the newly merged support-download controls and browser assertions | Resolved from the complete original source sides, preserving both features and all assertions rather than retaining the interleaved conflict output. Added strictly allowlisted export-population metadata so a filtered snapshot cannot be mistaken for unfiltered lifetime issues. Raw build identifiers remain excluded. Twelve focused filter/export tests, client typecheck and the merged browser-spec syntax check pass. No new browser matrix was run for this deterministic integration. |
| Frontend skill references an absent local workspace-reference directory | No runtime dependency; used the existing repository OpenAPI/codegen/server conventions. No package or skill changes needed. |
| Local startup says published-version approval is blocked without an official target | Expected outside release work; no release approval was requested or inferred. API startup completed successfully. |
| API-only workflow root probes return 404 | Expected: API is mounted under `/api`; web is served by the separate managed Vite workflow. |
| Combined log snapshot included an unrelated published background-job connection timeout | Not feature-verification evidence and not reproduced in isolated filtering. No production changes authorized by this task. Production operations owner should use the existing protected-background-work diagnosis/incident process if it recurs; this report makes no production-health claim. Only this bounded description is retained, not raw production records or logs. |

All retained screenshots and browser output use synthetic isolated fixtures.
Ignored test output is under
`artifacts/run-calculator/test-results/field-checks`; no credentials, session
tokens, request payloads or production records are attached to this document.

## Main-project integration

The responsive matrix above applies to the completed filtering implementation
before final synchronization with main. The incoming support-download feature
is preserved: its capability gate, bounded allowlisted JSON, failed-download
recovery, no-observation-change assertions and non-reviewer denial remain.
Downloads now also identify filtered/unfiltered count basis, retention and
browser category. A selected build is represented only by `all`, `unknown-local`
or `selected-unverified`, never by the entered identifier. Legacy reports mark
unavailable population metadata explicitly.

The merged browser test performs support-download assertions before adding the
filter fixtures, then exercises filters and finally preserves the restricted
account denial assertions. This avoids changing authentication mid-filter flow
or comparing post-fixture data with the original unfiltered snapshot.

Post-resolution verification used the focused `FieldEvidenceFilters.test.tsx`
and `fieldCheckExport.test.ts` suites (12 tests), direct client `tsc --noEmit`,
and the repository's browser-spec syntax validator. These are bounded integration
checks, not a claim that the pre-merge browser matrix was rerun on a new revision.
