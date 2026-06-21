---
name: Recipe apply/undo shared lib
description: Where the recipe-suggestion Apply/Undo decision logic lives and how each app plugs into it.
---
The pure decision logic for applying an AI recipe suggestion (validate recipeId, resolve+validate target run, sanitize rows, compute prev/next, build the Undo closure) lives in `@workspace/recipe-apply`. Both web (`pages/home.tsx`) and mobile (`(tabs)/assistant.tsx`) call `applyRecipeSuggestion(s, runId, deps)` and supply only three glue callbacks: `resolveTargetId` (apply `runId ?? currentRun` fallback + existence check, return id or null), `readPrevRows` (return the run's raw stored value for the field — lib normalizes), and `write` (replace the field's rows + persist/schedule sync).

**Why:** the two inline copies were byte-for-byte parity-critical but buried in platform form/state plumbing, so they could silently drift (replit.md parity rule). Same pattern as `@workspace/fill-missing` / `@workspace/inventory-math`.

**How to apply:** the lib owns `RECIPE_FIELD_IDS` (the 6 recipe field keys) as the single source of truth; both apps' `aiRecipe.ts` still define their own copy for the assist builder, but the *validation* set used by apply is the lib's. If you add a recipe field, update the lib constant too. Behavior is locked by `artifacts/run-calculator/src/recipeApply.test.ts` (pure unit test) plus the existing UI-flow test `recipeAssistApply.test.tsx`.
