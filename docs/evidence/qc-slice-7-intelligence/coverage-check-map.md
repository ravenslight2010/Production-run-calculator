# QC intelligence — coverage and verification

## Objective and status

Deliver bounded manager-only QC measurements, recorded outcomes and exact lot-to-run traceability in the existing API/web artifacts. Implementation and scoped synthetic verification are complete. This is isolated development evidence, not production or regulatory approval.

Evidence identity: current workspace including task changes; revision and run timestamps are retained in each browser-result JSON. No production data, customer workbooks, credentials, request headers or raw traces are retained.

Working captures live in `.local/tasks/evidence/qc-slice-7-intelligence/`.
Reviewed Markdown, bounded result JSON and synthetic screenshots are mirrored
under `docs/evidence/qc-slice-7-intelligence/` for durable task handoff; ignored
local metadata is not reliably included in managed checkpoints. Both locations
are excluded from deployment inputs by `.replitignore`.

## Coverage inventory

| Area | Included variants and semantics |
| --- | --- |
| Measurements | Weight (oz/g/lb/kg) and Brix; actual-unit/target-unit, ingredient identity, profile, station, timing and retained target version remain distinct. Missing target versions are isolated per event, not inferred from equal values. Unconfigured readings remain visible and unevaluated. |
| Outcomes | Weight, Brix, component, label and date-code checks; pass/fail/not-evaluated by check type/timing, station and stable ingredient. Denominators are recorded checks only. |
| Effective evidence | Original source events plus every bounded correction/redaction overlay. Overlays are not checks; station/timing filters apply after overlays. Overlay overflow fails closed with no effective values returned. Redacted measurements are omitted from trend values; retained outcomes use the same history projection. |
| Traceability | Recorded lot events, exact scoped run IDs, hash-validated completed snapshots or exact active current-day identities. Missing, ambiguous, oversized or invalid sources remain unavailable. No name matching, inventory-transfer-as-shipment or inferred customer link. |
| Dates | Inclusive UTC event-created-at calendar dates, default last 30 UTC dates, maximum 366 dates; invalid calendar dates, reversed ranges and excessive ranges rejected. This is not a production-date filter. |
| Bounds | Default 1,000 / maximum 5,000 source events; 10,000 overlays; 100 groups per output dimension; 50 canonical run sources; 1 MiB per canonical snapshot and 600 runs per snapshot; CSV maximum 4 MiB and 4,000 characters per cell. Source, overlay, group and canonical-source limits are explicit, never complete-looking truncated reports. |
| Exports | Same query and effective projection as JSON, with filters/date basis/coverage/denominators; formula-leading text escaped, numeric cells preserved, redacted values and correction reasons excluded. Excessive CSV size is an explicit 413 failure, not a partial successful download. |
| Authorization | Anonymous 401; record-qc without manage-qc denied; managers scoped from authentication; live and sandbox isolated. No unrelated write or general audit capability added. Capability loss hides cached report data. |
| UI | Manager navigation, UTC range/station/ingredient/run/timing controls, separate trend context, chart and accessible table, recorded-result tables, trace detail, empty/loading/error/retry/partial states, filtered CSV, reload and refresh. |
| Responsive matrix | Desktop 1440×900; phone 390×844; tablet portrait 768×1024; tablet landscape 1024×768, Chromium and WebKit. Browser locale en-GB and timezone Pacific/Kiritimati distinguish UTC date semantics from local dates. |
| Deliberate exclusions | Forecasts, cross-contact conclusions, regulatory/HACCP claims, recall execution, inferred lot-to-customer links, a new shipping system, holds/releases/clearance blocks and optional allergen Phase 2. |

## Check ledger

