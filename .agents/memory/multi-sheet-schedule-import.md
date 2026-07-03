---
name: Multi-sheet schedule import
description: How the Excel "schedule planner" (multi-day, day-block) import is detected, filtered, and committed with per-date override on web+mobile.
---

# Multi-sheet schedule import

The run-calculator Excel importer handles TWO shapes through the same dialog/modal:
a flat single-day run list, and a multi-sheet **day-block planner** (the user's real
weekly file: per-day header row `["<Weekday> - Day", <serial>, "Brand","Flavor","Units",...]`
then run rows; subtotal rows have blank brand/flavor and are skipped).

## Detection & parsing
- `parseWorkbookObject` auto-routes: `workbookIsSchedule` → `parseScheduleWorkbook`
  (walks ALL sheets, per-block date + column resolution), else the flat parser.
- Schedule rows carry a per-row `date` (ISO); result sets `multiDay: true`.
- Date serial → ISO is UTC: `(serial - 25569) * 86400 * 1000`.

## The two durable decisions (user-confirmed)
1. **Import only today-or-later.** Entry points apply pure `filterImportFromDate(result, todayStr())`
   ONLY when `multiDay`. The real file has ~1,660 past runs that must be skipped.
2. **Re-import OVERRIDES the prior import per date.** Imported runs are tagged
   (`RunMeta.imported` web / `ScheduledRun.imported` mobile). A new import drops the
   previously-imported runs on each touched date and replaces them, but PRESERVES
   manual runs. Only dates present in the file are touched — absent dates are untouched.

**Why:** the planner is the source of truth for future days, but the floor also adds
manual runs and may have already started an imported run; a blind append would
duplicate on every re-import, and a blind wipe would destroy manual/in-progress work.

## Today's already-ran rows are skipped (user-confirmed)
When the file includes TODAY, rows matching runs the floor already started or
finished are dropped one-for-one by brand+flavor (case-insensitive) via the pure
`skipAlreadyRanRuns` helper in both runExcel copies; unmatched today-rows still
import. The skipped count is surfaced in the import summary/toast.
**Why:** the already-ran runs are preserved anyway, so importing their file rows
duplicated them (once done/in-progress, once as a fresh plan).
**How to apply:** web applies it inside `commitMultiDayImport` against the synced
day's `startedAt`/`endedAt` runs; mobile applies it in each `importScheduledRuns`
CALLER against live `allRuns` — it can't live inside RunContext because
utils/runExcel imports from RunContext (circular import). A started run is left
alone; its file row is skipped (no partial-progress reconciliation).

## Parity note (intentional asymmetry, NOT a bug)
- Web `commitMultiDayImport` additionally preserves imported runs that are already
  `startedAt`/`endedAt` (don't disturb an in-progress/finished day).
- Mobile `importScheduledRuns` only filters `!imported`, because mobile `ScheduledRun`
  is a future-day PLAN object with no started/ended lifecycle — there is no equivalent
  state to preserve. Behavior is equivalent given the different models.

## How to apply
- Web commit loops `payload.byDate`, GET→transform→PUT `/api/sync/:date` sequentially
  with a progress indicator. Mobile does it in ONE `setAppState` override update.
- The dialog/modal hide the single date picker when `multiDay` and show an N-runs /
  M-days / date-range summary instead; `dateValid` is bypassed for multiDay.
- Keep the parser mirrored VERBATIM web↔mobile; keep the byDate commit shape identical.
