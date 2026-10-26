# Break planning and estimate repair

This is a local repair record, not a production-readiness or physical-device
certification. Raw, sanitized working evidence and the detailed failure ledger
are retained under `.local/evidence/break-planning/`.

## Confirmed source defects

- Schedule's z-70 parent covered the shared touch modal's z-50 portal. A controlled
  phone-sized Chromium experiment restoring those old layer values hid the open
  picker behind Schedule; restoring the scoped layer made the choices visible.
  This recreates the source defect, not the customer's exact hardware/session.
- The prior estimator added freezer time even without valid line inputs. Missing
  line inputs with a 15-minute freezer setting therefore yielded 15 minutes.
  The customer's screenshots do not establish which saved inputs they had.
- Editor and summary used different live-duration inputs, and the editor omitted
  actual lifecycle timestamps and did not consistently estimate draft quantities.

## Repair contract

Schedule-owned touch portals use a scoped layer above Schedule; unrelated dialogs
keep their existing default layer. A picker disabled while open dismisses without
applying a choice. Desktop native selects remain available.

Preview and Day timeline share the run-estimate adapter. Dough uses the established
effective rate; crust mode uses approximate pizzas/min. Positive temporary overrides
remain effective. Planned duration is cases × pizzas/case ÷ pizzas/min, plus one
freezer/line transit window. No setup/changeover allowance was added.

Live estimates use cases still to package plus any unfilled transit window. Pauses
freeze elapsed fill and assume resume now. Existing resume-shifted starts are not
adjusted twice. Actual run ends are preserved even if product was still draining;
actual overlapping runs keep their timestamps. Upcoming runs are conservatively
sequential through packaging clear.

Unknown or invalid inputs remain unknown, propagate through downstream runs and
prevent a dependable whole-day finish claim. The UI exposes the actual/live/paused/
planned basis, source units, effective rate, missing inputs and transit assumption.
Today's draft uses current progress and real identities; future dates do not borrow
today's activity. No new per-second subscription was added to the main editor.

All three planned breaks remain fixed at 30 minutes. Invalid/missing references and
pending clock placements are explicit; planning never automatically pauses production.
The authorized persistence route, database schema, recipe inputs, sync merge contract,
and authoritative counters are unchanged.

## Verification

- Full workspace `pnpm run typecheck`: PASS, using the supported pinned-runtime runner.
- Focused timeline, dialog layering, touch component and clock-isolation regressions:
  **59 distinct tests across 7 files PASS** across the focused batch and final
  clock/evidence-classification checks, including date overflow and local 12/24-hour
  display, authoritative per-run packaging storage, and existing packaging-register
  regressions. No unchanged passing surface was re-tested solely for completion.
- Supported calculator typecheck after that final numerical guard: **PASS**.
- Shared live-calculation suite: **7 files, 51 tests PASS**.
- Managed local web/API startup: running; proxy health returned HTTP 200 and the
  signed-out landing page rendered. Protected UI evidence uses disposable fixtures.
- Browser compatibility and persistence results are recorded in the working evidence
  matrix; see the final outcome section below.

## Final browser outcomes

Changed journey assertions were reached and passed in desktop Chromium/WebKit,
Android-sized touch Chromium, phone WebKit, short-landscape phone layouts, and
tablet portrait/landscape layouts in both engines. They checked real touch triggers
and options, topmost hit targets, all slots/modes, dismiss/reopen, authorized Save,
reload, cancellation, and identical preview/Summary finish for a fixed fixture clock.
Manager/operator and authorized-supervisor native-select cases passed. Narrow
200% font/keyboard checks passed across all ten layouts.

**Browser commands were not all green.** The last remaining-layout command exited
with **2 failed / 7 passed**. The two tablet journey tests passed their changed-flow
assertions and failed only the final console gate on WebKit's old-document fetch
cancellation diagnostics. The final bounded evidence classifier was checked against
the captured message shape, including different observed API/page origins and
negative cases, using cheap deterministic tests rather than repeating completed
save/reload journeys. No final green aggregate browser command is claimed.

Earlier blocked, failed, interrupted and not-reached outcomes are retained in
`.local/evidence/break-planning/browser-report.md` and `REPORT.md`; later narrow checks
cover the previously unreached layouts. In particular, the initial baseline did not
reach Schedule, and cannot establish a customer-device freeze reproduction.

Clock choices inside an unfinished run remain explicitly pending rather than being
silently converted to after-run breaks. The final branch is unit-tested and restores
the original pending behavior; the browser fixtures' 23:00 clock is outside run
windows. That small correction does not invalidate the exercised browser flows.

## Authoritative progress reconciliation

Every today's run, selected or unselected, now receives its own authoritative
packaging register after choosing recipe/draft inputs. A shared read-only adapter
is called by both Schedule and Summary. It overlays only skids/loose cases; Schedule
keeps its draft case quantity, pack and rate. Future-date plans never read today's
register. No progress writes, stamp rules or sync transport were changed.

The actual storage-to-estimate regression deliberately disagrees: an unselected
active run's saved form says zero packaged, while its durable register says
60/100 cases. At 12 pizzas/case, 40 pizzas/minute, after 20 active minutes with
15-minute freezer transit, both views calculate 12 minutes remaining and finish
06:32, not the stale snapshot's 06:50. Tests also verify draft quantity/rate retention,
nonmutation, future isolation, and both production views' use of the adapter.

This was the completion check's actionable finding and has been repaired. The final
targeted packaging-path batch passed 14 tests in two files, and the supported
calculator typecheck was repeated for the changed production adapter. Existing
browser fixtures have equal/empty packaging registers; their interaction evidence
remains valid, while the disagreeing-register branch is covered by the focused
storage-path tests rather than another full browser pass.

## Failure accounting and limits

Working evidence preserves failed setup/assertion attempts instead of counting them
as passes: an exact accessible-name mismatch before reaching Schedule; numeric-union
type errors fixed before the passing typecheck; source edits during a paired build
rejected by the identity fence; visible-text versus hidden-details text comparison;
an auxiliary layer experiment's style timing and hidden-parent role query; and
diagnostic capture that mixed authentication bootstrap errors with journey errors.

An unrelated authenticated request to `/api/background-operations/diagnostics`
returned 404 in the disposable fixture. Its existing handler module was not found
mounted in the router composition. This remains a separate manager-health defect;
it is not classified as a successful API response or repaired by changing break
planning. Repair and a broader missing-route regression guard were proposed
separately (#3718 and #3719).

Physical Android Chrome and iOS Safari/PWA were not run: no authorized handset or
device-service session was available. Emulation is explicitly separate evidence.
No customer-specific corrected finish, production-data repair, full release check
or publishing action is claimed.
