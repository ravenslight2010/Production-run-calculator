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
