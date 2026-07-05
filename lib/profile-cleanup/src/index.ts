/**
 * @workspace/profile-cleanup
 *
 * One-time, deterministic data-hygiene for brand/flavor recipe profiles, shared
 * verbatim by the web and mobile apps so both converge on the SAME result
 * (web+mobile parity is mandatory for this project).
 *
 * Two problems this fixes, both discovered by comparing every brand/flavor setup
 * to its source spec sheet:
 *
 *  1. ~38 DUPLICATE BLANKS — a product got saved under two brand spellings (e.g.
 *     `11" lowe's` vs `lowe's`, `hannaford crb` vs `hannaford`, or two flavor
 *     spellings like `chx club` vs `club`). One copy carries the real recipe, the
 *     other is an empty shell. `PROFILE_DELETE_PAIRS` names each `[emptyKey,
 *     twinKey]`: delete the empty one, keep the populated twin.
 *
 *  2. ~9 MISSING RECIPES — profiles that exist but were never filled in from their
 *     spec sheet. `PROFILE_REBUILD_OVERLAYS` (+ `PROFILE_REBUILD_DOUGHBALL_OZ`)
 *     carries the recipe fields to overlay, rebuilt from the FSD / Hannaford /
 *     Lowe's spec workbooks. Each overlay's oz-sum matches its sheet target
 *     weight; the existing dough is preserved (overlay merge).
 *
 * Profiles keyed `${brandLc}__${flavorLc}`. The apps supply platform IO
 * (localStorage on web, an AsyncStorage state blob on mobile); this module owns
 * only the DATA and the pure guard logic, so the two platforms cannot drift.
 *
 * No-source blanks (e.g. Lowe's "red pepper hommus", "chx club" — no matching
 * spec sheet) are intentionally left alone: they are neither in the delete pairs
 * nor the rebuild set, and the brand-removal guard keeps any brand that still
 * holds such a flavor.
 */

/** Bump if this cleanup ever needs to re-run after a correction. */
export const PROFILE_CLEANUP_MARKER = "run-calc-profile-cleanup-v1";

/**
 * `[emptyKey, twinKey]` pairs. `emptyKey` is a blank duplicate to delete; it is
 * only deleted when it truly carries no recipe data AND `twinKey` (the copy to
 * keep) is populated — see `planProfileCleanup`.
 */
export const PROFILE_DELETE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["lowe's__buffalo", "lowe's__buffalo chicken"],
  ["4hands__chx club", "11\" four hands__chicken bacon club"],
  ["4hands__mega meat", "11\" four hands__mega meat"],
  ["bobo's 12\"__deluxe", "bobo's__deluxe"],
  ["bobo's 12\"__alfredo", "bobo's__alfredo"],
  ["4hands__masala pizza", "11\" four hands__chicken tikka masala"],
  ["bobo's 12\"__breakfast", "bobo's__breakfast"],
  ["11\" lowe's__margherita", "lowe's__margherita"],
  ["4hands__vienna red hot", "11\" four hands__old vienna red hot chicken"],
  ["11\" lowe's__bbq chicken", "lowe's__bbq chicken"],
  ["11\" lowe's__californian", "lowe's__californian"],
  ["11\" lowe's__five cheese", "lowe's__five cheese"],
  ["lowe's crb__bbq chicken", "lowe's__bbq chicken"],
  ["lowe's crb__californian", "lowe's__californian"],
  ["lowe's crb__five cheese", "lowe's__five cheese"],
  ["lucia's craft__chx club", "lucia's craft__club"],
  ["lucia's craft__bratwurst", "lucia's craft__brat"],
  ["11\" lowe's__white spinach", "lowe's__white spinach"],
  ["4hands__sugarfire bbq chx", "11\" four hands__sugarfire bbq chicken"],
  ["lowe's crb__white spinach", "lowe's__white spinach"],
  ["hannaford crb__bbq chicken", "hannaford__bbq chicken"],
  ["hannaford crb__five cheese", "hannaford__five cheese"],
  ["11\" lowe's__grilled vegetable", "lowe's__grilled vegetable"],
  ["lowe's crb__grilled vegetable", "lowe's__grilled vegetable"],
  ["lucia's craft__vienna red hot", "lucia's craft__red hot chicken"],
  ["11\" lowe's__bacon cheeseburger", "lowe's__bacon cheeseburger"],
  ["11\" lowe's__spinach & mushroom", "lowe's__spinach & mushroom"],
  ["11\" lowe's__ultimate pepperoni", "lowe's__ultimate pepperoni"],
  ["11\" lowe's__chicken bacon ranch", "lowe's__chicken bacon ranch"],
  ["4hand's crb heavy__seven cheese", "11\" four hands__seven cheese"],
  ["lowe's crb heavy plus__caribbean", "lowe's__caribbean"],
  ["7\" lucia's morning melts__italiano", "lucia's morning melts__italiano"],
  ["7\" lucia's morning melts__mexicano", "lucia's morning melts__mexicano"],
  ["7\" lucia's morning melts__parisian", "lucia's morning melts__parisian"],
  ["7\" lucia's morning melts__americano", "lucia's morning melts__americano"],
  ["lowe's crb heavier__spinach mushroom", "lowe's__spinach & mushroom"],
  ["lucia's craft crb heavy plus__caribbean", "lucia's craft__caribbean"],
  ["lucia's craft crb thick__chicken spinach alfredo", "lucia's craft__alfredo chicken & spinach"],
];

