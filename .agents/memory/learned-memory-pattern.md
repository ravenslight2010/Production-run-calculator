---
name: Learned-memory pattern (server-persisted AI aliases)
description: How "remember what the user confirmed" is applied to AI features (Excel import aliases, Fill-Missing values, Photo aliases) at web+mobile parity.
---

# Learned-memory pattern

Several AI features "learn" from user-confirmed corrections by persisting a
factory-wide alias/value table server-side and proposing it on the next run.
Excel import aliases were first; the same shape was applied to:

- **Fill Missing Data**: remembers confirmed values keyed by `(brand, flavor, fieldKey)`.
  Surfaces as a new TOP-priority proposal source `"learned"` ahead of
  profile → spec → default → none.
- **Photo inventory identifier**: remembers `guessName -> itemKey`; auto-applies
  on the next scan only when the AI gave no match AND the item still exists.

## Rules / invariants

- **Endpoints are `requireAuth`-only, NOT manager-gated.** Operators benefit and
  do the confirming, matching the import-alias precedent. Do not add a role gate.
- **App-level case-insensitive upsert** (no DB unique index), same as import
  aliases. Identity is `lower()`-compared in the route. Architect flagged the
  rare concurrent-duplicate race as optional hardening; precedent accepts it.
- **Pure matchers live in shared/glue, are unit-tested**: `pickLearnedForProduct`
  (in `@workspace/fill-missing`) and `applyPhotoAliases` (in each app's
  inventoryShared). `applyPhotoAliases` MUST keep the stale-item guard — a
  remembered itemKey that no longer exists among candidates returns null.
- **Save is best-effort**: fetch on mount + save on confirm both swallow errors
  so a sync/network failure never blocks the user's confirm action.
- **Save only non-trivial links**: photo alias is saved only when matched to an
  existing item AND guessName != item name (skip self-references, like imports).
  Fill-missing value saved only when brand+flavor are both non-blank.

**Why:** keeps the AI improving over time without manager friction, and without
letting a stale/garbage alias silently corrupt a future scan.

**How to apply:** any new "remember the user's correction" AI feature should
copy this shape (requireAuth endpoint, app-level ci-upsert, pure tested matcher
with existence guard, best-effort glue) and be mirrored web+mobile.
