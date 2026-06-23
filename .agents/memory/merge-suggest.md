---
name: AI merge suggestions + learned aliases
description: How the AI ingredient-merge assist and its learned alias memory are split between the shared lib, server, and the two clients.
---

# AI merge suggestions + learned aliases

Adds an AI assist on top of the existing ingredient-merge feature, plus a
factory-wide learned memory of past merges. Strict web+mobile parity.

## Shape of the system
- Pure logic lives in lib `@workspace/merge-suggest` (unit-tested, no IO):
  alias key/normalize, `collectMergeAliases` (confirmed merge -> source→canonical
  aliases), `suggestionsFromAliases` (remembered groups, guarded so only names
  that still exist in the current universe surface), `mergeSuggestionLists`
  (combine remembered + AI by shared target), and `sanitizeMergeSuggestions`
  (untrusted AI output -> keep only groups whose target AND every source are real
  universe names, dedupe, one-group-per-target, bounded).
- Server: `merge_aliases` table + `GET/POST /merge-aliases` behind requireAuth
  only (NOT manager-gated) mirroring the specImportAliases route (app-level
  case-insensitive upsert, drops self-refs). AI route `POST /ai/suggest-merges`
  is manager-gated + rate-limited like the other `/ai/*` routes, json_object mode.
- Clients are thin glue (`mergeSuggest.ts` web, `context/mergeSuggest.ts` mobile):
  fetch aliases, call AI with the merge universe, combine remembered + AI, return
  groups for a mandatory review list. Aliases are saved best-effort on EVERY
  confirmed merge (web `handleApplyMerge` before reload; mobile `mergeIngredients`
  after success), so manual merges also teach the system.

## Gotchas
- **Cost-guard cannot trust raw body length.** `validateSuggestMergesBody` must
  return a fully sanitized payload (trim, drop blanks, ci-dedupe names, cap each
  name length, sanitize+filter aliases) and BOTH the prompt builder and the
  sanitizer must consume that cleaned list — never the raw `body.names`.
  **Why:** the count guard originally filtered blanks only for the check but
  returned/prompted the raw array, so blank-string padding bypassed
  `MAX_MERGE_NAMES` and could explode prompt size/cost on the paid model path.
- Prompt shaping is server-side (contract-first) so both clients stay identical;
  don't reimplement the prompt or sanitizer per client — call the lib/route.
- Alias save is intentionally best-effort: a failed `/merge-aliases` POST must
  never block or roll back the actual merge.

## Auto merge-check after recipe import
A spec/recipe import auto-runs the merge check (imported cheese/mix recipe
ingredients can duplicate standalone individual ones). Trigger only when the
import actually added recipes (`summary.totalRecipes > 0`).
**Why timing matters:** bump the trigger counter AFTER the import is committed +
lists reloaded, then run the scan from a counter-keyed effect — so `mergeUniverse`
already reflects the new ingredients (running it inline would scan the stale list).
**Fire-and-forget:** the scan must never block/fail the already-committed import
(`suggest()`/`handleSuggestMerges()` swallow their own errors).
**Parity:** web navigates to Setup→Merge and shows an explainer banner; mobile
(single scroll screen, no tabs) just runs the scan in the always-rendered
MergeManager via an `autoSuggest` counter prop + same banner. Both clear the
banner on manual load/apply/ignore.
