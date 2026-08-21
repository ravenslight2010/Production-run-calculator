---
name: Spec-import stub pollution
description: Recipe references need positive component data before they create cheese, mix, dough, or sauce pool rows; includes historical-stub audit context.
---

Recipe names in a spec sheet are profile links, not evidence of a master-data formula. A cheese, mix, dough, or sauce pool row may be created or replaced only when the parsed recipe has a named component with a positive amount. Profile-only references remain intact; managers can import the corresponding workbook or create the recipe explicitly.

**Why:** The July 2026 full-corpus audit found 16 cheese blends, 22 mixes, four dough recipes, and several sauces live in production as empty stubs, created when a spec referenced a name whose later workbook never linked.

**How to apply:**
- Apply the positive-data guard to every spec-import pool-writing path, including post-import client promotion, rather than relying on a later cleanup.
- Bump the saved-parse version whenever this deterministic import behavior changes.
- Audits: compare workbooks in `attached_assets/source-library/` vs prod pools read-only (`executeSql environment:"production"`, `select json_agg(row_to_json(t)) ...` to survive CSV quoting). Treat "same name, all-zero lbs" as "stub never filled", not "recipe is zero".
- Name drift between spec and workbook ("4hands Red Hot Chicken Mix" vs "Red Hot Chicken Mix") is the main stub cause — the near-dup matcher only runs at import link passes.
