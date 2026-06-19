---
name: Excel import/export + QuickBooks CSV
description: Durable constraints for the run .xlsx/QuickBooks interchange shared across web+mobile.
---

# Excel/QuickBooks run interchange — constraints

**Exported batch totals must come from one shared formula, never a platform calc engine.**
The web and mobile run-calc engines intentionally diverge (web dough is fractional `totalPizzas/effYield`; mobile dough ceils and uses a casesLeft basis), so feeding the export from each engine produces *mismatched* Dough/Sauce numbers across platforms.
**Why:** replit.md requires identical formulas web+mobile. The fix is a single `computeExportBatches(ExportBatchInput)` mirrored verbatim in both `runExcel.ts`, fed by a thin per-platform field adapter (web `targetDoughballWeight` ↔ mobile `doughballWeightOz`, etc.).
**How to apply:** when adding/changing any exported computed column, put the math in the shared function and map fields in each adapter — do not call `computeSummaryStats`/`computeCalc` for export values.

**Import must rehydrate and merge the FULL existing day payload, then append.**
Reconstructing a subset of existing runs (e.g. only id/brand/flavor/notes) silently drops run metadata (started/ended times, stoppages, actuals) and day-level fields (shiftNotes, recipe presets) — a data-clobber bug. Spread the fetched `SyncPayload` and only override `dayState.runs`/`runValues`.
**Why:** import is specified as additive scheduled-run creation with no clobber.

**Mobile UI components live in the repo-root `components/` dir, not `app/components/`.** The `@/*` alias maps to the artifact root (`./*`), so `@/components/Foo` resolves to `<artifact>/components/Foo`; a file under `app/components/` won't resolve.

Other contract notes: import is additive→creates SCHEDULED runs; create-new brand/flavor is permission-gated (web supervisor, mobile supervisor-pin); unresolved rows skipped; QuickBooks CSV is zero-amount reference records (run totals). Spreadsheet error row numbers are 1-based incl. header (`i + 2`).

**Excel upload is surfaced in two places per platform; the in-scheduler one is day-scoped.** Web has both the menu "Import Excel" (commits to server via `commitExcelImport`) AND an "Import Excel" button inside the Schedule editor; the editor button parses into the *in-memory* editor (`importExcelIntoEditor` → `scheduleEditorRuns`/`RunValues`, drops blank placeholder rows) so the user reviews then hits "Save Schedule" — it does NOT PUT directly, avoiding double-PUT conflicts with unsaved editor edits. A single `ExcelImportDialog` instance is reused; `importIntoEditor` flag switches `onConfirm`, `importDefaultDate` seeds the date. The dialog overlay must be `z-[60]` (schedule dialog is `z-50`) or it renders behind. **Why:** dialog renders earlier in DOM than the schedule modal, so equal z-index hides it. Mobile has both Summary and Schedule-screen import buttons; both go through `ExcelImportModal`+`addScheduledRun`, Schedule one defaults date to `selectedDate`. Web schedule-editor rows have no notes field by design, so imported `notes` are dropped on that path only (mobile keeps them).
