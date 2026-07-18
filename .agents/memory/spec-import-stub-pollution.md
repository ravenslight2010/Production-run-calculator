---
name: Spec-import stub pollution
description: Spec imports mint all-zero placeholder recipes across cheese/mix/dough/sauce pools; full-corpus audit findings and method.
---

Spec-sheet imports create placeholder rows (all-zero lbs, no components) in EVERY server pool for any recipe name they reference (cheese blends, mixes, dough, sauce). If the matching cheese/premix/dough workbook is never imported (or the name drifts), the stub stays empty in production forever and clutters pickers next to the real row.

**Why:** The July 2026 full-corpus audit found 16 cheese blends + 22 mixes + 4 dough + several sauces live in prod as empty stubs, plus one empty profile (brand quote-typo) — all from spec imports that referenced names the later workbook imports didn't link to.

**How to apply:**
- After any spec import, check the pools for new zero-lbs rows and either link them to real recipes or delete them.
- Audits: compare workbooks in `attached_assets/source-library/` vs prod pools read-only (`executeSql environment:"production"`, `select json_agg(row_to_json(t)) ...` to survive CSV quoting). Treat "same name, all-zero lbs" as "stub never filled", not "recipe is zero".
- Name drift between spec and workbook ("4hands Red Hot Chicken Mix" vs "Red Hot Chicken Mix") is the main stub cause — the near-dup matcher only runs at import link passes.
