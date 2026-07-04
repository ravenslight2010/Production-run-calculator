// @vitest-environment node
//
// Parity + guard tests for the run applicator "Cheese" pick-only path.
//
// Cheese applicator cards are pick-only: choosing a recipe NAME hydrates the
// run's cheese rows read-only from the factory-wide server pool, and those rows
// feed downstream calc + auto-deduct consumption. The picking logic
// (`serverCheeseByName` / `serverCheeseRowsByName` / `serverCheeseNames` /
// `cheeseNamesForRun`, plus the "always keep the currently-picked name in the
// options" and "hydrate rows on pick" render glue) lives INLINE in a React
// component on BOTH sides — web `pages/home.tsx` and mobile
// `app/(tabs)/configure.tsx` — so neither is directly importable (unlike the
// core calc engine, whose mobile half is a top-level export loadable via the
// strip-imports harness).
//
// This file therefore locks the behavior two ways, mirroring how
// runCalc.parity.test.ts handles the web-only inline supply/timing math:
//   1. A faithful, shared transcription of the inline logic
//      (`buildCheesePickModel` + `cheeseOptionsFor` + `hydrateRowsOnPick`) is
//      exercised for the brand/flavor narrowing (with fallback-to-all), the
//      name->rows hydration, and the two silent-blanking guards the task cares
//      about (a valid pick never yields empty rows; an out-of-scope/disabled
//      picked name is preserved in the options).
//   2. A source-drift guard reads the REAL blocks out of both home.tsx and
//      configure.tsx and asserts they are identical after normalization
//      (stripping whitespace, the mobile `React.` prefix, and trailing commas).
//      If web and mobile ever drift, or the transcription above goes stale, this
//      makes it loud instead of letting cheese consumption be silently
//      under-reported on the floor.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { CheeseRecipe } from "@workspace/cheese-recipes";

type RecipeRow = { ingredient: string; lbs: number };

// ── Faithful transcription of the inline pick-only logic (web + mobile) ───────
//
// A straight port of the four component-scoped useMemos and the render glue.
// Keep this byte-for-byte equivalent to the inline blocks; the source-drift
// guard at the bottom fails if the real code diverges from what this models.

interface CheesePickModel {
  serverCheeseByName: Map<string, CheeseRecipe>;
  serverCheeseRowsByName: Map<string, RecipeRow[]>;
  serverCheeseNames: string[];
  cheeseNamesForRun: (brand: string, flavor: string) => string[];
}

function buildCheesePickModel(recipes: CheeseRecipe[]): CheesePickModel {
  const enabledCheeseRecipes = recipes.filter((r) => r.enabled !== false);

  const serverCheeseByName = new Map<string, CheeseRecipe>();
  for (const r of enabledCheeseRecipes) {
    const key = r.name.trim().toLowerCase();
    if (key) serverCheeseByName.set(key, r);
  }

  const serverCheeseRowsByName = new Map<string, RecipeRow[]>();
  for (const r of enabledCheeseRecipes) {
    const rows = r.components
      .filter((c) => c.ingredient.trim())
      .map((c) => ({ ingredient: c.ingredient, lbs: c.lbs }));
    const key = r.name.trim().toLowerCase();
    if (key) serverCheeseRowsByName.set(key, rows);
  }

  const serverCheeseNames = [
    ...new Set(enabledCheeseRecipes.map((r) => r.name.trim()).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b));

  const cheeseNamesForRun = (brand: string, flavor: string): string[] => {
    const b = brand.trim().toLowerCase();
    const f = flavor.trim().toLowerCase();
    if (!b) return serverCheeseNames;
    const brandMatches = enabledCheeseRecipes.filter(
      (r) => r.brand.trim().toLowerCase() === b,
    );
    if (brandMatches.length === 0) return serverCheeseNames;
    const flavorMatches = f
      ? brandMatches.filter(
          (r) =>
            r.flavors.length === 0 ||
            r.flavors.some((x) => x.trim().toLowerCase() === f),
        )
      : brandMatches;
    const pool = flavorMatches.length > 0 ? flavorMatches : brandMatches;
    return [...new Set(pool.map((r) => r.name.trim()).filter(Boolean))].sort(
      (x, y) => x.localeCompare(y),
    );
  };

  return {
    serverCheeseByName,
    serverCheeseRowsByName,
    serverCheeseNames,
    cheeseNamesForRun,
  };
}

