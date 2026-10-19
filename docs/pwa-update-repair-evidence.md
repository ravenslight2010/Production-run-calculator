# Data-safe PWA update repair

Environment: isolated workspace; synthetic fixtures only. Owner: executing agent.
Scope: discovery, activation, reload, startup confirmation, persistent controls,
shell headers, and preservation. No production writes or publication.

## Failure ledger

| Finding | Evidence | Status / action |
| --- | --- | --- |
| Activation can return without navigating or reporting failure | Legacy `updateAndReload` hands ownership to `updateServiceWorker(false)` and returns; without a `controlling` event there is no deadline. A worker that activates without claiming need not control the existing document. | PASS: reproduced by focused regression; production coordinator now bounds worker activation and performs its own guarded navigation. |
| Update success was emitted at installation and before reload | Original App emitted `pwa-update-handoff:success` in installed listener and both update actions. | PASS: confirmation now requires the next document's exact intended build identity. |
| Explicit update bypassed work gates | Original toast handler defaulted to an always-true guard; error recovery had unconditional reload timers. | PASS: all update navigation uses live safety gates; recovery also takes fresh authoritative proof after activation. |
| Recovery deleted shared precache before proving replacement | Original ErrorBoundary deleted all Workbox precaches, including offline shell needed by other tabs. | PASS: no repair-time cache deletion remains. |
| No fresh release check or persistent retry/status | Original background errors were swallowed; toast was the only normal control. | PASS: fresh noncached identity and persistent accessible status/control added. |
| First coordinator retry did not retry after failed startup | New focused test consumed the first marker, then no second attempt was recorded. | Fixed: failed/offline attempts require a new identity check before retry. |
| Recovery test matcher and incident deduplication fixtures | Vitest does not register `toBeVisible`; identical repeated failures share the capture deduplication key. | Fixed fixture assertions and use a distinct diagnostic failure identity; 54 focused client tests PASS. |
| Client typecheck saw stale generated library declarations | Missing QC/field-check exports and unbuilt field-check-contract declarations, plus one new scheduler promise return-type mismatch. | PASS: scheduler typing fixed; libraries rebuilt; client typecheck passed. |
| First isolated browser pass found stranded activation | 9 PASS, 5 FAIL, 18 NOT REACHED before the test shell's 300-second limit. Manual multi-tab update timed out in activation; several older recovery fixtures stayed on old build. | PASS after worker lifetime guarantees and installed-state activation signaling. All five failed paths now pass; required unfinished compatibility/recovery cases were completed in targeted runs. The original truncated run is not relabeled green. |
| Follow-up test orchestration did not retain its output | The first Chromium manual retry returned exit 0, but its log was under Playwright's auto-cleaned test-results directory. The subsequent helper polled a nonexistent log without a running test process. | Stopped that helper; used a managed background shell for only the repaired and uncompleted flows, with its output outside the auto-cleaned directory. |
| Older manual recovery-confirmation fixtures relied on bypassing active-run safety | Both confirmation fixtures advertised an active authoritative run solely to suppress automatic recovery, then expected the manual action to reload anyway. | Model an inactive authoritative run plus ongoing input activity instead. Keep all confirmation assertions; the separate active-run and explicit-blocking tests continue to require no reload. |
| Active-run → safe-idle fixture could not actually stop its run | The fixture returned 404 for canonical sync reads, leaving the real Stop action correctly queued behind foreground recovery. Its older manual reload expectation had hidden that barrier. | PASS: complete isolated snapshot matches the seeded active/pending runs and retains accepted deltas. Real Stop, explicit refusal, fresh idle window, and exactly one confirmed navigation pass on both engines. |
| Correct handoff failed an obsolete registration-call spy | After the canonical fixture repair the page reached the new build, but the test still required one extra `registration.update()` call even though the new worker had already installed. | Replace the internal-call requirement with stronger user-visible proof: exact running target, exactly one confirmed startup and exactly one navigation with no loop. |
| Navigation counter included same-document history updates | `framenavigated` counted Home's fragment update as well as the actual new document; the startup confirmation count was already exactly one. | Count main-frame document navigation requests instead, retaining the exactly-one navigation assertion. |
| Preview screenshot used the wrong assumed port | Managed web workflow served on its assigned port, not 5173. | Corrected port from workflow output; phone sign-in/control screenshot captured. Backend initially not started caused 502 startup probes; started its existing workflow. |
| Combined log capture included unrelated published retry events | Background queue/push/sync retry messages were accompanied by later successful readiness and recovery records. | No persistent defect established by these transient records. No production data, settings, or code was changed based on them; they are not evidence of the PWA failure. Production monitoring remains the operator's responsibility. |
| Completion encountered a shared guidance-note merge conflict | Main had independently saved the same installed-app guidance already present in the task baseline. | PASS: combined the common guidance with the new safety/evidence lessons. Compared the rebased tree to the preserved validated baseline: all application, test, configuration, and evidence files were identical; only a final newline in the note differed. No runtime checks were invalidated. |

