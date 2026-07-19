---
name: Brand-scoped cheese/mix import names
description: Same-named cheese recipes/mixes from different customers never link on import; colliding new names get an idempotent brand prefix.
---

# Brand-scoped cheese/mix names on import

Rule: import link/dedup passes for cheese recipes and mixes match **same-brand first, then unbranded pool rows — never another brand's row**. When a new name collides with a DIFFERENT brand's saved recipe, it is created under an idempotent brand-prefixed name ("Lucia's Taco Mix") instead of linking.

**Why:** different customers reuse generic names ("Taco Mix"); name-keyed linking silently overwrote one customer's recipe with another's on import. Unbranded rows are shared master data and must remain reachable from branded imports.

**How to apply:**
- Any new importer link pass over these pools must keep the same-brand → unbranded fallback order and the never-cross-brand invariant.
- "Use existing" redirect memory is brand-scoped with a context-free fallback; confirmed picks record both so other customers still benefit.
- Pickers disambiguate with brand tags only where names collide.
- Existing data was deliberately NOT renamed; dough/sauce pools are NOT brand-scoped yet — the same collision risk exists there.
- Re-imports must stay idempotent: the prefix helper never double-prefixes.