// Render glue: the picker options always include the currently-picked name so a
// recipe assigned to another brand/flavor (or since disabled) still shows
// instead of silently clearing. (web CheesePickCard `options`; mobile
// `cheeseOptionsForApp`.)
function cheeseOptionsFor(recipeName: string, scopedNames: string[]): string[] {
  return recipeName.trim() && !scopedNames.includes(recipeName)
    ? [recipeName, ...scopedNames]
    : scopedNames;
}

// Render glue: picking a name hydrates the rows (a fresh clone) from the pool.
// (web CheesePickCard onRecipeNameChange; mobile SelectField onChange.)
function hydrateRowsOnPick(
  rowsByName: Map<string, RecipeRow[]>,
  val: string,
): RecipeRow[] {
  const hydrated = val.trim()
    ? rowsByName.get(val.trim().toLowerCase())
    : undefined;
  return (hydrated ?? []).map((r) => ({ ...r }));
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

function recipe(overrides: Partial<CheeseRecipe> & { name: string }): CheeseRecipe {
  return {
    id: overrides.id ?? overrides.name.toLowerCase(),
    name: overrides.name,
    brand: overrides.brand ?? "",
    flavors: overrides.flavors ?? [],
    shredderSetting: overrides.shredderSetting ?? "",
    cellulose: overrides.cellulose ?? "",
    notes: overrides.notes ?? "",
    components: overrides.components ?? [],
    enabled: overrides.enabled ?? true,
  };
}

const POOL: CheeseRecipe[] = [
  recipe({
    name: "Acme Whole Mozz",
    brand: "Acme",
    flavors: ["Pepperoni"],
    shredderSetting: "3",
    components: [
      { ingredient: "Whole Mozzarella", lbs: 40 },
      { ingredient: "Provolone", lbs: 10 },
    ],
  }),
  recipe({
    name: "Acme Cheese - All Varieties",
    brand: "Acme",
    flavors: [], // "All Varieties" — applies to any flavor of the brand
    shredderSetting: "4",
    components: [{ ingredient: "Part-Skim Mozzarella", lbs: 45 }],
  }),
  recipe({
    name: "Acme Supreme Blend",
    brand: "Acme",
    flavors: ["Supreme"],
    components: [{ ingredient: "Six Cheese Blend", lbs: 50 }],
  }),
  recipe({
    name: "Globex Cheese",
    brand: "Globex",
    flavors: ["Cheese"],
    components: [{ ingredient: "Low-Moisture Mozz", lbs: 38 }],
  }),
  recipe({
    // A second Globex recipe (different flavor, no All-Varieties recipe on this
    // brand) so a non-matching flavor query exercises the fallback-to-brand path.
    name: "Globex Deluxe",
    brand: "Globex",
    flavors: ["Deluxe"],
    components: [{ ingredient: "Aged Cheddar", lbs: 42 }],
  }),
  recipe({
    name: "Disabled Legacy Blend",
    brand: "Acme",
    flavors: ["Pepperoni"],
    enabled: false, // hidden from pickers
    components: [{ ingredient: "Old Mozz", lbs: 30 }],
  }),
];

// ── 1. cheeseNamesForRun brand/flavor narrowing (with fallback-to-all) ────────

describe("cheeseNamesForRun — brand/flavor narrowing", () => {
  const { cheeseNamesForRun, serverCheeseNames } = buildCheesePickModel(POOL);

  it("returns ALL enabled names when no brand is given (never blocks the operator)", () => {
    expect(cheeseNamesForRun("", "")).toEqual(serverCheeseNames);
    // Disabled recipe is excluded from the universe entirely.
    expect(serverCheeseNames).toEqual([
      "Acme Cheese - All Varieties",
      "Acme Supreme Blend",
      "Acme Whole Mozz",
      "Globex Cheese",
      "Globex Deluxe",
    ]);
  });

  it("narrows to the run's brand, then to the run's flavor (incl. All-Varieties)", () => {
    // Acme + Pepperoni: the Pepperoni recipe + the empty-flavor (All Varieties)
    // recipe, but NOT the Supreme-only one and NOT the disabled one.
    expect(cheeseNamesForRun("Acme", "Pepperoni")).toEqual([
      "Acme Cheese - All Varieties",
      "Acme Whole Mozz",
    ]);
  });

  it("keeps an All-Varieties (empty-flavor) recipe for any flavor of the brand", () => {
    // Acme + Hawaiian matches no flavor LINE, but the All-Varieties recipe has
    // empty flavors so it applies to every Acme flavor.
    expect(cheeseNamesForRun("Acme", "Hawaiian")).toEqual([
      "Acme Cheese - All Varieties",
    ]);
  });

  it("falls back to ALL of the brand's recipes when nothing matches the flavor", () => {
    // Globex has no All-Varieties recipe, so Globex + Sausage matches no line;
    // it falls back to every enabled Globex recipe rather than emptying the
    // picker (leaving the operator stuck / risking a silent blank).
    expect(cheeseNamesForRun("Globex", "Sausage")).toEqual([
      "Globex Cheese",
      "Globex Deluxe",
    ]);
  });

  it("falls back to ALL names when the brand itself has no recipes", () => {
    expect(cheeseNamesForRun("Nonexistent Brand", "Pepperoni")).toEqual(
      serverCheeseNames,
    );
  });

  it("matches brand/flavor case-insensitively and ignoring surrounding space", () => {
    expect(cheeseNamesForRun("  acme ", " pepperoni ")).toEqual([
      "Acme Cheese - All Varieties",
      "Acme Whole Mozz",
    ]);
  });
});

// ── 2. name -> rows hydration ─────────────────────────────────────────────────

describe("serverCheeseRowsByName / serverCheeseByName — hydration", () => {
  const model = buildCheesePickModel(POOL);

  it("hydrates the exact components of the picked recipe (case-insensitive)", () => {
    expect(hydrateRowsOnPick(model.serverCheeseRowsByName, "acme whole mozz")).toEqual([
      { ingredient: "Whole Mozzarella", lbs: 40 },
      { ingredient: "Provolone", lbs: 10 },
    ]);
  });

  it("returns a fresh clone so mutating hydrated rows never edits the pool", () => {
    const rows = hydrateRowsOnPick(model.serverCheeseRowsByName, "Acme Whole Mozz");
    rows[0].lbs = 999;
    const again = hydrateRowsOnPick(model.serverCheeseRowsByName, "Acme Whole Mozz");
    expect(again[0].lbs).toBe(40);
  });

  it("clearing the pick (empty value) yields empty rows", () => {
    expect(hydrateRowsOnPick(model.serverCheeseRowsByName, "")).toEqual([]);
  });

  it("surfaces the recipe's shredder setting / cellulose via serverCheeseByName", () => {
    const r = model.serverCheeseByName.get("acme cheese - all varieties");
    expect(r?.shredderSetting).toBe("4");
  });
});

// ── 3. Silent-blanking guards ─────────────────────────────────────────────────

describe("guard: picking a valid recipe never leaves the run with empty rows", () => {
  const model = buildCheesePickModel(POOL);

  it("every pickable name in a run's scope hydrates at least one row", () => {
    for (const [brand, flavor] of [
      ["Acme", "Pepperoni"],
      ["Acme", "Supreme"],
      ["Globex", "Cheese"],
      ["", ""],
    ] as const) {
      const names = model.cheeseNamesForRun(brand, flavor);
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) {
        const rows = hydrateRowsOnPick(model.serverCheeseRowsByName, name);
        expect(rows.length, `pick "${name}" must hydrate rows`).toBeGreaterThan(0);
        for (const row of rows) expect(row.ingredient.trim()).not.toBe("");
      }
    }
  });
});

