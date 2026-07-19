// @vitest-environment node
//
// End-to-end scripted check for: "Spec-sheet re-imports must remember EVERY
// merge/rename" — brands, flavors, ingredients, applicator/pep types — across
// both the fresh-parse path (canonicalizeParsed) and the saved-parse reuse
// path (applyBrandFlavorAliasesToParse). Exercises the FULL client import
// pipeline (real workbook bytes → readWorkbookGrids → chunking → parse →
// canonicalize) with the AI parse mocked to a DETERMINISTIC fixture and the
// network glue mocked to in-memory stores. Pattern of
// brandRenameReimportRealWorkbooks.test.ts (#216).
//
// Loop under test:
//   1. Import the real spec workbook (fixture parse), see the sheet's names.
//   2. Merge/rename via the SAME learn helpers the app's UI paths call.
//   3. Re-import the SAME workbook and assert the old names land on the
//      merged/renamed targets — nothing resurrects.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sanitizeSpecAliases, type ParsedSpecImport, type SpecImportAlias } from "@workspace/spec-import";

// ── In-memory server stores (shared across mocks) ───────────────────────────
const { aliasStore, knownStore, parseSpy, fetchSheetsSpy } = vi.hoisted(() => ({
  aliasStore: { rows: [] as unknown[] },
  knownStore: {
    brands: [] as string[],
    flavorsByBrand: {} as Record<string, string[]>,
    appTypes: [] as string[],
    pepTypes: [] as string[],
    cheeseIngredients: [] as string[],
    doughIngredients: [] as string[],
    sauceIngredients: [] as string[],
  },
  parseSpy: vi.fn(),
  fetchSheetsSpy: vi.fn(async () => [] as unknown[]),
}));

function aliasKey(a: SpecImportAlias): string {
  return `${a.kind}\u0000${a.externalName.trim().toLowerCase()}\u0000${(a.context ?? "").trim().toLowerCase()}`;
}
/** Mirror the server's ci upsert by (kind, externalName, context). */
function upsertAliases(rows: SpecImportAlias[]) {
  const byKey = new Map<string, SpecImportAlias>(
    (aliasStore.rows as SpecImportAlias[]).map((a) => [aliasKey(a), a]),
  );
  for (const a of rows) byKey.set(aliasKey(a), a);
  aliasStore.rows = [...byKey.values()];
}

vi.mock("./specImportAliases", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./specImportAliases")>();
  return {
    ...actual,
    fetchSpecImportAliases: async () => [...(aliasStore.rows as SpecImportAlias[])],
    saveSpecImportAliases: async (rows: SpecImportAlias[]) => upsertAliases(rows),
  };
});
// The learn* helpers call fetch/save INTERNALLY (module-local references the
// vi.mock above can't intercept) — route the alias endpoint at the fetch layer.
vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("/api/spec-import-aliases")) {
    if ((init?.method ?? "GET").toUpperCase() === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { aliases?: SpecImportAlias[] };
      upsertAliases(body.aliases ?? []);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ aliases: aliasStore.rows }), { status: 200 });
  }
  throw new Error(`unexpected fetch in scripted check: ${url}`);
});
vi.mock("./storage", () => ({
  loadSpecImportKnown: () => ({
    brands: [...knownStore.brands],
    flavorsByBrand: { ...knownStore.flavorsByBrand },
    appTypes: [...knownStore.appTypes],
    pepTypes: [...knownStore.pepTypes],
    cheeseIngredients: [...knownStore.cheeseIngredients],
    doughIngredients: [...knownStore.doughIngredients],
    sauceIngredients: [...knownStore.sauceIngredients],
    sauceNames: [],
    dieTypes: [],
    doughRecipes: [],
    sauceRecipes: [],
    cheeseRecipes: [],
  }),
  profileExistsForImport: () => false,
  recipeExistsForImport: () => false,
  importProfileIsTombstoned: () => false,
  recipeNameIsTombstoned: () => false,
  isNameDeleted: () => false,
  flavorNamespace: (brand: string) => `flavors:${brand}`,
  applySpecImport: vi.fn(),
}));
// Deterministic "AI" parse: the fixture below, regardless of prompt text.
vi.mock("./parseSpecSheet", () => ({ requestParseSpecSheet: parseSpy }));
// No AI matcher — the pipeline must stay deterministic when it throws.
vi.mock("./matchImport", () => ({
  requestMatchImport: async () => {
    throw new Error("no AI matcher in scripted check");
  },
}));
vi.mock("./savedSpecSheets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./savedSpecSheets")>();
  return {
    ...actual,
    saveSpecSheet: async () => {},
    fetchSavedSpecSheets: fetchSheetsSpy,
    buildSpecSheetLabel: () => "Sheet",
    loadCurrentReconcileRecipes: () => [],
  };
});
vi.mock("./aiCorrections", () => ({ saveAiCorrections: async () => {} }));
vi.mock("./cheeseRecipes", () => ({
  fetchCheeseRecipes: async () => [],
  saveCheeseRecipes: async (items: unknown[]) => items,
}));
vi.mock("./mixes", () => ({
  fetchMixes: async () => [],
  saveMixes: async (items: unknown[]) => items,
}));
vi.mock("./namedRecipes", () => ({
  fetchNamedRecipes: async () => [],
  saveNamedRecipes: async (items: unknown[]) => items,
  addNamedRecipesToServerIfAbsent: async () => {},
}));

