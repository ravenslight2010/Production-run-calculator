// Brand-fan dough cross-contamination heal (pure logic — no DB).
//
// Production incident: before the "brand-fan linked-name narrowing" fix,
// importing a brand-anchored dough mixing procedure whose qualifier tokens
// matched no flavor of the brand fanned that dough's name, recipe rows and
// doughball numbers onto EVERY profile of the brand — e.g. re-importing
// "Lowe's French Fry Dough Mixing Procedure" (Jul 19-20, 2026) put French Fry
// dough (15 oz) onto Lowe's Caribbean/Pepperoni/White Spinach (CRB per spec),
// "Malted Barley Dough" (13.8 oz) onto every Hannaford / Nob Hill Craft /
// Lucia's Craft flavor, and Mauro's "Pedone Crust" onto Lowe's Supreme.
// Scheduled day-state runs picked up a sibling poison: correct dough names
// but the family pool's ROOT doughball weight (CRB 5.7 = Lowe's 7-inch,
// Malted Barley 7.8 = Lowe's Thin) instead of the brand's variant weight.
//
// Expected values below were audited against the customer's own workbooks:
// the Jul 19 saved spec-sheet parses (per-flavor dough/sauce link — the
// deterministic ground truth) and the dough mixing procedures' doughball
// charts (variant weights), corroborated by the pre-poison dev snapshot.
// See attached_assets/source-library/AUDIT-REPORT-2026-07-21.md.

export type FanHealTarget = {
  /** lowercased profile brand (profile key prefix / dayState.runs.brand) */
  brand: string;
  /** lowercased flavor */
  flavor: string;
  /** correct dough recipe name (canonical live-pool spelling) */
  dough: string;
  /** correct target doughball weight oz (0 = unset) */
  weightOz: number;
  /** poisoned dough names observed for this profile (lowercased, loose) */
  poisonedNames: string[];
  /** poisoned doughball weights observed (profile fan value or pool root) */
  poisonedOz: number[];
};

const CRB = "CRB Dough";
const MB = "Malted Barley Dough";
const FF = "Lowe's French Fry Dough";
const LUCIA_FF = "LUCIA'S FRENCH FRY DOUGH";

const mbPoison = [MB.toLowerCase()];
const ffPoison = [FF.toLowerCase()];

export const BRAND_FAN_TARGETS: FanHealTarget[] = [
  // ── Hannaford (spec: Hannaford's Pizza Recipe Specs - 19) ────────────────
  { brand: "hannaford", flavor: "bbq chicken", dough: CRB, weightOz: 7.6, poisonedNames: mbPoison, poisonedOz: [13.8, 5.7] },
  { brand: "hannaford", flavor: "chicken bacon club", dough: CRB, weightOz: 13, poisonedNames: [], poisonedOz: [5.7] },
  { brand: "hannaford", flavor: "chicken tikka masala", dough: "Naan Dough", weightOz: 0, poisonedNames: mbPoison, poisonedOz: [13.8] },
  { brand: "hannaford", flavor: "five cheese", dough: CRB, weightOz: 7.6, poisonedNames: mbPoison, poisonedOz: [13.8, 5.7] },
  { brand: "hannaford", flavor: "four cheese with sweet & spicy chili sauce", dough: CRB, weightOz: 13, poisonedNames: mbPoison, poisonedOz: [13.8, 5.7] },
  { brand: "hannaford", flavor: "spinach goat cheese", dough: CRB, weightOz: 13, poisonedNames: mbPoison, poisonedOz: [13.8, 5.7] },
  { brand: "hannaford", flavor: "4 meat", dough: MB, weightOz: 13.8, poisonedNames: [], poisonedOz: [7.8] },
  // ── Lowe's 11" (spec: Lowe's Pizza Recipe Specs - 28) ────────────────────
  { brand: "lowe's", flavor: "bbq chicken", dough: CRB, weightOz: 7.6, poisonedNames: [], poisonedOz: [5.7] },
  { brand: "lowe's", flavor: "five cheese", dough: CRB, weightOz: 7.6, poisonedNames: [], poisonedOz: [5.7] },
  { brand: "lowe's", flavor: "grilled vegetable", dough: CRB, weightOz: 7.6, poisonedNames: [], poisonedOz: [5.7] },
  { brand: "lowe's", flavor: "californian", dough: CRB, weightOz: 7.6, poisonedNames: ["margherita dough"], poisonedOz: [5.7, 11] },
  { brand: "lowe's", flavor: "caribbean", dough: CRB, weightOz: 13, poisonedNames: ffPoison, poisonedOz: [15, 5.7] },
  { brand: "lowe's", flavor: "spinach & mushroom", dough: CRB, weightOz: 13, poisonedNames: ffPoison, poisonedOz: [15, 5.7] },
  { brand: "lowe's", flavor: "pepperoni", dough: CRB, weightOz: 7.6, poisonedNames: ffPoison, poisonedOz: [15, 5.7] },
  { brand: "lowe's", flavor: "white spinach", dough: CRB, weightOz: 7.6, poisonedNames: ffPoison, poisonedOz: [15, 5.7] },
  { brand: "lowe's", flavor: "chicken bacon ranch", dough: MB, weightOz: 7.8, poisonedNames: ffPoison, poisonedOz: [15] },
  { brand: "lowe's", flavor: "red hot chicken", dough: MB, weightOz: 7.8, poisonedNames: ffPoison, poisonedOz: [15] },
  { brand: "lowe's", flavor: "supreme", dough: MB, weightOz: 7.8, poisonedNames: ['pedone crust 7"x12" oval'], poisonedOz: [] },
  // ── Lucia's Craft (spec: Lucia Craft Pizza (New) Recipe Specs - 01) ──────
  { brand: "lucia's craft", flavor: "backyard bbq chicken", dough: CRB, weightOz: 13.8, poisonedNames: mbPoison, poisonedOz: [5.7] },
  { brand: "lucia's craft", flavor: "four cheese meltdown", dough: CRB, weightOz: 13.8, poisonedNames: mbPoison, poisonedOz: [5.7] },
  { brand: "lucia's craft", flavor: "house dlux", dough: CRB, weightOz: 13.8, poisonedNames: mbPoison, poisonedOz: [5.7] },
  { brand: "lucia's craft", flavor: "sweet chili garden", dough: CRB, weightOz: 13.8, poisonedNames: mbPoison, poisonedOz: [5.7] },
  { brand: "lucia's craft", flavor: "bacon burger supreme", dough: LUCIA_FF, weightOz: 14, poisonedNames: mbPoison, poisonedOz: [] },
  { brand: "lucia's craft", flavor: "blazin' pepperoni & jalapeno", dough: "Sriracha Dough", weightOz: 12, poisonedNames: mbPoison, poisonedOz: [] },
  { brand: "lucia's craft", flavor: "meat market special", dough: MB, weightOz: 13.8, poisonedNames: [], poisonedOz: [7.8] },
  { brand: "lucia's craft", flavor: "nashville style hot chicken", dough: MB, weightOz: 13.8, poisonedNames: [], poisonedOz: [7.8] },
  // ── Nob Hill Craft (spec: Nob Hill Pizza Recipe Specs - 3) ───────────────
  { brand: "nob hill craft", flavor: "bacon cheeseburger", dough: LUCIA_FF, weightOz: 14, poisonedNames: mbPoison, poisonedOz: [] },
  { brand: "nob hill craft", flavor: "caribbean", dough: CRB, weightOz: 13, poisonedNames: mbPoison, poisonedOz: [] },
  { brand: "nob hill craft", flavor: "south of the border", dough: "Masa Dough", weightOz: 12, poisonedNames: mbPoison, poisonedOz: [] },
];

