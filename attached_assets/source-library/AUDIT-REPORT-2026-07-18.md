# Source Workbooks vs Live App — Full Audit (July 18, 2026)

This report compares every uploaded source workbook (now stored in `attached_assets/source-library/`) against the LIVE production app data. Nothing was changed in the app — this is read-only. Each finding says what the sheet says, what the app says, and what to do.

**Legend:** ✅ = matches | ⚠️ = needs attention | ℹ️ = by design, no action

## Evidence retention

This historical report is retained for reference, but its original July
production input was a temporary `/tmp` export and cannot be backfilled.
The first reproducible follow-up capture is retained here:
[`audits/production-snapshot-2026-08-26.json`](audits/production-snapshot-2026-08-26.json).
Future audits must follow the bounded capture procedure in
[`docs/repository-cleanup-2026-08-25.md`](../../docs/repository-cleanup-2026-08-25.md)
and retain the generated dated snapshot beside the source-library report.

---

## 1. Cheese Mix Recipes — BIGGEST PROBLEM AREA ⚠️

### ⚠️ 16 cheese blends exist in the app but with ALL-ZERO pounds
The app has these blends, but every component shows 0 lbs while the cheese workbook has real amounts. These were created as empty placeholders by a spec import and never filled in:

Lucia's Americano, Cheeseburger, Red Hot, Lowe's Pepperoni, Lowe's Grilled Vegetable, Lowe's California, Lowe's Pepperoni/Romano, Lowe's Spinach Mushroom, Lowe's Club, Lucia's Standard, Lucia's Pepperoni, Lucia's Club, Lucia's Mexicano, Mauro Tomato Basil, SMD Four Cheese, SMD BBQ Chicken (all "... Cheese Mix").

**What to do:** Re-import the cheese workbook and link each of these to its existing app row (a one-time data heal can also copy the sheet lbs in — proposed as a follow-up).

### ⚠️ 2 blends from the cheese workbook are missing from the app
- **SMD Pepperoni Cheese Mix** — not in the app at all.
- **SMD Supreme Cheese Mix** — the sheet says it's "same as Lowe's Grilled Veggie Cheese Mix"; the app has an "SMD Supreme Cheese Mix" row but it's one of the empty stubs above.

**What to do:** Re-import the SMD tab of the cheese workbook, or add these two blends by hand under Manage Lists → Cheese Recipes.

### ⚠️ ~31 extra cheese rows in the app that are NOT in the cheese workbook
Most are all-zero stubs minted by spec imports (e.g. "Craft Cheese Mix", "Corner Booth Cheese Pizza Blend", "Margherita Cheese Mix"). Two special cases:
- **Italian Beef & Gravy (Mauro MUR9488)** — this is a MEAT mix that got misfiled under Cheese (already a known import error).
- **Aldo's Cheese Mix** and **SMD Pep Cheese Mix** — these have real pounds (they came from spec sheets, which is fine), so keep them.

**What to do:** Review the extra list and delete the empty stubs you don't want; move/delete Italian Beef & Gravy.

### ⚠️ 4 blends cover fewer flavors in the app than the sheet says
- Whole Mozzarella Cheese Mix — sheet also assigns: Hawaiian, Tikka Masala
- Lowes/Hannaford Five Cheese Mix — sheet also assigns: Roasted Veggie
- Skim Mozzarella Cheese Mix — sheet also assigns: Meat Lovers, Supreme
- Lucia's Cheeseburger Cheese Mix — sheet also assigns: Bacon Cheeseburger

**What to do:** Add the missing flavors to each blend's flavor list (or leave the flavor list empty to mean "all varieties").

---

## 2. Pre-Mixes ⚠️

### ⚠️ One real ingredient error
- **Lowe's California Mix:** the app says **Green Pepper Strips 1.25 oz** — the premix sheet says **FR RED Pepper Strips 1.25 oz**. Red vs green peppers on a live product.

**What to do:** Edit the mix and rename the component (a follow-up can fix it in prod).

### ℹ️ 13 other mixes differ only cosmetically
Dropped "1/8 pepper/onion" rows that have 0 oz per pizza (the app only stores per-pizza amounts), plus small spelling drift ("Red Peppers" vs "Red Pepper Strips"). No amounts are wrong.

### ⚠️ 22 empty stub mixes duplicate real ones
Spec imports minted zero-amount mixes under slightly different names next to the real premix rows (e.g. "4hands Red Hot Chicken Mix" vs the real "Red Hot Chicken Mix", "Bobo Breakfast Mix" vs "Bobo's Breakfast Mix", generic "California Mix", "Red Fajita Mix", etc.).

**What to do:** Merge or delete the stubs so pickers only show one row per mix.

---

## 3. Dough Recipes — mostly ✅

All 13 dough workbooks match the app's ingredient amounts. Notes:

