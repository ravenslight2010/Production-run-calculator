---
name: Crust-row dough-name backstop
description: AI parse can omit doughName even when every crust row names the dough in a parenthetical; deterministic sanitize backfill + library-row hydration cover it.
---

**Rule:** Never rely on the parse model alone for the profile `doughName` — the model has been seen extracting the die size from "Parbake crust (CRB Recipe - 12\" Dies)" while omitting the dough name entirely (all 8 profiles on one sheet).

**Why:** A missed dough name silently leaves every imported profile with no dough selected, and users can't tell whether the sheet named one.

**How to apply:**
- `extractSheetCrustDoughName` (lib/spec-import) scans grounding source cells for generic-crust wrapper cells and backfills `profile.doughName` ONLY when the whole sheet names exactly ONE distinct dough that way (never guesses between candidates). Keep this guard if extending.
- The parse prompt explicitly teaches the parenthesized crust pattern; any prompt change bumps `SPEC_PARSE_VERSION` (v8 was this fix).
- Companion rule: when an import assigns a dough/sauce NAME but carries no recipe, applySpecImport hydrates rows (and unset doughball weight) from the existing library pools — otherwise the recipe stays invisible until the user reselects the name by hand. The autofill planner path already hydrates via server pools in the editor applier; keep both paths hydrating.
