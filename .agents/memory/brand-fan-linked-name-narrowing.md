---
name: Brand-fan linked-name narrowing
description: Qualified dough/sauce recipe names must not blanket a whole brand onto profiles linked to a different recipe
---

**Rule:** When a brand-anchored dough/sauce recipe's name carries qualifier tokens that match NO flavor of the brand, the whole-brand fan fallback must be narrowed to profiles whose linked dough/sauce name is blank or names the same recipe line (near-dup equal OR loose-key token subset — subset covers family variants like "HEAVY French Fry" vs "French Fry"). Profiles linked to a DIFFERENT recipe are excluded.

**Why:** Production incident — importing "Lowe's French Fry Dough Mixing Procedure" fanned the French Fry dough (15 oz / 15-per-tray) onto every Lowe's flavor, including BBQ Chicken which runs CRB Dough, both in autofill suggestions and the real import apply. The old fallback assumed unmatched qualifier tokens were "just brand-line words."

**How to apply:** The narrowing only works if the profile pool carries linked names — any caller of the apply-target fan must map saved profiles' dough/frontline recipe names into the pool's `doughName`/`sauceName` (import apply pool AND the autofill planner's synthetic current-profile entry). A pool without linked names silently degrades to the old whole-brand fan.

Related: autofill name mismatches now ignore the profile's OWN brand prefix on linked recipe names ("Lowe's BBQ Chicken Cheese Mix" == "BBQ Chicken Cheese Mix" on a Lowe's profile) — cheese/premix imports de-collide duplicate names with a brand prefix, so flagging it just nags. Strip BOTH brand-key spellings (match key folds the possessive, name key keeps the "s").
