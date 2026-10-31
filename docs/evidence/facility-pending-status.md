# Pending facility-edit status verification

Date: 2026-10-30. Scope: development/task workspace only; not a production
readiness or physical-device assessment.

## Outcome

Managers with `manage-factory-settings` see the current owned queue count while
facility edits await server confirmation. Failed or malformed responses do not
clear it. Canonical acknowledgments update the count, including partial delivery.
The status has no removal control. Unreadable queue evidence shows an explicit
unknown-count message rather than zero; staff and unrelated identities/scopes
cannot see the pending status.

The projection uses the existing directory subscription. Queue writes notify it
after storage changes. Existing transport/save-guard count semantics, queue
ownership, conflict rules, and server authorization are unchanged.

## Checks

- PASS: 42 focused tests before base refresh, then 52 after incorporating
  the main project's rejected-acknowledgment coverage, across `FactoryDirectoryStatus.test.tsx` and
  `factoryDataSync.test.ts`. Includes setting-only enqueue notifications,
  coalescing, partial acknowledgment, rejected/malformed acknowledgments,
  retained reload state, pure unreadable-count reads, permission changes,
  sign-out, and live/sandbox isolation.
- PASS: root `pnpm run typecheck` during implementation.
- PASS: calculator package `typecheck` after separating the display projection
  from the existing transport/save-guard getter.
- PASS: restarted web workflow served Vite without startup errors.
- PASS: `git diff --check`.

Commands used the repository's `scripts/src/run-release-node.sh` wrapper with
the inherited `NODE_OPTIONS` removed, retaining its pinned runtime and CA policy.

## Isolated browser recovery matrix

Command:

```sh
env -u NODE_OPTIONS BROWSER_TEST_INSTALL_WEBKIT=1 \
  bash scripts/src/run-release-node.sh env npm_config_offline=true \
  bash scripts/src/run-isolated-browser-suite.sh \
  --playwright-config=playwright.home-deferred-panels.config.ts \
  --grep 'pending facility edit is acknowledged once'
```

The named fixture creates a generated manager and owned pending edit in
disposable PostgreSQL. It blocks delivery, verifies the visible count against
the whole owned queue and absence of discard controls, reloads with the edit
still retained, reconnects, verifies canonical acknowledgment and database
persistence, and confirms disappearance of the status before and after reload.
Unrelated queues/outboxes remain unchanged. The isolated runner cleaned up its
database.

| Emulated viewport | Chromium | WebKit |
| --- | --- | --- |
| Desktop 1440 × 900 | PASS | PASS |
| Phone 390 × 844 | PASS | PASS |
| Tablet portrait 768 × 1024 | PASS | PASS |
| Tablet landscape 1024 × 768 | PASS | PASS |

Generated cropped pending-status screenshots are ignored local test outputs at
`artifacts/run-calculator/test-results/home-deferred-panels/*/pending-facility-status.png`.
The desktop Chromium screenshot was visually inspected: readable count and
retention warning, with no account identifier or setting payload.

Staff denial and scope changes were checked in component/unit tests rather than
a separate browser journey. Physical Android Chrome, iOS Safari, installed PWA,
and native-mobile testing are **not applicable** to this web-only task.
Release-wide gates were **not run**, as this is an ordinary feature task.

## Failure ledger and resolution

1. The initial browser assertions expected exactly one pending edit. All eight
   projects reached the status and failed because Home legitimately queued
   additional facility settings during bootstrap (two or five total). This was
   a fixture assumption, not a false UI count. Fixed the fixture to compare the
   displayed total with the actual owned queue while independently requiring
   the seeded edit's exact payload before and after reload. The same tester
   reran only this failed recovery flow: all eight projects passed, including
   the previously unreached reconnect and acknowledgment checks.
2. The browser runtime printed a host-dependency warning. It did not prevent
   either browser engine from running; the final matrix has no skipped cases.
3. Inspection found the existing count getter is also used by Home save guards.
   Preserved that getter unchanged and introduced a separate pure,
   capability-gated display projection rather than weakening guard errors.
   Focused tests and calculator typecheck passed afterward.
4. Main-project synchronization conflicted at the shared browser fixture's test
   declaration: incoming coverage parameterized valid, malformed, and stale
   acknowledgments, while this task added `testInfo` for screenshots. Preserved
   all three incoming variants and added the `testInfo` argument. Focused tests
   (52), calculator typecheck, and Playwright discovery of all 24 reconnect
   combinations passed on the resolved tree. Discovery is syntax/inventory
   evidence, not a claim that the two additional incoming variants were rerun
   in browsers by this task; the eight-layout recovery run above exercised the
   valid-acknowledgment journey.

No unresolved task-scoped failures remain. No shared or production database was
used for the browser fixture.
