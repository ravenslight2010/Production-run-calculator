---
name: AI reviewer + shared corrections memory
description: How the second-pass reviewer AI and the factory-wide name-corrections pool are wired across the 5 AI helpers (web+mobile parity).
---

# Reviewer AI ("second set of eyes")

After a helper's deterministic sanitizer runs, a SECOND AI pass scores each
surviving suggestion: `ok | warn | reject` + short reason. Strictly **advisory**
and **fail-safe** — any error/timeout/non-JSON/empty input yields an empty verdict
map and the original suggestions flow through untouched. Wired into all 5 AI
routes: suggest-merges, optimize, match-import, parse-spec-sheet, fill-missing.

- Server helper `reviewSuggestions()` builds generic `ReviewItem {id,text}` from
  each route's already-sanitized output, calls the model, attaches verdicts by id.
- **Wire contract:** OpenAPI `ReviewVerdict` is `{ status, reason? }` only. The
  lib type (`@workspace/ai-review`) also carries `id`, but `id` is an INTERNAL
  correlation key (the map key like `rec-0`/`brand-1`). `reviewSuggestions()`
  STRIPS `id` before returning, so the attached `review` matches the schema.
  **Why:** earlier the full lib verdict (with id) was attached and drifted from
  the OpenAPI contract. Keep stripping at the server boundary.
- Reviewer makes a real extra model call. The optimize route test therefore
  expects 2 model calls (recs pass + reviewer pass); it pins the recommendations
  prompt via a `firstMessages` capture because the reviewer call overwrites
  `lastMessages`. Routes that produce 0 suggestions skip the reviewer call.
- UI: a shared `ReviewBadge` (web + mobile) renders warn/reject (ok is quiet).
  Mobile state holding verdicts must be RESET alongside the AI match maps when a
  new file is parsed (ExcelImportModal), or stale badges persist across imports.

# Shared corrections memory

One factory-wide pool of confirmed name corrections, domain-tagged from→to
(domains: ingredient, brand, flavor, die, item). **Written on every
name-correcting confirmation in merge, match-import, and spec-import only** —
NOT optimize/fill-missing (those don't confirm name fixes). Additive: each
helper KEEPS its own alias table; corrections are saved alongside, never instead.
Read into every name-resolving AI prompt so a fix learned once is honored
everywhere.

- Merge: saved in `RunContext.mergeIngredients` (web `home.tsx`), right after
  `saveMergeAliases`, each source→target as domain `ingredient`.
- Match-import: saved in the Excel import confirm, domain = alias `type`
  (brand/flavor).
- Spec-import: saved in `commitSpecImport`; `aliasKindToDomain` maps
  brand→brand, flavor→flavor, appType/pepType→item, dough/sauce/cheese→ingredient.
- Mobile client fetch threads bearer (`getAuthToken`) + `x-client-id`; web uses
  `x-client-id` only. Saves are best-effort (`void`, never block the action).