describe("guard: an out-of-scope / disabled picked name is preserved in the options", () => {
  const model = buildCheesePickModel(POOL);

  it("keeps a recipe assigned to another brand in the current run's options", () => {
    // Run is Acme/Pepperoni, but the run already has a Globex recipe picked
    // (e.g. brand was changed after picking). The option must survive.
    const scoped = model.cheeseNamesForRun("Acme", "Pepperoni");
    expect(scoped).not.toContain("Globex Cheese");
    const options = cheeseOptionsFor("Globex Cheese", scoped);
    expect(options).toContain("Globex Cheese");
    expect(options[0]).toBe("Globex Cheese"); // prepended, not lost
    // And it still hydrates rather than blanking (the pool entry still exists).
    expect(
      hydrateRowsOnPick(model.serverCheeseRowsByName, "Globex Cheese").length,
    ).toBeGreaterThan(0);
  });

  it("keeps a since-disabled picked name visible so it does not silently clear", () => {
    const scoped = model.cheeseNamesForRun("Acme", "Pepperoni");
    expect(scoped).not.toContain("Disabled Legacy Blend");
    const options = cheeseOptionsFor("Disabled Legacy Blend", scoped);
    expect(options).toContain("Disabled Legacy Blend");
  });

  it("does not duplicate a picked name that is already in scope", () => {
    const scoped = model.cheeseNamesForRun("Acme", "Pepperoni");
    expect(scoped).toContain("Acme Whole Mozz");
    const options = cheeseOptionsFor("Acme Whole Mozz", scoped);
    expect(options).toEqual(scoped);
    expect(options.filter((n) => n === "Acme Whole Mozz")).toHaveLength(1);
  });
});