| Check | Actual command / evidence | Result |
| --- | --- | --- |
| Contract generation | `pnpm --filter @workspace/api-spec run codegen` via exact pinned runtime | PASS |
| Deterministic projection | `pnpm --filter @workspace/api-server exec vitest run src/routes/qcIntelligenceReport.test.ts` | PASS: 5 tests; also included in combined run |
| Scoped PostgreSQL integration | `pnpm --filter @workspace/api-server exec vitest run src/routes/qcIntelligenceReport.test.ts src/routes/roles.integration.test.ts -t "QC intelligence"` | PASS: 11 selected tests; 194 unrelated tests skipped |
| Client regression | `pnpm --filter @workspace/run-calculator exec vitest run src/components/QcIntelligenceReport.test.tsx src/components/QcWorkflowTab.test.tsx` | PASS: 22 tests before sync; 24/24 after incoming Brix reference tests integrated; includes surrounding-form regression |
| Generated parity | `pnpm run check:api-generated` | PASS independently and as part of root typecheck |
| Workspace/changed-package types | `CI=true pnpm run typecheck`; final exact pinned-runtime rerun `CI=true bash scripts/src/run-release-node.sh pnpm run typecheck` | PASS, exit 0 on 2026-10-23, including final post-sync workspace and leaf checks after archiving stale development metadata |
| Post-sync generated contracts and API types | `pnpm --filter @workspace/api-spec run codegen`, `pnpm run check:api-generated`, `pnpm --filter @workspace/api-server run typecheck` | PASS; regenerated combined OpenAPI validator rather than hand-merging the generated conflict |
| Completion code review | Task-configured completion review, not a separate agent-initiated review | PASS, exit 0; subsequent repair only archived stale ignored development metadata, with no application or publish-policy change |
| Authenticated Chromium journey | `BUILD_IDENTITY_MODE=development bash scripts/src/run-isolated-browser-suite.sh --playwright-config=playwright.qc-activity-compatibility.config.ts qc-intelligence-authenticated.spec.ts` | PASS 4/4 Chromium projects; initial WebKit interception/setup failures retained in failure ledger |
| Focused authenticated WebKit repair verification | Same isolated runner/config/spec with `'--project=*-webkit'` | PASS 4/4, exit 0; service workers blocked for deterministic API 503 injection, not PWA lifecycle evidence |
| Combined required browser matrix | Per-project `*-browser-result.json` and `*-report.jpg` | PASS 8/8 required viewport/engine journeys across the above runs, zero page errors; manager filter/export/reload/error/retry and non-manager UI/API denial |
| Managed API/web startup | Exact configured artifact workflows; sanitized log inspection; proxied `/api/readyz` and unauthenticated report request | PASS: web ready on 26038, API ready on 8080, readiness `ok` and report 401; separate non-blocking identity-sequence diagnostic warning retained in failure ledger |
| Physical Android Chrome | No physical device available | NOT RUN |
| Physical iOS Safari/PWA | No physical device available | NOT RUN |
| Real approved operating references/configuration | Not supplied or inferred; remains separate from synthetic feature verification | MISSING |
| Earlier slice captures | Earlier document evidence links are present, but their `.local/tasks/evidence/qc-slice-*` captures were not in this task checkout at inspection | MISSING — prior statuses remain attributed to their existing plan entries, not re-proven here |

## Program boundary

Browser captures identify the revision, timestamp, project/viewport, locale,
timezone and isolated synthetic environment. `sourceState` explicitly includes
uncommitted task changes; these are not clean-revision release attestations.
Chromium captures preceded the test-only worker-blocking change; all WebKit
captures use it. Both runs exercised the same final report implementation.
Accounts/roles and daily snapshots were cleaned up, with append-only synthetic
QC rows retained until disposable database teardown. No raw traces, cookies,
tokens or production/customer records are retained.

Slice 8 remains deferred pending explicit owner policy, not shipped or formally declined. Slice 9 is optional and unadopted. The report's customer/outbound trace coverage is unavailable because no explicit stored relationship exists. These gaps do not become passing checks or authorization to implement new systems. No entire-program completion or production-readiness claim is made.
