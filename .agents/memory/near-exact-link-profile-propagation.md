---
name: Near-exact link profile propagation
description: Why profile doughName/sauceName can stay stale after a near-exact auto-rename in linkSpecImportNamedRecipesToExisting, and how to fix it.
---

## The rule

When `linkSpecImportNamedRecipesToExisting` auto-renames a recipe via near-exact match (`autoApplyNearExact: true`), it must also propagate that rename to any profile whose `sauceName`/`doughName` matched the old recipe name. Without this, profiles silently retain the typo name after a commit-time auto-link.

**Why:** The profile field update pass (lines ~1559-1575 in `lib/spec-import/src/index.ts`) calls `matchProfileName()` → `matchCleaned()`, which only returns layer-1 (exact loose-key) hits. Near-exact auto-renames are layer-2/3 and are not caught by `matchCleaned`. So `sauceName: "Mystic Pizza Sause"` was never updated to `"Mystic Pizza Sauce"` even when the recipe was auto-renamed.

**How to apply:** Track each near-exact auto-applied rename in a `nearExactApplied` Map (`loose-key(old) → new name`) as recipes are processed. In `matchProfileName`, check `nearExactApplied` after `matchCleaned` and before the family fallback. This is already in place as of the fix (2026-07-25); don't remove the map or bypass the check when modifying the link pass.

Note: `collapsedRenames` (sibling-collapse dough renames) already uses this same pattern and was the model for the fix.
