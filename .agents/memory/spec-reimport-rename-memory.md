---
name: Spec re-import rename memory
description: Every merge/rename entry point must learn spec-import aliases; paren guard in fuzzy canonicalize.
---

Rule: EVERY entry point that merges or renames a name that can appear on a spec sheet (brand, flavor, dough/sauce/cheese ingredient, appType, pepType) must learn a spec-import alias, or the next re-import of the same workbook resurrects the old name.

**Why:** the importer's canonicalize path only knows aliases + the current known lists; a rename that skips alias learning leaves the sheet's old spelling ungrounded, so it imports as "new" under the dead name.

**How to apply:**
- Ingredient merges/renames: learn under ALL THREE ingredient kinds (dough/sauce/cheese) by default — sheets don't say which pool a name belongs to.
- Brand renames must re-CONTEXT existing flavor aliases (flavor lookup runs with the NEW canonical brand as context) and re-point alias chains.
- Type renames (appType/pepType): chain re-point + self-alias drop, context preserved.
- The saved-parse REUSE path must also remap ALL kinds — brand/flavor, appType/pepType, and recipe-row ingredients — not just brand/flavor; snapshots carry pre-rename names. (Blend-named applicator types stay verbatim, same guard as the fresh-parse path.)
- Fuzzy canonicalize has a paren-signature guard: "X (A)" never fuzzy-snaps onto "X (B)" (parenthetical = distinguishing info); same-paren typos still fuzz.
- Regression coverage: `artifacts/run-calculator/src/specReimportRenameMemory.test.ts` (real workbook bytes, deterministic fixture parse; learn-helper internals need a global fetch stub — vi.mock can't intercept module-internal calls) and `lib/spec-import/src/parenIngredientGuard.test.ts`.