## Current verification

- PASS: final pinned-runtime focused client suites: 8 files / 79 tests, including
  coordinator, control, checks, recovery markers, safety, startup, error boundary,
  and field-check confirmation.
- PASS: API mutable-shell header unit tests (5); API route typecheck.
- PASS: library declarations rebuilt; client typecheck.
- PASS: real old/new build output uses `pwa-old-build` / `pwa-new-build`;
  149-entry worker precaches do not include `app-build.json` or other JSON.
- PASS: 20 distinct affected desktop browser cases across Chromium and WebKit:
  manual update, failed-worker retry, unavailable identity/offline reconnect,
  explicit active-work refusal then safe idle, permission-blocked queued intent,
  already-safe Home, automatic stale recovery, active-run recovery refusal,
  confirmed authenticated recovery, and tab-local recovery confirmation.
- PASS: eight additional responsive manual-handoff rows (matrix below).
  Each seeds pending sync and synthetic IndexedDB work and preserves another
  tab's dirty input. Desktop manual cases additionally assert real saved
  navigation preference and run-value keys, not just sentinel settings.
- PASS: final focused fixture confirmation: Chromium unsafe → safe idle (1);
  WebKit strengthened persistence/manual handoff and unsafe → safe idle (2).
  Earlier focused confirmation passed all four authenticated/tab-local
  recovery cases; the final missing WebKit cases passed 4/4.
- PASS: phone sign-in screenshot shows persistent update control.
- BLOCKED (unavailable evidence, not a local implementation prerequisite):
  physical Android Chrome and iOS Safari/installed-PWA verification. No physical
  devices are connected; all mobile/tablet rows below are browser emulation.
- NOT REACHED (intentionally outside scope): publication, production upgrade,
  and full release certification. No production update success is claimed.
- NOT REACHED (not a required changed-flow gate): six existing responsive
  permission-outbox repetitions from the initially truncated broad command.
  Both desktop engines cover that negative path; every responsive handoff row
  directly asserts queue preservation. No failing assertion was disabled.

## Compatibility matrix

| Layout | Chromium | WebKit | Evidence type |
| --- | --- | --- | --- |
| Desktop | PASS | PASS | Real-worker old/new builds; focused operational cases |
| Phone portrait | PASS | PASS | Emulated viewport; reachable Check/Update; confirmed handoff and storage |
| Phone landscape | PASS | PASS | Emulated viewport; reachable Check/Update; confirmed handoff and storage |
| Tablet portrait | PASS | PASS | Emulated viewport; reachable Check/Update; confirmed handoff and storage |
| Tablet landscape | PASS | PASS | Emulated viewport; reachable Check/Update; confirmed handoff and storage |
| Physical installed PWA | BLOCKED | BLOCKED | Device connection unavailable; not represented by emulation |

## Reproduction and evidence boundaries

The genuine two-build regression deliberately makes worker discovery fail, then
publishes a distinct new build. Two ordinary refreshes still run the old shell.
Restoring worker discovery and explicitly retrying reaches the new running
identity without clearing storage. This is a concrete stranded path, **not proof
of the cause on the user's physical installation**.

The identity file is generated alongside the shell, fetched with a unique check
query and `cache: no-store`, and excluded from worker precaching. Production
static middleware marks entry HTML, worker, manifest, and identity responses
`no-store`; hashed assets retain their existing policy. No new API data contract,
database schema, sync merge, counter/autosave, or production records changed.

The only repair-owned persistent writes are bounded tab-local attempt markers
and a twelve-event phase/build history. Business queues, sessions, localStorage,
IndexedDB, and CacheStorage are not cleared. Framework-owned normal precache
installation remains unchanged except for extending worker event lifetimes;
there is no broad cache reset, cancellation cleanup, or destructive fallback.

Historical failures and initial NOT REACHED results above remain part of the
ledger. After the targeted fixes there is no unresolved required local failure.

## Owner-controlled release boundary

This fork was not published. Once merged, any later authorized release should
follow the repository's normal publish-source and release procedure, retaining
its build identity. A public read-only recheck may then compare the official
published identity/headers and a normal client update without clearing data.
That future published/physical observation must remain separate from these
locally verified results; this task is not a production GO certification.

