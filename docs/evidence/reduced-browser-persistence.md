# Reduced browser persistence — development evidence

Environment: isolated task workspace, disposable PostgreSQL, synthetic fixtures.
Owner: assigned implementation agent. No production data, publication, schema
change, PIN value, credential, request body, HAR, or trace is retained here.

## Objective and boundary

Move operational directories/presets to scope-bound memory and verify the
convenience PIN online. Keep independent server capabilities. Profiles, templates,
completed history, active runs/day-state, timers/counters, operational commands,
delivery receipts, device identity/preferences, conflict metadata and per-device
historical undo remain outside the read-cache removal.

The allowlist is shared between API and client. Memory-only keys comprise brands,
brand/flavors, ingredient/type lists, die/pepperoni types, recipe-name lists and
dough/sauce/cheese preset maps. Durable exceptions are scoped pending factory
commands, scoped conflict metadata, unresolved legacy evidence, and historical
undo. None is an offline directory bootstrap source.
The authenticated read projection also explicitly includes non-secret stoppage
reasons, packaging options and shift/production start times used by staff.
These settings remain response-backed memory, not directory-cache keys.
Administrative data stays excluded and all factory writes remain capability-gated.

Old unpartitioned caches/commands have no trustworthy authenticated owner. Equal
canonical values reconcile automatically. Differences and absent canonical values
remain available for explicit manager review; they are never assigned to the next
account or given a fresh timestamp automatically. A manager can inspect and apply
an edit as a new current-session action, or explicitly keep the server value.

## Progress and failure ledger

| Finding/check | Status | Resolution / next action |
| --- | --- | --- |
| PIN returned and cached by original clients | Repaired; verification pending | Status-only reads/writes, shared fail-closed verification limiter, transient entered values |
| Staff excluded by original factory-data GET | PASS | Disposable full-router integration proves allowlisted staff read, administrative denial, write denial and no-store |
| Package-manager auto-selection stalled / pinned runtime bootstrap timed out | Repaired | Exact pinned Node and pnpm acquired in ignored temporary runtime directories; no dependency or lockfile change |
| pnpm wrapper selected old pnpm / ignored native install script | Repaired | Used verified native pnpm version directly, not a changed engine constraint |
| Generated inline verification body caused duplicate type/value export | Repaired | Named input schema; regenerated and shared declaration build passed |
| Removed PIN context field left stale references | Repaired | Removed stale fields; affected client typecheck passed |
| Existing list-cache tests assumed native storage | Repaired | Updated merge fixtures to memory-backed adapter without weakening merge/run/tombstone assertions |
| Empty queue flush retained a resolved in-flight promise | Repaired | Deferred flush body ensures assignment precedes completion; explicit-review regression covers subsequent delivery |
| Late-response test switched account before request started | Repaired | Fixture waits for request start before switching |
| Route integration test parsed unknown JSON without a type | Repaired | Explicit response envelope type |
| Focused directory/queue/merge/reconnect checks | PASS | 42 client assertions in four files |
| Factory-data/PIN and bootstrap API checks | PASS | 20 assertions in two files, disposable PostgreSQL |
| Full affected client regression suite | PASS | Supported `run test` command: 369 files / 3,458 assertions passed, one existing skip, plus the source-boundary checks. Final shape/review hardening followed by 42 focused passing assertions and calculator typecheck |
| Generated contracts, shared declarations, calculator and API/route-isolated typechecks | PASS | Supported pinned runtime; generated check and validator tests passed |
| Timeout classified as offline with a cross-realm DOMException | Repaired / PASS | Use the owned abort signal; explicit timeout regression now passes |
| Malformed pending commands could be filtered silently | Repaired / PASS | Fail closed and preserve the original durable bytes |
| Concurrent directory reads could finish out of order | Repaired / PASS | Epoch/read-order receipts and canonical stamp guards; focused directory/PIN suite now has 34 passing assertions |
| Managed workflows initially timed out before application startup | Repaired for web | Older pnpm recursively self-installed; exact native pnpm in its actual workspace-local tool cache fixes launch |
| Managed artifact command override/direct TOML modification rejected | Resolved without config change | No artifact config diff; managed web is running; API fixture launched with explicit disposable DB instead of changing managed DB configuration |
| API fixture startup/readiness | PASS | All process/startup/database/audit-protection/dependency/background checks report healthy |
| Prelogin screenshot | PASS with separate existing warning | Sign-in renders. Update status warning is observed, not repaired here; separate update/recovery owner retains this scope |
| Consolidated authenticated Chromium browser journeys | PASS / bounded | Manager, staff, real supervisor, empty PIN, wrong/correct/throttled/offline/expired verification, cross-tab PIN revocation, canonical save/reload, legacy resolution, desktop/phone/tablet layouts |
| Reported residual legacy marker | Explained / PASS | It belonged to an earlier fixture identity, not the active manager. Other-identity evidence intentionally remains hidden; it was not deleted |
| Review mutation notification / staff-first legacy quarantine | Hardened / PASS | Observable storage notification and explicitly unowned quarantine prevent stale actions and stranded staff-owned evidence; focused regression plus actual WebKit staff→manager→Keep→reload proof |
| Actual WebKit API-unavailable/retry and review flow | PASS | Three real GETs aborted, retry visible, then six real 200 reads; no fabricated success or PUT, no TLS bypass; markers resolved and stayed absent on reload |
| True cold-offline installed-PWA reload | BLOCKED | Development navigation stopped at browser `ERR_INTERNET_DISCONNECTED` before shell render. Negative bootstrap is unit-proven; document-online/API-offline retry is browser-proven. No PWA caching change made |
| Browser delayed in-flight identity switch | NOT REACHED | Primary repository regressions cover late read/write, superseded read receipts, concurrent reads, scoped queue delivery and canonical acknowledgments; real staff→manager switch separately passed |
| Cross-tab directory refresh / preset rename-import-merge browser seams | NOT REACHED | Cross-tab PIN invalidation and server directory save/reload passed. Merge/import/preset consumers covered by affected client regressions, not claimed as browser proof |
| Full WebKit responsive matrix | NOT REACHED | Actual WebKit proof is bounded to the corrected review/retry flow. Full desktop/phone/tablet layout checks were Chromium only |
| Production recovery/outbox equivalence | PASS unit / limited browser | Migration tests compare excluded recovery/device/queue values unchanged; existing client regressions passed. Browser pass did not create a production run or prove content-level equivalence |
| Completion check: legacy stop reasons/packaging without server rows had no review path | Repaired / PASS | Review discovers every previously supported factory key, including stop reasons, four packaging lists, timing settings and retained conflict records. Upgrade regressions preserve exact raw bytes across missing rows, offline/malformed acknowledgments and staff switches; only canonical Apply acknowledgment or explicit Keep resolves them |
| Completion check: runtime memory included a session bootstrap recipe | Repaired | Removed provisioning steps; retained only the durable distinction between runtime bootstrap and application failures |
| Completion check: staff fresh loads defaulted configured operational settings | Repaired / PASS | Separate shared operational-read allowlist now includes the seven stoppage/packaging/timing keys without treating them as directory caches. API regression saves non-default manager values and reads them as staff while proving private data exclusion and write denial. Client regression verifies fresh staff and live→sandbox→live getters with no persistent cache |
| Interim missing shared barrel exports | Repaired / PASS | Five focused failures and transient Vite import failure were caught before delivery; added exports, then 46 focused assertions, affected/shared typechecks and generated-contract check passed |
| Final fixture restart / preview | PASS with bounded optional diagnostic | API readiness became 200 after normal build/startup probes; Vite restarted cleanly and public sign-in rendered. Optional identity-sequence audit reported unavailable; no sequence data was changed or sequence audit claimed. Database-maintenance owner can run its authorized diagnostic separately; canonical API writes and disposable fixture checks passed |