import { prepareSpecImportMulti, hashSpecImportSource } from "./specImport";
import { deriveSourceKey } from "./savedSpecSheets";
import {
  learnSpecImportAliasesForNameChange,
  learnIngredientChangeAliases,
  buildTypeRenameAliases,
  buildIngredientChangeAliases,
} from "./specImportAliases";

// ── Real workbook bytes (grids/chunking path stays real) ────────────────────
const SPEC_PATH = resolve(
  __dirname,
  "../../../attached_assets/source-library/specs/Aldo's_Pizza_Specs_-_09_1784339783417.xlsx",
);
const SPEC_NAME = "Aldo's_Pizza_Specs_-_09.xlsx";

function specBuf(): ArrayBuffer {
  const buf = readFileSync(SPEC_PATH);
  const out = new ArrayBuffer(buf.byteLength);
  new Uint8Array(out).set(buf);
  return out;
}

// ── Deterministic fixture parse ("what the sheet says") ─────────────────────
function fixtureParse(): ParsedSpecImport {
  return {
    profiles: [
      {
        brand: "Aldo's",
        flavor: "Cheese",
        dieType: "12 inch",
        sauceOzPerPizza: 4,
        applicators: [{ type: "Shredded Mozzarella", ozPerPizza: 5, slot: 1 }],
        pepperonis: [],
      },
      {
        brand: "Aldo's",
        flavor: "Pepperoni",
        dieType: "12 inch",
        sauceOzPerPizza: 4,
        applicators: [{ type: "Shredded Mozzarella", ozPerPizza: 5, slot: 1 }],
        pepperonis: [{ type: "Cup Pepperoni", sticks: 2, ozPerPizza: 3 }],
      },
    ],
    recipes: [
      {
        kind: "dough",
        name: "Aldo Dough",
        targets: [
          { brand: "Aldo's", flavor: "Cheese" },
          { brand: "Aldo's", flavor: "Pepperoni" },
        ],
        rows: [
          { ingredient: "High Gluten Flour", lbs: 50 },
          { ingredient: "Sea Salt (Fine)", lbs: 2 },
        ],
      },
      {
        kind: "sauce",
        name: "Aldo Sauce",
        targets: [{ brand: "Aldo's", flavor: "Cheese" }],
        rows: [{ ingredient: "Tomato Paste", lbs: 30 }],
      },
      {
        kind: "cheese",
        name: "Aldo Topping Blend",
        app: 1,
        targets: [{ brand: "Aldo's", flavor: "Cheese" }],
        rows: [
          { ingredient: "WM Mozzarella", lbs: 20 },
          { ingredient: "Mozzarella (LMPS)", lbs: 10 },
        ],
      },
    ],
  };
}

const lc = (s: string | undefined | null) => (s ?? "").trim().toLowerCase();

async function reimport() {
  return prepareSpecImportMulti([specBuf()], undefined, [SPEC_NAME]);
}

beforeEach(() => {
  aliasStore.rows = [];
  fetchSheetsSpy.mockReset();
  fetchSheetsSpy.mockResolvedValue([]);
  parseSpy.mockReset();
  parseSpy.mockImplementation(async () => fixtureParse());
  knownStore.brands = ["Aldo's"];
  knownStore.flavorsByBrand = { "Aldo's": ["Cheese", "Pepperoni"] };
  knownStore.appTypes = ["Shredded Mozzarella"];
  knownStore.pepTypes = ["Cup Pepperoni"];
  knownStore.cheeseIngredients = ["WM Mozzarella", "Mozzarella (LMPS)"];
  knownStore.doughIngredients = ["High Gluten Flour", "Sea Salt (Fine)"];
  knownStore.sauceIngredients = ["Tomato Paste"];
});

