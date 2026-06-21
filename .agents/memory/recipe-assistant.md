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
