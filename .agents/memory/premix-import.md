---
name: Premix sheet import
description: In-app premix .xlsx import in the Mixes section (web+mobile) — deterministic parse lib, AI name-only matcher, per-mix review, and contract/parity gotchas.
---

# Premix sheet import

Managers upload premix `.xlsx` workbooks in the **Mixes** section on BOTH apps. Each
product tab/block → a Mix (name, AI-matched brand+flavor, `batchSize` = the block
"Total"/"Per Batch" lbs, `components[{ingredient, perPizza}]`, `daysEarly` + raw
"Pull N Days Early" note). Re-import upserts by deterministic id (no dupes). Quantities
are parsed DETERMINISTICALLY in the shared lib; AI ONLY disambiguates product names.

## Decisions / gotchas

- **The import is per-mix confirmation-based AND per-mix re-matchable, not all-or-nothing.** The
  review dialog/modal MUST list every parsed mix (matched product, batch size, ingredient count,
  days-early note, new/update badge) with an include/exclude toggle AND brand/flavor re-match
  pickers so a manager can correct a wrong AI/auto product match before applying.
  **Why:** an aggregate "N new / M updated" summary alone was rejected — a bulk operation that
  overwrites existing master-data needs candidate-level sign-off; and a wrong product match must
  be fixable in the same pass rather than re-importing.
  **How to apply:** `buildPremixCandidates` (lib) feeds the prepared result; re-match goes through
  the pure `rematchPremixCandidate(candidate, brand, flavor, exists)` (rebuilds the mix id via
  `premixId`, recomputes new/update). `commitPremixImport(prepared, mixesToApply: Mix[])` now takes
  the FINAL reviewed `Mix[]` (NOT selected ids) so edited matches are carried through. Selection
  state in the UI MUST be keyed by the ORIGINAL parsed mix.id (a stable key), because re-match
  changes the candidate's own id. Changing brand resets flavor (`rematch(key, newBrand, "")`).

- **Brand/flavor auto-attach: the sheet TAB name is truth, block labels lie.** Blocks are
  copy-pasted between products (a Basha tab's block can literally say "Corner Booth Hawaiian"),
  so `splitPremixName` prefers the tab over the block name, with token-normalized brand-prefix
  matching (case/punctuation/apostrophes stripped, inch marks 7in/7"/7' unified, 1-edit typo
  tolerance for words ≥4 chars) and a unique in-order token-subsequence flavor fallback
  (`matchFlavorBySubsequence`, ambiguity → no guess). Unresolved mixes are sent to the AI matcher
  under `premixMatchName(mix)` (tab if ≥2 tokens, else block name), and `applyPremixMatches`
  keys on that name first. **Gotcha:** because AI matches are tab-keyed, both apps' glue MUST
  apply them only to mixes that were actually unresolved (`grounded[i].productResolved` guard +
  `onlyNames` arg) — otherwise a tab-level AI match silently overwrites a correctly-resolved
  sibling block on the same tab.

- **Match-premix request body field is `unmatchedNames`, NOT `names`.** The server contract
  requires `unmatchedNames`. The client glue uses a hand-written local request type + raw
  `fetch`, so a wrong field name TYPECHECKS CLEAN but every call 400s and silently falls back
  to deterministic-only grounding (AI never runs). If AI matching "does nothing", check this
  field first. **Why:** the local types aren't anchored to the generated schema (same pattern
  as the existing import matcher) — drift is invisible to tsc.

- **Import action is gated on `isManager`** (inside the `canManageInventory` Mixes section) on
  BOTH apps. **Why:** parity — web chose manager-only for the import action; mobile must match.

- AI is advisory/fail-safe: any failure (not a manager, AI down, sync disabled) is caught and
  the import proceeds with deterministic grounding. Writes go ONLY through the existing
  manager-gated `saveMixes` path. Mixes are master-data — NOT in `/sync`.

- Reuses learned spec-import alias memory and mirrors new brand/flavor mappings into the
  factory-wide AI corrections pool (both best-effort).

- **Junk-file guard is the SHARED `gridSanityIssue` from `@workspace/spec-import`** — both
  premix prepare paths run it per file BEFORE the deterministic parse / AI matcher (xlsx
  "reads" garbage bytes as one junk sheet without throwing). Failures become the per-file
  "could not be read … skipped: <name>" note (or a plain-language throw when everything is
  junk). **Why:** never fork the thresholds/wording — spec + premix importers must reject
  wrong-type picks identically. Mobile maps a failed native read to `[]` grids, which the
  same guard flags as the empty-workbook message.

- **"Pull N Days Early" notes auto-suggest freezer-pull settings.** `parseBlock` extracts
  `pullIngredients`: an ingredient whose OWN cell embeds the note (name via `pickNameFromCell`,
  which strips the note line), OR a standalone note within 4 rows above the block anchor flags
  the block's FIRST component. Notes far away (bottom "PULL OLD MIX" lines) stay mix-level only —
  no ingredient suggestion. `groundPremix` canonicalizes pulls like components;
  `collectPremixFreezerPulls(parsed)` keys suggestions by `premixId` (same key as review
  candidates, so the dialog attaches "Sets freezer-pull reminder" per row and only applies pulls
  for INCLUDED mixes). `commitPremixImport(..., freezerPulls)` applies them best-effort AFTER the
  mixes commit via `buildFreezerPullUpserts` → returns `{freezerPullCount, warning?}` (never
  throws; mixes stay applied). Web+mobile parity (mobile glue imports from
  `./freezerPull`); the strip-imports parity harness must stub `__FREEZER_PULL_LIB__` +
  fetch/save freezer-pull stubs.

- **Pull ANNOTATION mini-tables must fold into the real mix, never become a phantom mix.**
  Real sheets often place a standalone `***Pull N Days Early***` note at the NAME position with
  its own header row `Per Pizza | Per Skid/Batch | Total Needed` plus one ingredient row — its
  "Per Pizza" cell creates a phantom anchor that used to parse as a bogus second mix (sometimes
  stealing a footer label like "AMOUNT BEING MIXED" as its name).
  **Why:** the review dialog showed junk second mixes and the pull didn't attach to the real mix.
  **How to apply:** annotation = no name (after `findBlockName` skips STOP labels) + daysEarly>0 +
  note within the 4-row name window + `Total Needed` at `perPizzaCol+2`. `parsePremixWorkbook`
  folds it into the closest real block on the sheet (min ingredient-column distance, tie → earlier
  row): appends its pull ingredients and sets `pullDaysEarly` (never touches the target's own
  `daysEarly` — that means "MAKE the mix early"). `collectPremixFreezerPulls` uses
  `pullDaysEarly ?? daysEarly`. Annotation-ONLY sheets (no sibling mix, e.g. a pep-&-jal
  garlic-sauce sheet) keep the annotation as a carrier mix so the pull still has a home in review.