describe("spec re-import remembers merges/renames (real workbook, deterministic parse)", () => {
  it("1. brand merge → re-import does not resurrect the old brand", async () => {
    const first = await reimport();
    expect(first.parsed.profiles.some((p) => lc(p.brand) === "aldo's")).toBe(true);

    // Merge "Aldo's" → "Aldo Foods" the way the merge tab / renameBrand do.
    await learnSpecImportAliasesForNameChange("brand", ["Aldo's"], "Aldo Foods");
    knownStore.brands = ["Aldo Foods"];
    knownStore.flavorsByBrand = { "Aldo Foods": ["Cheese", "Pepperoni"] };

    const second = await reimport();
    expect(second.parsed.profiles.length).toBeGreaterThan(0);
    for (const p of second.parsed.profiles) expect(p.brand).toBe("Aldo Foods");
    for (const r of second.parsed.recipes) {
      for (const t of r.targets ?? []) expect(t.brand).toBe("Aldo Foods");
    }
  });

  it("2. flavor merge → re-import does not resurrect the old flavor", async () => {
    await learnSpecImportAliasesForNameChange("flavor", ["Cheese"], "Classic Cheese", "Aldo's");
    knownStore.flavorsByBrand = { "Aldo's": ["Classic Cheese", "Pepperoni"] };

    const second = await reimport();
    const flavors = second.parsed.profiles.map((p) => p.flavor);
    expect(flavors).toContain("Classic Cheese");
    expect(flavors.map(lc)).not.toContain("cheese");
  });

  it("3. flavor merge THEN brand rename → flavor alias context re-points (fails pre-fix)", async () => {
    // First the flavor merge under the ORIGINAL brand...
    await learnSpecImportAliasesForNameChange("flavor", ["Cheese"], "Classic Cheese", "Aldo's");
    // ...then the brand rename. The brand learn must RE-CONTEXT the flavor
    // alias onto the new brand, or the flavor lookup (which runs with the
    // canonicalized NEW brand as context) never fires.
    await learnSpecImportAliasesForNameChange("brand", ["Aldo's"], "Aldo Foods");
    knownStore.brands = ["Aldo Foods"];
    knownStore.flavorsByBrand = { "Aldo Foods": ["Classic Cheese", "Pepperoni"] };

    const second = await reimport();
    const cheeseProfile = second.parsed.profiles.find((p) => lc(p.flavor) !== "pepperoni");
    expect(cheeseProfile?.brand).toBe("Aldo Foods");
    expect(cheeseProfile?.flavor).toBe("Classic Cheese");
    expect(second.parsed.profiles.map((p) => lc(p.flavor))).not.toContain("cheese");
  });

  it("4. ingredient merge → recipe rows use the target, no resurrected ingredient", async () => {
    // Merge "WM Mozzarella" → "Mozzarella (WMLM)" the way handleApplyMerge
    // now does (all three ingredient kinds). Deliberately NOT a fuzzy-bridgeable
    // pair — only the learned alias can map it.
    await learnIngredientChangeAliases(["WM Mozzarella"], "Mozzarella (WMLM)");
    knownStore.cheeseIngredients = ["Mozzarella (WMLM)", "Mozzarella (LMPS)"];

    const second = await reimport();
    const cheese = second.parsed.recipes.find((r) => r.kind === "cheese")!;
    const rowNames = cheese.rows.map((r) => r.ingredient);
    expect(rowNames).toContain("Mozzarella (WMLM)");
    expect(rowNames.map(lc)).not.toContain("wm mozzarella");
    // The OTHER paren variant must stay itself — never collapsed onto WMLM.
    expect(rowNames).toContain("Mozzarella (LMPS)");
  });

  it("5. applicator/pep type rename → re-import maps the old type", async () => {
    // Rename the way renameIngredientType / renamePepType learn.
    upsertAliases(
      buildTypeRenameAliases("appType", ["Shredded Mozzarella"], "Mozzarella Shred", aliasStore.rows as SpecImportAlias[]),
    );
    upsertAliases(
      buildTypeRenameAliases("pepType", ["Cup Pepperoni"], "Cupping Pep", aliasStore.rows as SpecImportAlias[]),
    );
    knownStore.appTypes = ["Mozzarella Shred"];
    knownStore.pepTypes = ["Cupping Pep"];

    const second = await reimport();
    for (const p of second.parsed.profiles) {
      for (const a of p.applicators) expect(a.type).toBe("Mozzarella Shred");
      for (const pep of p.pepperonis) expect(pep.type).toBe("Cupping Pep");
    }
  });

  it("5b. die type rename → re-import maps the old die name (fails pre-fix)", async () => {
    // Rename the way renameDieType learns: '12 inch' → '12"'. Digit signatures
    // match, so the sanitizer keeps the alias.
    upsertAliases(
      buildTypeRenameAliases("dieType", ["12 inch"], '12"', aliasStore.rows as SpecImportAlias[]),
    );

    const second = await reimport();
    expect(second.parsed.profiles.length).toBeGreaterThan(0);
    for (const p of second.parsed.profiles) expect(p.dieType).toBe('12"');
  });

  it("6. saved-parse REUSE path remaps merged brand+flavor+ingredients+types (no AI re-parse)", async () => {
    // Learn the scenario-3 combo first...
    await learnSpecImportAliasesForNameChange("flavor", ["Cheese"], "Classic Cheese", "Aldo's");
    await learnSpecImportAliasesForNameChange("brand", ["Aldo's"], "Aldo Foods");
    knownStore.brands = ["Aldo Foods"];
    knownStore.flavorsByBrand = { "Aldo Foods": ["Classic Cheese", "Pepperoni"] };
    // ...plus an ingredient merge and app/pep type renames: the reuse path
    // must remap ALL of them, not just brand/flavor.
    await learnIngredientChangeAliases(["WM Mozzarella"], "Mozzarella (WMLM)");
    knownStore.cheeseIngredients = ["Mozzarella (WMLM)", "Mozzarella (LMPS)"];
    upsertAliases(
      buildTypeRenameAliases("appType", ["Shredded Mozzarella"], "Mozzarella Shred", aliasStore.rows as SpecImportAlias[]),
    );
    upsertAliases(
      buildTypeRenameAliases("pepType", ["Cup Pepperoni"], "Cupping Pep", aliasStore.rows as SpecImportAlias[]),
    );
    upsertAliases(
      buildTypeRenameAliases("dieType", ["12 inch"], '12"', aliasStore.rows as SpecImportAlias[]),
    );
    knownStore.appTypes = ["Mozzarella Shred"];
    knownStore.pepTypes = ["Cupping Pep"];

    // A byte-identical snapshot exists — the reuse path must kick in.
    const buf = specBuf();
    const sourceHash = await hashSpecImportSource([buf]);
    fetchSheetsSpy.mockResolvedValue([
      {
        id: 1,
        label: "Sheet",
        sourceKey: deriveSourceKey([SPEC_NAME]),
        sourceHash,
        createdAt: 100,
        data: fixtureParse(), // saved with the OLD names
      },
    ]);
    parseSpy.mockImplementation(async () => {
      throw new Error("AI parse must not run on exact re-import");
    });

    const second = await prepareSpecImportMulti([buf], undefined, [SPEC_NAME]);
    expect(parseSpy).not.toHaveBeenCalled();
    for (const p of second.parsed.profiles) expect(p.brand).toBe("Aldo Foods");
    const cheeseProfile = second.parsed.profiles.find((p) => lc(p.flavor) !== "pepperoni");
    expect(cheeseProfile?.flavor).toBe("Classic Cheese");
    // Ingredient + type aliases must apply on the reuse path too.
    for (const p of second.parsed.profiles) {
      for (const a of p.applicators) expect(a.type).toBe("Mozzarella Shred");
      for (const pep of p.pepperonis) expect(pep.type).toBe("Cupping Pep");
      // Die-type renames must apply on the reuse path too.
      expect(p.dieType).toBe('12"');
    }
    const cheese = second.parsed.recipes.find((r) => r.kind === "cheese")!;
    const rowNames = cheese.rows.map((r) => r.ingredient);
    expect(rowNames).toContain("Mozzarella (WMLM)");
    expect(rowNames.map(lc)).not.toContain("wm mozzarella");
    expect(rowNames).toContain("Mozzarella (LMPS)");
  });

  it("7. parenthetical ingredient names survive verbatim; (A) vs (B) never auto-collapsed", async () => {
    // Only the WMLM variant is known — the sheet's LMPS variant must import
    // as its own NEW name, not snap onto the near-identical known one; and
    // its parenthetical must arrive untouched.
    knownStore.cheeseIngredients = ["Mozzarella (WMLM)"];
    knownStore.doughIngredients = ["High Gluten Flour", "Sea Salt (Coarse)"];

    const first = await reimport();
    const cheese = first.parsed.recipes.find((r) => r.kind === "cheese")!;
    expect(cheese.rows.map((r) => r.ingredient)).toContain("Mozzarella (LMPS)");
    expect(cheese.rows.map((r) => lc(r.ingredient))).not.toContain("mozzarella (wmlm)");
    const dough = first.parsed.recipes.find((r) => r.kind === "dough")!;
    expect(dough.rows.map((r) => r.ingredient)).toContain("Sea Salt (Fine)");
    expect(dough.rows.map((r) => lc(r.ingredient))).not.toContain("sea salt (coarse)");
  });
});

