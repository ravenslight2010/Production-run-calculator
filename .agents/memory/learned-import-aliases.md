---
name: Learned import aliases
description: Server-persisted brand/flavor name mappings confirmed during Excel import, auto-applied on future imports across all users.
---

# Learned import aliases

When a user confirms a non-exact match of an imported brand/flavor name to a
saved name during Excel import, the mapping is persisted server-side
(factory-wide, shared by ALL signed-in users) so future imports auto-apply it
instantly — no AI call, works for operators too.

**Why:** repeated imports from the same external source kept re-presenting the
same fuzzy/AI guesses; remembering a human-confirmed match removes that friction
and makes results deterministic.

**How to apply:**
- Storage is its own table, NOT the /sync day-state payload (see
  `sync-body-limit.md` — never embed aliases into sync, it already outgrew limits).
- Endpoints sit behind router-level `requireAuth` only — intentionally NOT
  manager-gated (role-gating.md: contribution must be open to operators).
- The pure collector is mirrored VERBATIM across web+mobile runExcel.ts; it only
  emits real saved matches (not Create/Skip) where imported != canonical
  (case-insensitive). brandContext = canonical parent brand for flavors, null for
  brands.
- Priority order in the dialog/modal: **learned alias > AI > fuzzy**. The AI
  request is gated until aliases have loaded AND skips any name an alias already
  covers, so a learned match always wins over a fresh guess.
- **Apply guard (both auto-apply effects):** only fill a SKIP choice when the
  saved target still EXISTS in the current master data — brands check
  `brands.includes(v)`, flavors check the brand's option list. A stale alias must
  NOT lock in a now-deleted name; leaving it SKIP lets AI/fuzzy correct it. This
  was an easy bug to miss on the flavor side (brand side had it, flavor didn't).
- Saving on confirm is best-effort (`void save().catch()`), never blocks import.
- Server upsert is app-level (select→compare→insert/update), case-insensitive by
  `(type, externalName, brandContext)`. No DB unique index yet, so it is not
  hardened against truly concurrent POSTs of the same new key — acceptable given
  imports are infrequent, manual actions.

## Manual review renames must also be learned (spec import)

The spec importer's review dialog lets the user hand-edit brand/flavor names
(Step 1). Those manual edits must ALSO be captured as learned aliases — the
automatic `collectSpecAliases` only learns matches the canonicalizer/AI found,
so hand-typed corrections were forgotten on re-upload of the same sheet.

**Why:** the user re-uploaded a sheet and every rename came back wrong.

**How to apply:**
- Learn a rename with the RAW sheet label as `externalName`, not the shown
  name: the shown name may itself be a prior alias target, and a chained alias
  (raw→shown plus shown→edited) gets discarded wholesale by
  `dropConflictingSpecAliases` on the next import — including the previously
  good raw→shown one. Re-point every prior alias whose canonical == shown to
  the edited name; the server upserts by (kind, externalName, context) so the
  old row is replaced.
- Only learn a rename when it is consistent across the whole review (same
  shown brand renamed the same way everywhere); aliases are global per kind.
- A flavor alias's context is the CONFIRMED brand (brand alias applies before
  flavor canonicalization on re-import).
- Pure logic: `collectSpecRenameAliases` / `mergeSpecAliases` in
  `@workspace/spec-import`.

## "Use existing recipe" picks are learned too (cheese/mix only, appType kind)

A manual "Use existing" link pick in the spec review (cheese/mix recipe rows)
is learned as an `appType` alias (parsed sheet blend name → chosen existing
recipe name) and, on the next import, PRE-SELECTS the link in the review
instead of silently renaming.

**Why:** the user re-imported a sheet and it recommended "create new recipe"
every time even after they had linked the blend to the right existing recipe.

**How to apply:**
- `appType` is deliberately the blend-name namespace (same kind the old learned
  cheese-name links / the once-poisoned aliases lived in) — do NOT invent a new
  alias kind without a server contract change.
- **Picks are learned as TWO rows:** context:null (legacy factory-wide
  fallback) + context:<brand> (brand-scoped, via `blendLinkSuggestionKey`).
  The brand-scoped row wins at suggest time. Why: two brands whose sheets use
  the same generic blend name ("Cheeseburger Cheese Mix") were clobbering each
  other's remembered pick in the context-free namespace. `specAliasKey`
  includes context, so both rows coexist through merge and server upsert — no
  contract change needed.
- Suggestion is advisory + guarded: only pre-select when the remembered target
  still exists in that kind's saved pool (stale-target guard, same rule as the
  brand/flavor apply guard above).
- Dough/sauce "use existing" picks are learned under the `recipeName` alias
  kind with context = the parse kind ("dough"/"sauce") — NOT appType, which
  would pollute the blend namespace.
- **"Update it with this sheet" checkbox:** a linked pick can optionally
  REPLACE the existing pool recipe's ingredients with the sheet's rows. The
  emitted recipe is `{name: linked, updateExisting: true, userNamed: true}`
  (NOT referenceOnly — it applies locally like a normal recipe under the
  linked name), and commit replaces pool components via the pure
  `updateRecipePoolComponents` helper (ci-name match, never wipes on empty
  rows, skips no-ops). Offered only when the parse read rows and the pick
  isn't a Mix (mix amounts are manager-entered). The checkbox resets whenever
  the link or kind changes — consent to overwrite one recipe must never carry
  to another. `pruneSpecImportAgainstSnapshot` must never demote an
  updateExisting recipe to referenceOnly (the pool copy may have drifted from
  an unchanged sheet).
- External key = the PRISTINE review-time parsed name (post
  canonicalizeSpecImportCheeseRecipeNames), so the key is stable across
  re-imports of the same sheet.

## appType aliases must NEVER rename blend-named applicator types at prepare

Because appType doubles as the blend-name namespace, the prepare-time
canonicalizer must SKIP applicator slots whose type loose-matches a cheese/mix
recipe parsed from the same sheet — the alias surfaces only as the advisory
dialog pre-select. Conversely, when the user DOES pick "Use existing", the
dialog's edited output must re-point matching applicator types to the linked
name.

**Why:** apply-time slot resolvers re-type applicators to the generic
"cheese"/"Mix" card by loose-matching the applicator type against the import's
recipe names. Any one-sided rename (alias renames the type while the user
creates new, or the link renames the recipe while the type keeps the sheet
name) breaks that match, and the blend leaks into the raw applicator Type
dropdown — the exact bug the user hit.

**How to apply:** keep the two sides in lockstep: prepare-time skip
(blend-named types stay verbatim) + dialog-confirm re-point (linked cheese/mix
picks rename matching applicator types, keyed by pristine AND current names via
the shared loose key). Both sides are regression-tested — extend those tests
when touching either side.
