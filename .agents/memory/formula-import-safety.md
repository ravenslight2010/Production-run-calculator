---
name: Formula import safety
description: Ingredient-level import diffs must preserve recipe units and provide a reversible pre-import state.
---

Formula imports compare ingredient rows in the recipe's native unit (`batch` or
`perPizza`), classify structural changes separately from quantity changes, and
pair identical formulas under different names as renames. A pre-import local
master-data snapshot should be recorded with the source filename so an
accidental replacement can be undone.

**Why:** Batch pounds and per-pizza ounces are not interchangeable, and an
empty or partially parsed workbook can otherwise erase a valid formula while
appearing to have imported successfully.

**How to apply:** Reuse the shared formula guard for every workbook importer;
keep source snapshots/reversal records separate from the incoming spec snapshot.