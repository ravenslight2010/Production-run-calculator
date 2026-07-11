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
- Suggestion is advisory + guarded: only pre-select when the remembered target
  still exists in that kind's saved pool (stale-target guard, same rule as the
  brand/flavor apply guard above).
- Dough/sauce "use existing" picks are intentionally NOT learned — there is no
  recipe-name alias kind for them; overloading appType would pollute the blend
  namespace.
- External key = the PRISTINE review-time parsed name (post
  canonicalizeSpecImportCheeseRecipeNames), so the key is stable across
  re-imports of the same sheet.