## Focused check commands

All commands used `bash scripts/src/run-release-node.sh` and pinned Node 24.21.0.

- Client Vitest: `pwaUpdateCoordinator`, `AppUpdateControl`, `pwaUpdateChecks`,
  `pwaUpdateRecovery`, `updateReloadSafety`, `pwaStartupSafety`, `ErrorBoundary`,
  and `fieldChecks` (79 tests).
- `pnpm --filter @workspace/run-calculator run typecheck`.
- `pnpm --filter @workspace/api-server exec vitest run src/lib/appShellCache.test.ts`.
- `pnpm --filter @workspace/api-server run typecheck:routes`.
- `playwright test --config playwright.pwa.config.ts` with the named affected
  cases/layouts above, using disposable built artifacts and synthetic records.
  Interrupted/broad output was not counted as a full-suite pass.
- Managed web and API workflows restarted; final web startup clean on its
  assigned port. `git diff --check` used for final whitespace validation.

## Addendum: Run/QC footprint and update-control placement

**Result: PASS for the scoped UI relocation and responsive behavior.**

- Run no longer renders the derived ingredient allergen footprint. Existing
  manual allergen labels, sequencing warnings, production rules, and Start Run
  behavior were not changed.
- QC uses its existing derived footprint and ingredient query, identifies the
  selected run, and retains the visibility-only disclaimer. Component tests
  cover mapped contributors, missing/unreviewed mappings, reviewed-empty,
  substitutions, selected pepperoni types, and run switching without stale
  content.
- App update status/actions now use normal document flow. All nine coordinator
  phases remain available; details and attention copy are scrollable within a
  viewport-bounded control, and the old fixed toast was removed. The update
  coordinator and its reload protections were not changed.
- PASS: focused component tests (3 files, 17 tests), calculator typecheck, and
  the existing manual two-build handoff/storage-preservation browser test.
- PASS: Chromium and WebKit layout browser test at 320×740, 568×320,
  768×1024, 1024×768, and 1280×800 with 150% text sizing. Each primary bottom
  tab was hit-tested and checked for geometric overlap with the expanded update
  control. The test also checks Run/QC placement and selected-run identity.
- PASS: the signed-out `/sign-up` preview displays the failed-update notice and
  Check for updates action in normal flow above the form. Its unauthenticated
  API requests returned 401, as expected for a signed-out browser; no auth
  behavior was changed.
- Sanitized browser captures were produced by the focused test:
  `artifacts/run-calculator/test-results/phone-layout-phone-layout--9c538-owns-the-allergen-footprint-chromium/run-phone-landscape.png`,
  `.../chromium/qc-phone-landscape.png`,
  `.../webkit-update-layout/run-phone-landscape.png`, and
  `.../webkit-update-layout/qc-phone-landscape.png`. These use synthetic
  accounts/runs and are local test evidence, not production captures.

### Failure ledger

| Finding | Status | Evidence and owner/next action |
| --- | --- | --- |
| First signed-in browser attempt reached a stopped preview and returned 502; a later attempt used the remote preview instead of the isolated browser server. | RESOLVED | Started the existing development workflows, then ran the test against local disposable services and an authorized isolated fixture. No production records were used. |
| At 568×320 with 150% text, the update control extended about 2 px into the fixed Run tab area. | RESOLVED | The browser assertion reported the control bottom at 236 px and tab top at 233.8 px. The control now scrolls within a shorter dynamic-viewport cap; Chromium and WebKit both pass the overlap and click checks. |
| An early WebKit run navigated during a layout assertion while the app was idle. | RESOLVED | The test now keeps the page active during viewport changes and waits for the initial document load. The final focused WebKit run passes; the two-build handoff remains covered separately. |
| A manager-only test account without QC capabilities did not render the QC panel. | RESOLVED | This matched the existing authorization boundary. The browser fixture now uses only inventory and QC capabilities; no app roles or permissions were changed. |
| The isolated browser’s QC catalog request returned an error, so its screenshot shows the panel’s explicit unknown state rather than mapped ingredient contributors. | BLOCKED (non-blocking to this presentation task) | The panel fails closed and does not report an allergen-free result. The mapped/unreviewed/reviewed-empty and substitution cases pass in the focused component tests. The separate API diagnostics task owns checking this local catalog request; no API scope was changed here. |
| Physical Android Chrome and iOS Safari/PWA layouts. | MISSING | Only Chromium and WebKit browser emulation were available. No physical-device behavior is claimed or required for this task. |
| Publication and production update verification. | NOT REACHED | This fork was not published; no production result is claimed. |