- ℹ️ Ingredient names were tidied on import ("yeast" → "Fresh Compressed Yeast", "sea salt" → "Salt") — same ingredients, no action.
- ℹ️ **Malted Barley Dough** — app stores the 4-bag batch column (200 lbs flour); sheet's first column is the 2-bag batch (100 lbs). Same proportions, just a bigger batch. Fine.
- ✅ **Lowe's Heavy French Fry Dough** — app correctly includes "25029 French Fries: 18 lbs" (the sheet lists it as "(4 bags)" and the 18 lbs comes from the procedure steps). Good catch by the import.
- ⚠️ **Naan Dough has no doughball weights** — sheet lists Lucia's Craft & 4Hands Naan at 12 oz/16 per tray and Hannaford at 11.5 oz/16 per tray; the app has zero weight and no variants. **What to do:** add the two variants.
- ⚠️ **Microwavable Lucia's Dough** — sheet lists a second variant (7" FSD, 5.5 oz/24 per tray) that isn't on this recipe in the app. Same 5.5 oz weight, so numbers work, but the label is missing.
- ⚠️ **Masa Dough** carries an extra variant "Masa Dough Natural" even though Masa Dough - Natural is its own recipe. Remove the duplicate variant.
- ⚠️ **4 empty dough rows** in the app that match no workbook: BONiCi 9", Bonici 12", "Lowe's French Fry recipe" (duplicate of LOWE'S HEAVY FRENCH FRY DOUGH), Pinsa 12" Crust - Pedone. **What to do:** delete or fill them.

---

## 4. Sauce Recipes — mostly ✅

All sauce quantities match the sheets (including Aldo, Alfredo, Asiago, Bobo's, Brand Marriott, Four Hands Red Hot — the app even preserved the sheet's own typos like "Galrlic Sauce", which you may want to tidy).

- ⚠️ **Tika Masala Sauce — two ingredient-name errors:**
  - Sheet **"Garlic Puree" 3.65 lbs** → app calls it **"Garlic Powder" 3.65** (puree and powder are different things).
  - Sheet **"Chili Powder" 1 lb** → app calls it **"Garlic Powder" 1** (so the app shows two Garlic Powder rows and no Chili Powder). All amounts are right; only the names are wrong.
- ℹ️ 17 sauces with no ingredient rows are mostly "bought as-is" by design (BBQ, Ranch, Olive Oil, Salsa, Basil Pesto, Legacy Buffalo Ranch, Garlic Sauce (Oasis), etc.). A few look like stub duplicates worth cleaning: **"Brand Marriott Recipe"** (dup of Brand Concessions Marriott Sauce Drum), **"Asiago Sauce (UFI)"** (dup of Asiago Sauce Mix), **"Gravy (UFI)"** (dup of Gravy Sauce Mix), **"Sweet n Sour Sauce"** (dup of Sweet and Sour Sauce Mix).

---

## 5. Pizza Spec Sheets vs Profiles — nearly perfect ✅

All 129 brand/flavor profiles in the app are covered by the 19 spec sheets, and dies, dough links, sauce links, sauce oz, applicator oz, and pepperoni sticks/oz all match — with one exception:

- ⚠️ **Aldo's SAUSAGE is an empty profile.** The spec sheet has full data for it, but the sheet typo `Aldo"s` (a straight quote instead of an apostrophe) meant the recipe data never landed — the profile exists with only packaging fields. **What to do:** re-import the Aldo's spec (the quote-typo fix now in the importer should catch it) or fill the profile by hand from the sheet: 12" dies, Aldo's Dough, Aldo Pizza Sauce 4 oz, Sausage 2.25 oz, cheese mix 2.75 + 2.75 oz, bacon 1.2 oz, pepperoni stick 13 = 1.1 oz.
- ✅ Brand MR07CH24 links its sauce to "Brand Concessions Marriott Sauce Drum" while the sheet writes "Brand Marriott Recipe" — the app's link is the better (real) recipe.

---

## 6. Shipping & Palletizing Guide vs Packaging — mostly ✅

Shipper size, circles, pizzas/case, cases/skid, and stacking all match for every brand that exists in the app. Gaps:

- ⚠️ **Grip sheets are never recorded.** The guide marks "X" (uses grip sheets) for ~10 brands (Basha's Ultra Thin, Hannaford, Lowe's, Corner Booth, Price Chopper, Show Me Dough, Nob Hill, Lucia's Pinsa, Brand, FSD…), but every app profile says "none" — the shipping importer only understood "N/A". **What to do:** importer follow-up + set the flag on those brands.
- ⚠️ **Costco pizzas per case is 0 in the app.** The guide says "4 - 3PACK" (12 pizzas in 4 three-packs); the importer skips non-numeric values. Set it manually to 12 (or whatever you count as a "case").
- ⚠️ **PriceSmart Member's Selection** is in the guide but has no brand in the app at all (no spec sheet either). Add it if it's a live product.
- ⚠️ **Mauro's Pinsa** profiles have blank packaging (no shipper/cases), and it isn't in the shipping guide. Fill in when known.
- ℹ️ Lucia's "w Cartons" and "w Labels" rows map to Lucia's Craft (11", 54/skid) and Lucia's New & Improved (12", 60/skid) respectively — both match. All profiles currently show "cartoned"; if the "w Labels" group should show as labeled instead, that's a one-click change per profile.

---

## 7. Schedule file

`Production_Schedule_7-8-26.xlsx` is filed in the corpus (schedule/). Day-schedules are transient, so it wasn't audited against live data.

---

## Bottom line

| Area | Status |
|---|---|
| Spec sheets → profiles | ✅ 128/129 perfect; 1 empty (Aldo's Sausage) |
| Dough | ✅ amounts all match; a few missing variants + 4 empty rows |
| Sauce | ✅ amounts all match; 2 wrong ingredient names in Tika Masala |
| Shipping/packaging | ✅ matches; grip sheets + Costco count gaps |
| Pre-mixes | ⚠️ 1 wrong ingredient (Lowe's California), 22 stubs to clean |
| Cheese | ⚠️ 16 all-zero blends, 2 missing, ~31 stubs to clean |