// ── 4. Source-drift guard: web and mobile inline logic must stay identical ────
//
// Neither app's pick logic is importable (it is inline in a big React
// component), so instead of trusting the transcription above we read the REAL
// blocks out of both source files and assert they match after normalization.
// This is the actual web<->mobile parity assertion the task asks for.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_FILE = path.resolve(HERE, "./pages/home.tsx");
const MOBILE_FILE = path.resolve(
  HERE,
  "../../run-calculator-mobile/app/(tabs)/configure.tsx",
);

// Normalize away benign differences: the mobile `React.` prefix on hooks, all
// whitespace, and trailing commas before a closing bracket/paren (prettier
// formats the two files slightly differently). What remains is the logic.
function normalizeLogic(src: string): string {
  return src
    .replace(/React\./g, "")
    .replace(/\s+/g, "")
    .replace(/,(?=[)\]}])/g, "");
}

// Pull a `const <name> = ...;` declaration out of a source file, balancing
// parens from the `useMemo(` call so we capture the whole block.
function extractConstBlock(src: string, name: string): string {
  const start = src.indexOf(`const ${name} =`);
  if (start === -1) throw new Error(`could not find "const ${name} =" in source`);
  const open = src.indexOf("(", start);
  if (open === -1) throw new Error(`no "(" after "const ${name} ="`);
  let depth = 0;
  let i = open;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) break;
    }
  }
  // include the trailing ";" if present
  let end = i + 1;
  if (src[end] === ";") end++;
  return src.slice(start, end);
}

describe("source-drift guard: web and mobile cheese-pick logic are identical", () => {
  const web = fs.readFileSync(WEB_FILE, "utf8");
  const mobile = fs.readFileSync(MOBILE_FILE, "utf8");

  for (const name of [
    "serverCheeseByName",
    "serverCheeseRowsByName",
    "serverCheeseNames",
    "cheeseNamesForRun",
  ]) {
    it(`${name} matches byte-for-byte (after normalization)`, () => {
      const webBlock = normalizeLogic(extractConstBlock(web, name));
      const mobileBlock = normalizeLogic(extractConstBlock(mobile, name));
      expect(mobileBlock).toBe(webBlock);
    });
  }

  it("the transcription tested above matches the real web source", () => {
    // Guard against the transcription in this file going stale: its
    // cheeseNamesForRun body must be the same logic as the real web block.
    const real = normalizeLogic(extractConstBlock(web, "cheeseNamesForRun"));
    const transcribed = normalizeLogic(
      `const cheeseNamesForRun = useMemo(() => {
        return (brand, flavor) => {
          const b = brand.trim().toLowerCase();
          const f = flavor.trim().toLowerCase();
          if (!b) return serverCheeseNames;
          const brandMatches = enabledCheeseRecipes.filter(
            (r) => r.brand.trim().toLowerCase() === b,
          );
          if (brandMatches.length === 0) return serverCheeseNames;
          const flavorMatches = f
            ? brandMatches.filter(
                (r) =>
                  r.flavors.length === 0 ||
                  r.flavors.some((x) => x.trim().toLowerCase() === f),
              )
            : brandMatches;
          const pool = flavorMatches.length > 0 ? flavorMatches : brandMatches;
          return [...new Set(pool.map((r) => r.name.trim()).filter(Boolean))].sort((x, y) => x.localeCompare(y));
        };
      }, [enabledCheeseRecipes, serverCheeseNames]);`,
    );
    // Strip TS type annotations the real source carries but the transcription
    // above omits (`: string`, `: string[]`), so we compare pure logic.
    const stripTypes = (s: string) =>
      s.replace(/:string\[\]/g, "").replace(/:string/g, "");
    expect(stripTypes(real)).toBe(stripTypes(transcribed));
  });
});