/**
 * Recipe fields to overlay onto each missing profile, keyed by profile key. Only
 * fields whose names are IDENTICAL on web and mobile appear here; the doughball
 * target weight (web `targetDoughballWeight` vs mobile `doughballWeightOz`) is
 * carried separately in `PROFILE_REBUILD_DOUGHBALL_OZ` and mapped by each app.
 */
export const PROFILE_REBUILD_OVERLAYS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  "fsd 7'' crb__cheese": { dieType: "7\"", frontlineRecipeName: "Mystic Pizza Sauce", sauceOzPerPizza: 1.5, app1Type: "cheese", app1CheeseRecipeName: "Whole Mozzarella Cheese Mix", app1OzPerPizza: 1.5 },
  "fsd 7'' crb__pepperoni": { dieType: "7\"", frontlineRecipeName: "Mystic Pizza Sauce", sauceOzPerPizza: 1.5, app1Type: "Diced Pepperoni", app1OzPerPizza: 0.5, app2Type: "cheese", app2CheeseRecipeName: "Whole Mozzarella Cheese Mix", app2OzPerPizza: 1 },
  "fsd 7'' crb__m/l": { dieType: "7\"", frontlineRecipeName: "Mystic Pizza Sauce", sauceOzPerPizza: 1.5, app1Type: "Italian Sausage", app1OzPerPizza: 0.75, app2Type: "Diced Pepperoni", app2OzPerPizza: 0.2, app3Type: "Bacon", app3OzPerPizza: 0.1, app4Type: "cheese", app4CheeseRecipeName: "Whole Mozzarella Cheese Mix", app4OzPerPizza: 1 },
  "fsd 7'' crb__breakfast": { dieType: "7\"", frontlineRecipeName: "Gravy Sauce Mix", sauceOzPerPizza: 1.3, app1Type: "Scrambled Egg", app1OzPerPizza: 1, app2Type: "Spicy Breakfast Sausage", app2OzPerPizza: 0.5, app3Type: "FSD Breakfast Meat Mix", app3OzPerPizza: 0.4, app4Type: "cheese", app4CheeseRecipeName: "Lucia's Americano Cheese Mix", app4OzPerPizza: 1 },
  "hannaford__4 meat": { dieType: "Argus Dies", frontlineRecipeName: "Lucia's Sauce", sauceOzPerPizza: 4, app1Type: "Hannaford 4Meat Mix", app1OzPerPizza: 2, app2Type: "cheese", app2CheeseRecipeName: "Skim Mozzarella Cheese Mix", app2OzPerPizza: 1.25, pep1Type: "Pepperoni Stick", pep1Sticks: 9, pep1OzPerPizza: 0.8, app3Type: "Bacon", app3OzPerPizza: 0.5, app4Type: "cheese", app4CheeseRecipeName: "Skim Mozzarella Cheese Mix", app4OzPerPizza: 2 },
  "hannaford crb heavy plus__spicy 4 cheese": { dieType: "11\"", frontlineRecipeName: "Sweet Chili Sauce", sauceOzPerPizza: 4, app1Type: "cheese", app1CheeseRecipeName: "Hannaford's Spicy 4Cheese Mix", app1OzPerPizza: 2.5, app2Type: "cheese", app2CheeseRecipeName: "Hannaford's Spicy 4Cheese Mix", app2OzPerPizza: 2.75 },
  "hannaford crb heavy plus__spinach goat cheese": { dieType: "11\"", frontlineRecipeName: "Modified Medulla Sauce", sauceOzPerPizza: 2.5, app1Type: "Tomatoes", app1OzPerPizza: 1, app2Type: "cheese", app2CheeseRecipeName: "Spinach Goat Cheese Mix", app2OzPerPizza: 4.1 },
  "hannaford crb thick__chicken bacon club": { dieType: "Argus Dies", frontlineRecipeName: "Ranch Sauce", sauceOzPerPizza: 2.5, app1Type: "Diced Chicken", app1OzPerPizza: 2.5, app2Type: "Hannaford Club Mix", app2OzPerPizza: 0.85, app3Type: "cheese", app3CheeseRecipeName: "Hannaford Club Cheese Mix", app3OzPerPizza: 4 },
  "hannaford__masala pizza": { dieType: "11\"", frontlineRecipeName: "Tikka Masala Sauce", sauceOzPerPizza: 3.5, app1Type: "Masala Chicken Mix", app1OzPerPizza: 2.07, app2Type: "White Fajita Mix", app2OzPerPizza: 1.5, app3Type: "cheese", app3CheeseRecipeName: "Whole Mozzarella Cheese Mix", app3OzPerPizza: 4 },
};