export function fanTargetKey(brand: string, flavor: string): string {
  return `${brand.trim().toLowerCase()}__${flavor.trim().toLowerCase()}`;
}

const TARGETS_BY_KEY = new Map(
  BRAND_FAN_TARGETS.map((t) => [fanTargetKey(t.brand, t.flavor), t]),
);

export function findFanTarget(
  brand: string,
  flavor: string,
): FanHealTarget | undefined {
  return TARGETS_BY_KEY.get(fanTargetKey(brand, flavor));
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

function looseNameEq(a: string, b: string): boolean {
  const key = (s: string) =>
    s
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .replace(/[^a-z0-9']+/g, " ")
      .trim();
  return key(a) === key(b);
}

export type DoughPoolRow = {
  name: string;
  components: { ingredient: string; lbs: number }[];
};

/**
 * Apply the fan heal to one values payload (brand-profile values or a
 * day-state runValues entry). Returns the mutated copy when the stored dough
 * is provably poisoned, or null when nothing matches (already corrected,
 * manager-overridden to something else, or clean).
 */
export function healFanPoisonedValues(
  values: Record<string, unknown>,
  target: FanHealTarget,
  pool: DoughPoolRow[],
): Record<string, unknown> | null {
  const currentName = String(values.doughRecipeName ?? "").trim();
  const currentOz = Number(values.targetDoughballWeight ?? 0);

  const nameIsPoisoned = target.poisonedNames.some((p) =>
    looseNameEq(currentName, p),
  );
  const weightIsPoisoned =
    !nameIsPoisoned &&
    looseNameEq(currentName, target.dough) &&
    currentOz > 0 &&
    !near(currentOz, target.weightOz) &&
    target.poisonedOz.some((p) => near(currentOz, p));

  if (!nameIsPoisoned && !weightIsPoisoned) return null;

  const next = { ...values };
  next.targetDoughballWeight = target.weightOz;
  // Stored yield derived from the wrong dough/weight — clear so the app
  // re-derives from the corrected rows.
  next.doughBatchYield = 0;
  if (nameIsPoisoned) {
    next.doughRecipeName = target.dough;
    const poolRow = pool.find((r) => looseNameEq(r.name, target.dough));
    if (poolRow && poolRow.components.length > 0) {
      next.doughRecipe = poolRow.components.map((c) => ({
        ingredient: c.ingredient,
        lbs: c.lbs,
      }));
    }
  }
  return next;
}
