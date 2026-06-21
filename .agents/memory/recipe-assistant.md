---
name: AI Recipe & Ingredient Assistant
description: Staff-facing single-shot AI helper to scale recipes / suggest substitutions / explain formulas, grounded in real recipe data.
---

# AI Recipe & Ingredient Assistant

Staff-facing (requireAuth, NOT requireRole — like /ai/ask) single-shot Q&A over the
current run's real recipes. Three jobs only: SCALE a recipe, suggest a SUBSTITUTION
(prefer the known-ingredient pool), or EXPLAIN a formula. Advisory only — never edits
a recipe; server never writes anything. Rate-limited 10/min per user (Postgres store
in prod).

**Why it's distinct from /ai/ask:** ask-the-day keeps per-user conversation memory and
grounds in day-state. The recipe assistant deliberately does NOT pass a userId to the
grounding helper, so it never pollutes the day-ask conversation thread. It is single-shot
(no follow-up memory); the client renders a local user/assistant bubble thread only.

**How to apply / parity notes:**
- Grounding: `groundPromptWithMemory(..., { facilityDomains: ["ingredient","general"] })`
  + `appendCorrectionsBlock(..., ["ingredient","brand","flavor","die"])`. Both fail-safe.
- The wire builder `buildRecipeAssistContext(settings, ingredientNames, context)` is
  IDENTICAL verbatim in web `src/aiRecipe.ts` and mobile `context/aiRecipe.ts`. Recipe
  field keys (doughRecipe, app1-4CheeseRecipe, frontlineRecipe + *Name) are identical on
  both platforms, so only the call-site extraction differs.
- frontline recipe is tagged kind "sauce" (frontline IS the UI Sauce recipe).
- Doughball weight: web call site passes `v.targetDoughballWeight`, mobile passes
  `run.settings.doughballWeightOz` (same meaning, different field name). brand/flavor on
  mobile live on `run.settings`, NOT on the RunState object.
- Only non-empty recipes and >0/non-blank context fields are sent (strict grounding).
- Server prompt/sanitize tests live in api-server (`aiRecipeAssistant.test.ts`), mirroring
  `aiAsk.test.ts` — NOT in the web shared harness.

## Confirm-first one-tap suggestion apply
The assistant may return an optional STRUCTURED `suggestion` (scale|substitute) the worker
applies in one tap. The model is untrusted, so the design rule is: a suggestion is only ever
APPLYABLE and ON-TARGET, never auto-applied.

**Why structured + id round-trip:** applying through the EXISTING recipe write paths (no new
write surface) needs the exact resulting rows plus an unambiguous target. So each recipe sent
to the model carries a stable `id` = its settings field key, and the model must echo it back as
`recipeId`. Free text alone couldn't be applied safely.

**Trust-boundary rule (server `sanitizeSuggestion`):** drop the WHOLE suggestion unless kind is
scale|substitute, `recipeId` is in the `knownRecipeIds` set the route derives from the recipes
it actually sent, and at least one real row survives (non-blank ingredient, finite ≥0 lbs).
This is what stops hallucinated/off-target writes — keep it strict.

**Parity rule:** apply is the only platform-specific glue (web: react-hook-form setValue +
field-array replace + existing save/push; mobile: `updateRunSettingsById`). Field keys are
identical (`RECIPE_FIELD_IDS`, exported from both `aiRecipe.ts`), both gate on it, and both
return an undo restoring the prior rows — so behavior stays identical without sharing the writer.
Read prior rows defensively (`Array.isArray` before `.map`); persisted state isn't guaranteed
to be an array.

**Run-target rule:** a suggestion applies to a CHOSEN run, not implicitly the current one.
`applyRecipeSuggestion(s, runId?)` defaults runId to the current run but validates it against
the day's runs and bails with "Run no longer exists" otherwise. Shared type `RecipeApplyTarget
= { id; label }` (exported from both `aiRecipe.ts`) feeds a run picker the SuggestionCard renders
ONLY when >1 run. Web's current-run path must still use the live form writers + saveRunValues
(not a blind persisted overwrite) — only OTHER runs go through `{ ...DEFAULT_VALUES,
...loadRunValues(targetId), [recipeId]: next }` + saveRunValues(targetId). Mobile uses
`updateRunSettingsById(targetId, ...)` for any run (current or not). Undo restores the chosen
run's prior rows on both.