describe("alias builders (unit)", () => {
  it("buildIngredientChangeAliases: all 3 kinds, chain re-point, self-alias drop, dedup", () => {
    const existing: SpecImportAlias[] = [
      // A prior alias resolving onto the soon-merged-away source: must re-point.
      { kind: "cheeseIngredient", externalName: "Mozz WM", canonicalName: "WM Mozzarella", context: null },
      // An alias whose externalName IS the target: dropping it avoids a self-alias.
      { kind: "doughIngredient", externalName: "Mozzarella (WMLM)", canonicalName: "WM Mozzarella", context: null },
    ];
    const rows = buildIngredientChangeAliases(["WM Mozzarella", "wm mozzarella", " "], "Mozzarella (WMLM)", {
      existingAliases: existing,
    });
    const kinds = new Set(rows.map((r) => r.kind));
    expect(kinds).toEqual(new Set(["doughIngredient", "sauceIngredient", "cheeseIngredient"]));
    // Direct rows: one per kind (case-dup source deduped).
    expect(rows.filter((r) => lc(r.externalName) === "wm mozzarella")).toHaveLength(3);
    // Chain re-point kept, self-alias dropped.
    expect(
      rows.find((r) => r.kind === "cheeseIngredient" && r.externalName === "Mozz WM")?.canonicalName,
    ).toBe("Mozzarella (WMLM)");
    expect(rows.some((r) => lc(r.externalName) === "mozzarella (wmlm)")).toBe(false);
    // Every alias points at the target.
    for (const r of rows) expect(r.canonicalName).toBe("Mozzarella (WMLM)");
  });

  it("buildIngredientChangeAliases: kinds option restricts namespaces", () => {
    const rows = buildIngredientChangeAliases(["Old"], "New", { kinds: ["doughIngredient"] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "doughIngredient", externalName: "Old", canonicalName: "New" });
  });

  it("buildTypeRenameAliases: chain re-point across contexts + self-alias drop", () => {
    const existing: SpecImportAlias[] = [
      { kind: "appType", externalName: "Shred Mozz", canonicalName: "Shredded Mozzarella", context: "Aldo's" },
      { kind: "pepType", externalName: "Shred Mozz", canonicalName: "Shredded Mozzarella", context: null },
    ];
    const rows = buildTypeRenameAliases("appType", ["Shredded Mozzarella"], "Mozzarella Shred", existing);
    // Direct row + the re-pointed appType chain row (context preserved); the
    // pepType row is a different kind and must be untouched.
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.externalName === "Shredded Mozzarella")?.canonicalName).toBe("Mozzarella Shred");
    const chained = rows.find((r) => r.externalName === "Shred Mozz")!;
    expect(chained).toMatchObject({ kind: "appType", canonicalName: "Mozzarella Shred", context: "Aldo's" });
    // No-op / blank inputs produce nothing.
    expect(buildTypeRenameAliases("appType", ["Same"], "same", [])).toHaveLength(0);
    expect(buildTypeRenameAliases("pepType", ["Old"], " ", [])).toHaveLength(0);
  });

  it("buildTypeRenameAliases: dieType kind; sanitizer digit guard drops 11\"→12\"", () => {
    const rows = buildTypeRenameAliases("dieType", ["12 inch"], '12"', []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "dieType", externalName: "12 inch", canonicalName: '12"', context: null });
    // Same-digit rename survives the sanitizer; a cross-size alias is poison
    // (an 11" die must never silently become a 12" one) and must be dropped.
    expect(sanitizeSpecAliases(rows)).toHaveLength(1);
    expect(
      sanitizeSpecAliases([{ kind: "dieType", externalName: '11"', canonicalName: '12"', context: null }]),
    ).toHaveLength(0);
  });
});
