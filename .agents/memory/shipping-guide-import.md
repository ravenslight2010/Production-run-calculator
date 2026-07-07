---
name: Shipping & Palletizing Guide importer
description: Deterministic Excel importer that fills per-brand packaging settings; mapping/skip rules and profile-patch safety.
---

# Shipping & Palletizing Guide importer (web-only)

The guide workbook is ONE sheet, one row per brand, with a header row
(PIZZA/BOX/CIRCLE/PIZZAS-CS/CASES/GRIPSHEETS/STACKING…). Parsing is fully
deterministic (no AI) in `@workspace/shipping-import`.

**Rules that must hold:**
- **Never guess.** A value that doesn't map confidently to one of the app's
  existing packaging options is OMITTED from the patch and surfaced as
  "kept as-is" in the review dialog (e.g. gripsheets "X"/"x+cardboard",
  multipack counts like "4 - 3PACK"). Only whole-number counts map.
- **Header tolerance:** header cells are matched letters-only, which absorbs
  the workbook's real "GRIPSHEEETS" typo. N/A detection must not letters-strip
  numeric cells (`12''` is a value, not N/A).
- **Brand match:** exact-ci → loose key → near-dup matcher; anything ambiguous
  or extra-word ("Lucia's w Cartons") returns null and the manager picks the
  brand in the dialog. That's intentional — most guide rows are customer/SKU
  names, not app brands.

**Why the profile write bypasses saveProfile:** the patch is a targeted merge
of only the provided packaging keys into the raw profile blob (brand-level ""
+ every flavor), so it can't zero recipe data; saveProfile's has-real-data
guard would wrongly block patching sparse profiles.

**How to apply:** if the guide format changes, adjust mappers in
`lib/shipping-import` and keep the omit-don't-guess contract; commit writes are
localStorage-only and ride the existing full-profile sync scan.
