---
name: Brand rename alias learning
description: Customer (brand) renames in cheese/mix managers learn context-free spec-import brand aliases; premix redirect needs a brand-drift fallback.
---

# Brand rename alias learning

Renaming a customer (brand) group in CheeseRecipesManager/MixesManager — and confirmed per-row brand edits — must learn a context-free `kind:"brand"` spec-import alias (old→new) with chain re-point, so re-importing an old workbook lands on the renamed group instead of resurrecting the old brand.

**Why:** brand groups are just a `brand` column on pool rows; without a learned alias, a cheese/premix re-import recreates the old-brand group next to the renamed one.

**How to apply:**
- Helpers live with the other alias builders (`buildBrandRenameAliases`, `maybeLearnBrandRename`, `maybeLearnRowBrandChange`) in the web app's spec-import alias module; chain re-point + self-alias drop are handled there.
- `canonicalize` applies aliases BEFORE exact known-name match, so the old brand still being in known lists is fine.
- Premix gotcha: pool rows keep old-brand-derived ids after a rename while re-import candidates get new-brand ids, so `suggestPremixRedirects` (lib/premix-import) has a conservative brand-drift fallback — fires only when no alias matched, candidate is branded, exact same name+brand (ci), unique match (flavor tie-break), never cross-brand. Don't re-add the "no appType aliases → early return" shortcut; it starves this fallback.
- Real-workbook regressions: brandRenameReimportRealWorkbooks.test.ts (mirrors the mergeReimport harness).
- Prod audited 2026-07-19: no resurrected brand groups existed; no heal shipped.
