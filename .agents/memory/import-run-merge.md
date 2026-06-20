---
name: Excel import duplicate-run merge
description: mergeImportRuns collapses same brand+flavor imported runs; parity rule
---

# Excel import duplicate-run merge

`mergeImportRuns(runs)` (in both web `src/utils/runExcel.ts` and mobile
`utils/runExcel.ts`, verbatim mirror) is called inside `buildCommit()` in both
import components. It runs AFTER brand/flavor names are resolved to their saved
canonical values, then collapses runs sharing the same brand+flavor
(case-insensitive, trimmed) on the same day into one: cases summed, distinct
notes joined with "; ", first-seen order preserved, first-seen casing kept.

**Why:** a spreadsheet can list the same product on multiple rows for one day;
without merging the importer would create several tiny duplicate runs instead of
one combined run. Keep the two copies identical (replit.md parity) — any change
to the merge key or note-join must land in both files together.
