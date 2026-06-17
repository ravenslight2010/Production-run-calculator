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
