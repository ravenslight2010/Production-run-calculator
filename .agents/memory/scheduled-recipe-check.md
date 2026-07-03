---
name: Scheduled recipe-setup warning
description: Advisory card warning managers about scheduled runs whose brand+flavor has no saved/complete recipe profile, so reorder demand silently uses defaults.
---

# Scheduled recipe-setup warning

Managers get a "Recipe Setup Needed" warehouse card listing UPCOMING scheduled
runs whose brand+flavor profile is missing or has no recipe rows. Those runs
make the Reorder/transfer demand projections untrustworthy because demand falls
back to a blank default form.

Detection is the shared pure lib `@workspace/scheduled-recipe-check`:
- `profileHasRecipeData(profile)` — STRICT row-based: true only when a recipe
  ARRAY (doughRecipe / frontlineRecipe / app1-4CheeseRecipe) has rows. Label-only
  fields (`*Type`, `dieType`, `*RecipeName`) deliberately do NOT count.
  **Why:** the reorder/transfer demand projections are computed from recipe rows;
  a profile with types/names but no rows still falls back to default demand, so it
  must be flagged. (This is intentionally stricter than the apps' generic
  `profileObjHasRealData`, which DOES count label fields — do not "fix" it to
  match.) Product confirmed the strict rule.
- `findScheduledRecipeIssues(scheduledRuns, resolveProfile)` — dedups by
  brand+flavor, returns `{brand, flavor, reason:"missing"|"incomplete", dates[],
  totalCases}`. `resolveProfile` returns the RAW saved profile or null.

**Why a raw resolver matters:** the resolver must return the stored profile
*without* the DEFAULT_VALUES overlay, otherwise "missing" can't be told from
"incomplete". Web added `loadRawProfile(brand, flavor)` for this (merges raw
dough+crust stored objects, no default overlay). Mobile's `brandProfiles` already
holds raw partial `RunProfile`s, so `brandProfiles[profileKey(b,f)] ?? null` is
the resolver directly.

**Parity:** both apps build the same scheduled-run ref set (upcoming
`scheduled[date]` entries with a brand), gate the card to `isManager`, and
onSetup jumps to the setup/configure screen via the shared `decideSetupJump`
rule (same lib). The jump must NEVER rename a run that already has an identity,
real form data, or has started/ended — that corrupts it (its recipes/cases/
timers stay behind under the new identity and later pollute the target brand's
profile when saved). Decision: reuse the current run only when it's truly blank
(then go through the normal identity-change flow that loads the target
profile); otherwise append a fresh run for the target brand+flavor; at the
MAX_RUNS cap, tell the manager and do nothing. `runFormHasRealData` (same lib)
is the deliberately-broad "has the operator typed anything" check — recipe
rows, label/type/name fields, or casesNeeded>0 — distinct from the strict
`profileHasRecipeData` detection rule.

**Web gotcha:** don't sequence `addRun()` then `setRunBrandFlavor()` in one
handler — both read the `dayState` closure, so the second call works off stale
state and drops the new run. The jump uses a single-computation
`addRunWithIdentity` in home.tsx instead. Mobile queues functional updates
(`addRun` → `updateSettings` → `applyProfile`), so ordering is safe there
(assistant addRun pattern).

**How to apply:** any change to what counts as "real recipe data" must change
`profileHasRecipeData` in the lib, not the apps — and stay in sync with the
web/mobile profile-has-data checks used elsewhere (spec-import, fill-missing).
