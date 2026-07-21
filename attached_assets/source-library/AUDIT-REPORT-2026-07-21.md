# Audit Report — Brand-Fan Dough Cross-Contamination (2026-07-21)

Scope: production data poisoned by the now-fixed "brand-fan linked-name
narrowing" importer bug. Re-importing a brand-anchored dough mixing procedure
whose qualifier tokens matched no flavor of that brand fanned the dough's
name, recipe rows and doughball numbers onto EVERY profile of the brand.
Poison window: Jul 19–21, 2026 (dough procedure re-imports reusing saved
parses). Ground truth: the Jul 19 saved spec-sheet parses (per-flavor
dough/sauce links, saved_spec_sheets ids 179–197), the dough procedures'
doughball variant charts, and the pre-poison dev snapshot.

## 1. Poisoned brand profiles (live scope) — HEALED

Heal: `brand-fan-dough-depoison-v1` in `artifacts/api-server/src/lib/dataHeals.ts`
(pure logic + expected-value table in `brandFanHeal.ts`). Every write is
guarded on the CURRENT value matching a known poison, so anything a manager
already corrected is untouched. Healed fields: `doughRecipeName`,
`doughRecipe` rows (re-hydrated from the live dough pool when the name was
wrong), `targetDoughballWeight`, `doughBatchYield` (cleared to re-derive).

| Profile | Poisoned (found) | Corrected to |
|---|---|---|
| Hannaford — BBQ Chicken | Malted Barley 13.8 | CRB Dough 7.6 |
| Hannaford — Chicken Bacon Club | CRB 5.7 | CRB Dough 13 |
| Hannaford — Chicken Tikka Masala | Malted Barley 13.8 | Naan Dough (unset wt) |
| Hannaford — Five Cheese | Malted Barley 13.8 | CRB Dough 7.6 |
| Hannaford — Four Cheese w/ Sweet & Spicy Chili | Malted Barley 13.8 | CRB Dough 13 |
| Hannaford — Spinach Goat Cheese | Malted Barley 13.8 | CRB Dough 13 |
| Hannaford — 4 Meat | Malted Barley 7.8 | Malted Barley 13.8 |
| Lowe's — BBQ Chicken | CRB 5.7 | CRB Dough 7.6 |
| Lowe's — Five Cheese | CRB 5.7 | CRB Dough 7.6 |
| Lowe's — Grilled Vegetable | CRB 5.7 | CRB Dough 7.6 |
| Lowe's — Californian | Margherita 11 | CRB Dough 7.6 |
| Lowe's — Caribbean | French Fry 15 | CRB Dough 13 |
| Lowe's — Spinach & Mushroom | French Fry 15 | CRB Dough 13 |
| Lowe's — Pepperoni | French Fry 15 | CRB Dough 7.6 |
| Lowe's — White Spinach | French Fry 15 | CRB Dough 7.6 |
| Lowe's — Chicken Bacon Ranch | French Fry 15 | Malted Barley 7.8 |
| Lowe's — Red Hot Chicken | French Fry 15 | Malted Barley 7.8 |
| Lowe's — Supreme | Pedone Crust 7"x12" Oval | Malted Barley 7.8 |
| Lucia's Craft — Backyard BBQ Chicken | Malted Barley 13.8 | CRB Dough 13.8 |
| Lucia's Craft — Four Cheese Meltdown | Malted Barley 13.8 | CRB Dough 13.8 |
| Lucia's Craft — House DLUX | Malted Barley 13.8 | CRB Dough 13.8 |
| Lucia's Craft — Sweet Chili Garden | Malted Barley 13.8 | CRB Dough 13.8 |
| Lucia's Craft — Bacon Burger Supreme | Malted Barley 13.8 | Lucia's French Fry 14 |
| Lucia's Craft — Blazin' Pepperoni & Jalapeno | Malted Barley 13.8 | Sriracha Dough 12 |
| Nob Hill Craft — Bacon Cheeseburger | Malted Barley 13.8 | Lucia's French Fry 14 |
| Nob Hill Craft — Caribbean | Malted Barley 13.8 | CRB Dough 13 |
| Nob Hill Craft — South of the Border | Malted Barley 13.8 | Masa Dough 12 |

Weight sources: CRB thin 7.6 / heavy 13 corroborated by the pre-poison dev
snapshot; Lucia's Craft CRB 13.8 from the "Lucia's & Hannaford Craft CRB
Thick" chart label; Hannaford 4 Meat 13.8 from the Malted Barley "Thick
(Argus)" label (Hannaford appears only there).

## 2. Poisoned scheduled day-state runs — HEALED

Runs on 2026-07-23 (Lowe's), 07-24 (Lucia's Craft), 07-27 (Hannaford) carry
CORRECT dough names but the family pool's ROOT weight (CRB 5.7 = Lowe's
7-inch; Malted Barley 7.8 = Lowe's Thin) instead of the brand's variant
weight. Same heal fixes them (matched by brand+flavor via `dayState.runs`,
monotonic `valuesUpdatedAtMs` bump so the fix wins the sync merge). Lowe's
7-inch runs (5.7 correct) and already-correct runs (e.g. Naan 0, Sriracha 12,
Lucia's FF 14) are untouched.

## 3. Sauce fan — CLEAN

Per-flavor sauces vary correctly within each brand; only pre-existing naming
drift found (e.g. "Buffalo Ranch Sauce" vs pool "Legacy Buffalo Ranch" on
Lowe's Buffalo Chicken — predates this bug, left alone).

## 4. Auto-Fill From Imports — VERIFIED

`profileAutofill.ts` mirrors the fixed `recipeApplyTargets` narrowing: the
profile being filled is placed in the pool with its effective linked
dough/sauce names, so a brand-anchored dough can no longer fan onto a profile
linked to a different recipe. Regression tests pass:
`lib/spec-import/src/recipeApplyTargetsLinkedNameNarrowing.test.ts` (5) and
`artifacts/run-calculator/src/profileAutofill.test.ts` (52, incl. the Lowe's
BBQ Chicken French Fry fan case).

## 5. Known residual issues (NOT healed — follow-ups)

- **Lowe's Supreme die type unrecoverable.** The purchased-crust die heal saw
  the fanned "Pedone Crust" name and legitimately cleared the profile's die;
  the original die value is gone. A manager must re-pick it.
- **Dough pool brand tags are junk.** The shared CRB family row is branded
  "Lowe's 7in" (root 5.7), Malted Barley is "Lowe's Thin Barley (11 Inch)",
  Margherita is "Hannaford" — shared families should not carry one customer's
  brand. Harmless with the narrowing fix but feeds future brand-anchored
  logic; worth a separate cleanup.
- **Brand MR07CH24 / MR12CH14 doughball weight 5** matches the "Corky's 7"
  root, suspicious but no pre-poison evidence — needs manager confirmation
  (likely 6.2 / 14.2 per the Marriott chart labels).
- **Lucia's Craft CRB 13.8 vs 12**: the chart also lists a "Heavy Plus 12"
  label including Lucia's Craft; 13.8 (Craft Thick) chosen — manager should
  confirm.

Heal ships live on the first production boot after publishing.