/** Target doughball weight (oz) per rebuilt profile. See overlays note above. */
export const PROFILE_REBUILD_DOUGHBALL_OZ: Readonly<Record<string, number>> = {
  "fsd 7'' crb__cheese": 5.5,
  "fsd 7'' crb__pepperoni": 5.5,
  "fsd 7'' crb__m/l": 5.5,
  "fsd 7'' crb__breakfast": 5.5,
  "hannaford__4 meat": 13,
  "hannaford crb heavy plus__spicy 4 cheese": 11,
  "hannaford crb heavy plus__spinach goat cheese": 11,
  "hannaford crb thick__chicken bacon club": 13,
  "hannaford__masala pizza": 11,
};

/** Split a `${brand}__${flavor}` profile key on the FIRST `__`. */
export function splitProfileKey(key: string): { brand: string; flavor: string } | null {
  const i = key.indexOf("__");
  if (i < 0) return null;
  return { brand: key.slice(0, i), flavor: key.slice(i + 2) };
}

function nonEmptyStr(v: unknown): boolean {
  return typeof v === "string" && v.trim() !== "";
}
function positiveNum(v: unknown): boolean {
  return typeof v === "number" ? v > 0 : nonEmptyStr(v) && Number(v) > 0;
}
function nonEmptyArr(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0;
}

/**
 * True when a profile object carries real RECIPE / topping data — a die, a sauce,
 * an applicator, or pepperoni. Dough fields are deliberately IGNORED: the blank
 * duplicates and the not-yet-filled profiles still carry a default dough recipe,
 * so counting dough would hide them. This is the single definition of "has a
 * recipe" used by both the delete guard (blank has none, twin has some) and the
 * rebuild guard (fill only profiles that still have none).
 */
export function profileHasRecipeData(p: Record<string, unknown> | null | undefined): boolean {
  if (!p) return false;
  if (nonEmptyStr(p.dieType)) return true;
  if (nonEmptyStr(p.frontlineRecipeName) || positiveNum(p.sauceOzPerPizza) || nonEmptyArr(p.frontlineRecipe)) return true;
  for (const n of [1, 2, 3, 4]) {
    if (
      nonEmptyStr(p[`app${n}Type`]) ||
      positiveNum(p[`app${n}OzPerPizza`]) ||
      nonEmptyStr(p[`app${n}CheeseRecipeName`]) ||
      nonEmptyArr(p[`app${n}CheeseRecipe`])
    ) {
      return true;
    }
  }
  for (const n of [1, 2]) {
    if (
      nonEmptyStr(p[`pep${n}Type`]) ||
      positiveNum(p[`pep${n}Sticks`]) ||
      positiveNum(p[`pep${n}OzPerPizza`])
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Decide, from the CURRENT profiles, which cleanup actions are safe to take.
 * `getProfile(key)` returns the raw stored profile object (WITHOUT any default
 * overlay) or null when nothing is stored for that key.
 *
 *  - A delete pair fires only when the empty side has no recipe data AND the twin
 *    to keep does — so nothing populated is ever removed, and if the data was
 *    already cleaned this is a safe no-op.
 *  - A rebuild fires only for a profile that exists but has no recipe data — it
 *    never invents a profile on a device that doesn't run that product, and never
 *    clobbers one that already carries recipe data.
 */
export function planProfileCleanup(
  getProfile: (key: string) => Record<string, unknown> | null,
): { deleteKeys: string[]; rebuildKeys: string[] } {
  const deleteKeys: string[] = [];
  for (const [emptyKey, twinKey] of PROFILE_DELETE_PAIRS) {
    if (profileHasRecipeData(getProfile(emptyKey))) continue;
    if (!profileHasRecipeData(getProfile(twinKey))) continue;
    deleteKeys.push(emptyKey);
  }
  const rebuildKeys: string[] = [];
  for (const key of Object.keys(PROFILE_REBUILD_OVERLAYS)) {
    const p = getProfile(key);
    if (!p) continue;
    if (profileHasRecipeData(p)) continue;
    rebuildKeys.push(key);
  }
  return { deleteKeys, rebuildKeys };
}

/**
 * Given the current `brandFlavors` map (brand -> flavor names, original case) and
 * the profile keys just deleted, return the brands (original case) whose flavor
 * list becomes EMPTY — i.e. pure duplicate brand-lines safe to drop entirely.
 * A brand that still holds any flavor (including a left-alone no-source blank) is
 * never returned.
 */
export function brandsToRemoveAfterDeletes(
  brandFlavors: Record<string, string[]>,
  deleteKeys: string[],
): string[] {
  const delByBrand: Record<string, Set<string>> = {};
  for (const key of deleteKeys) {
    const s = splitProfileKey(key);
    if (!s) continue;
    (delByBrand[s.brand] ??= new Set()).add(s.flavor);
  }
  const remove: string[] = [];
  for (const [brand, flavors] of Object.entries(brandFlavors)) {
    const del = delByBrand[brand.toLowerCase().trim()];
    if (!del) continue;
    const remaining = (flavors ?? []).filter((f) => !del.has(String(f).toLowerCase().trim()));
    if (remaining.length === 0) remove.push(brand);
  }
  return remove;
}