## Verification commands and retained evidence

Commands used the exact pinned Node and native pnpm; no engine constraint,
dependency manifest, lockfile, artifact manifest, or production setting changed.

- `pnpm --filter @workspace/run-calculator run test` — full client and source-boundary pass above.
- Final focused `vitest run` for factory directory, PIN API, recipe merge and stale
  receive guards — 46 assertions passed after both completion-check repairs.
- `pnpm --filter @workspace/run-calculator run typecheck` and subsequent final
  calculator `tsc --noEmit` — PASS.
- `pnpm --filter @workspace/api-server run typecheck` including route isolation — PASS.
- Factory-data/PIN route integration and bootstrap tests — PASS, disposable DB;
  16 factory/PIN assertions plus six bootstrap assertions.
- `pnpm run check:api-generated` — PASS, including generated output comparison,
  shared client/validator declarations and validator tests.
- `pnpm run typecheck:libs` — PASS.
- `git diff --check` — PASS.

The 22 factory/PIN/bootstrap assertions, shared/affected typechecks, and
`check:api-generated` were rerun after expanding the staff projection. A public
preview snapshot confirmed the corrected module exports load after restart;
unauthenticated 401 responses are expected. The existing update warning remains
with its separate recovery owner.

Sanitized browser evidence is ignored, not a shipped application asset:
`artifacts/run-calculator/generated-artifacts/task-3570-browser-pass.json` and
`artifacts/run-calculator/generated-artifacts/task-3570-legacy-review-staff-manager-webkit.json`.
The second record supersedes the first record's residual-marker failure
classification. Neither contains accounts, credentials, PIN values, request
bodies, HARs or traces.

## Remaining boundaries and ownership

No required behavior remains knowingly broken. This is not exhaustive browser
coverage or release certification. The gaps above remain labeled rather than
being promoted to PASS. Physical-device follow-through is already represented by
the listed physical-phone task; full live-state authority and guarded server Undo
are separate listed downstream outcomes. No duplicate follow-ups were created.
The existing update-failed warning stays with the update/recovery owner.

Automatic combined logs also included published-app database-capacity/background
connection warnings unrelated to this disposable fixture. They were not used as
task startup evidence or claimed repaired. A production reliability owner must
use the approved production diagnosis path before making any live change; this
task made no production query or repair.

## Required browser and lifecycle matrix

Desktop, phone, tablet portrait and landscape with Chromium and WebKit emulation
apply to the changed PIN dialog, picker, retry, and legacy review surfaces.
Manager/staff loads, correct/incorrect PIN, explicit empty policy, expired auth,
PIN-change invalidation, reload/offline/reconnect, canonical save/reload,
account/live-sandbox switches and legacy upgrade all require evidence.

Physical Android Chrome and iOS Safari/PWA: NOT RUN; no physical device service
available in this task. Emulation is not physical-device proof. Native mobile:
NOT APPLICABLE. Full release certification and publication: NOT APPLICABLE.

## Compatibility

There is no secret-returning legacy endpoint. Old clients that compare a local
PIN must update; their old local fallback cannot be made secure by a server
response. Backend capability checks remain authoritative regardless of UI state.
Updates remain opt-in; no automatic reload or blanket site-data clearing is used.
