// @workspace/spec-export — pure, platform-agnostic logic for the in-app Excel
// EXPORTER of spec profiles + recipes (and, separately, premix "mixes"). It is
// the mirror image of @workspace/spec-import / @workspace/premix-import: those
// turn an uploaded workbook into structured data; this turns the app's current
// profiles/recipes/mixes back into a workbook row model (SheetGrid[]) laid out
// so the SAME importers re-read it without data loss or misparse (export → edit
// in Excel → re-import round-trip).
//
// This package holds NO platform IO (no xlsx write, no storage, no fetch). Web
// and mobile glue gather the current profiles/recipes/mixes, call these
// builders, and hand the resulting SheetGrid[] to their xlsx writer. Keeping the
// logic here keeps both apps thin and identical (replit.md parity), and lets the
// mix round-trip be unit-tested straight through @workspace/premix-import.
//
// Five distinct output workbooks:
//   * Specs — one product profile table per brand.
//   * Dough / Sauce — one recipe per worksheet.
//   * Cheese — recipe blocks grouped by the brands that use them.
//   * Mixes — deterministic premix blocks grouped by brand.
// Mixes remain separate from the AI spec importer format on purpose.

import { PROMPT_MAX_CELL_CHARS, type SheetGrid } from "@workspace/spec-import";
import type { Mix } from "@workspace/mixes";

export type { SheetGrid };

// ── Input shapes ─────────────────────────────────────────────────────────────

export type ExportRecipeRow = { ingredient: string; lbs: number };

/** One dough / sauce / cheese library recipe: a name + its ingredient rows. */
export type ExportRecipe = { name: string; rows: ExportRecipeRow[] };

export type ExportApplicator = { type: string; ozPerPizza: number };
export type ExportPepperoni = { type: string; sticks: number; ozPerPizza: number };

/**
 * One spec profile plus the recipe-name references used to derive which recipes
 * tie to it (so a recipe block can print the "Brand: flavor" targets that let
 * re-import re-attach it without duplicating the library entry).
 */
export type ExportProfile = {
  brand: string;
  flavor: string;
  dieType?: string;
  sauceOzPerPizza?: number;
  /** Applicator slots 1..4 in order (empty slots may be included; skipped on output). */
  applicators: ExportApplicator[];
  /** Up to 2 pepperonis (slots 1..2). */
  pepperonis: ExportPepperoni[];
  /** doughRecipeName reference (ties this profile to a dough recipe). */
  doughRecipeName?: string;
  /** Product-specific dough target weight in oz. */
  targetDoughballWeight?: number;
  /** Product-specific doughballs per tray. */
  doughballsPerTray?: number;
  /** frontlineRecipeName reference (ties this profile to a sauce recipe). */
  sauceRecipeName?: string;
  /** appNCheeseRecipeName references, index 0..3 → applicator slots 1..4. */
  cheeseRecipeNames?: (string | undefined)[];
};

export type SpecExportInput = {
  profiles: ExportProfile[];
  doughRecipes: ExportRecipe[];
  sauceRecipes: ExportRecipe[];
  cheeseRecipes: ExportRecipe[];
};

/** Compatibility selection used by buildSpecExportGrids. */
export type SpecExportSelection = {
  profiles: boolean;
  dough: boolean;
  sauce: boolean;
  cheese: boolean;
};

export type SpecRecipeWorkbookKind = "specs" | "dough" | "sauce" | "cheese";
export type ExportWorkbookKind = SpecRecipeWorkbookKind | "mixes";
export type ExportWorkbook = {
  kind: ExportWorkbookKind;
  grids: SheetGrid[];
};

// ── Cell helpers ─────────────────────────────────────────────────────────────

/** Format a number for a text cell: drop trailing zeros, empty for null/NaN. */
function num(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "";
  // Keep it as the shortest exact decimal (3.5 stays "3.5", 12 stays "12").
  return String(n);
}

function text(s: string | undefined | null): string {
  return (s ?? "").toString().trim();
}

// ── Excel sheet-name sanitiser ───────────────────────────────────────────────

/**
 * Excel worksheet names are max 31 chars and cannot contain : \ / ? * [ ]. This
 * coerces an arbitrary label into a legal name and falls back to a default when
 * it collapses to empty. Pure; the caller de-dupes across a workbook.
 */
export function sanitizeSheetName(name: string, fallback: string): string {
  const cleaned = name
    .replace(/[:\\/?*[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 31)
    .trim();
  return cleaned || fallback;
}

/** Assign unique, legal sheet names to a list of grids (case-insensitive dedupe). */
function dedupeSheetNames(grids: SheetGrid[]): SheetGrid[] {
  const seen = new Set<string>();
  return grids.map((g, i) => {
    let base = sanitizeSheetName(g.name, `Sheet ${i + 1}`);
    let candidate = base;
    let n = 2;
    while (seen.has(candidate.toLowerCase())) {
      // Reserve room for the numeric suffix within the 31-char limit.
      const suffix = ` (${n})`;
      candidate = (base.slice(0, 31 - suffix.length) + suffix).trim();
      n++;
    }
    seen.add(candidate.toLowerCase());
    return { ...g, name: candidate };
  });
}

function recipeSheetName(name: string, kind: "Dough" | "Sauce"): string {
  // Keep the kind first so Excel's 31-character clamp cannot remove the
  // importer context from long recipe names.
  return `${kind} — ${name}`;
}

// ── Recipe → targets derivation ──────────────────────────────────────────────

type RecipeTie = {
  /** brand → set of flavors (preserves each flavor exactly once). */
  targetsByBrand: Map<string, string[]>;
  /** Dough metadata is emitted only when every tied profile agrees. */
  doughballOzs: number[];
  doughballsPerTrayValues: number[];
  targetCount: number;
  doughballOzPresentCount: number;
  doughballsPerTrayPresentCount: number;
  /** Cheese slots by brand; ambiguous multi-slot use is intentionally omitted. */
  appSlotsByBrand: Map<string, number[]>;
};

function addTarget(tie: RecipeTie, brand: string, flavor: string): void {
  const b = brand.trim();
  const f = flavor.trim();
  if (!b || !f) return;
  const list = tie.targetsByBrand.get(b) ?? [];
  if (!list.some((x) => x.toLowerCase() === f.toLowerCase())) {
    list.push(f);
    tie.targetsByBrand.set(b, list);
  }
}

function eq(a: string | undefined, b: string): boolean {
  return text(a).toLowerCase() === b.trim().toLowerCase() && b.trim().length > 0;
}

/**
 * Walk every profile and collect, per recipe name (within a kind), the
 * brand+flavor profiles that reference it. Used to print "Brand: flavor" header
 * rows so re-import re-attaches the recipe to exactly those profiles.
 */
function tieRecipes(
  profiles: ReadonlyArray<ExportProfile>,
  kind: "dough" | "sauce" | "cheese",
): Map<string, RecipeTie> {
  const byName = new Map<string, RecipeTie>();
  const get = (name: string): RecipeTie => {
    const key = name.trim().toLowerCase();
    let tie = byName.get(key);
    if (!tie) {
      tie = {
        targetsByBrand: new Map(),
        doughballOzs: [],
        doughballsPerTrayValues: [],
        targetCount: 0,
        doughballOzPresentCount: 0,
        doughballsPerTrayPresentCount: 0,
        appSlotsByBrand: new Map(),
      };
      byName.set(key, tie);
    }
    return tie;
  };
  for (const p of profiles) {
    if (kind === "dough") {
      const nm = text(p.doughRecipeName);
      if (nm) {
        const tie = get(nm);
        addTarget(tie, p.brand, p.flavor);
        tie.targetCount += 1;
        if (
          p.targetDoughballWeight &&
          p.targetDoughballWeight > 0 &&
          !tie.doughballOzs.includes(p.targetDoughballWeight)
        ) {
          tie.doughballOzs.push(p.targetDoughballWeight);
        }
        if (p.targetDoughballWeight && p.targetDoughballWeight > 0) {
          tie.doughballOzPresentCount += 1;
        }
        if (
          p.doughballsPerTray &&
          p.doughballsPerTray > 0 &&
          !tie.doughballsPerTrayValues.includes(p.doughballsPerTray)
        ) {
          tie.doughballsPerTrayValues.push(p.doughballsPerTray);
        }
        if (p.doughballsPerTray && p.doughballsPerTray > 0) {
          tie.doughballsPerTrayPresentCount += 1;
        }
      }
    } else if (kind === "sauce") {
      const nm = text(p.sauceRecipeName);
      if (nm) addTarget(get(nm), p.brand, p.flavor);
    } else {
      const names = p.cheeseRecipeNames ?? [];
      for (let slot = 1; slot <= 4; slot++) {
        const nm = text(names[slot - 1]);
        if (!nm) continue;
        const tie = get(nm);
        addTarget(tie, p.brand, p.flavor);
        const brand = text(p.brand);
        if (brand) {
          const slots = tie.appSlotsByBrand.get(brand) ?? [];
          if (!slots.includes(slot)) slots.push(slot);
          tie.appSlotsByBrand.set(brand, slots);
        }
      }
    }
  }
  return byName;
}

// ── Profiles sheet ───────────────────────────────────────────────────────────

/**
 * Build the dynamic Profiles sheet header. Only emits columns for the
 * applicator / pepperoni slots that are actually in use — a factory using
 * 2 applicators and 1 pep type gets ~12 columns instead of always 20.
 * Abbreviations are spelled out ("Applicator", "Pepperoni") so the sheet
 * is readable without knowing the import format.
 */
function buildProfilesGrid(profiles: ReadonlyArray<ExportProfile>, sheetName = "Profiles"): SheetGrid {
  const sorted = [...profiles].sort(
    (a, b) =>
      a.brand.localeCompare(b.brand) || a.flavor.localeCompare(b.flavor),
  );

  // Scan to find the highest slot index that has at least one non-empty value
  // across all exported profiles, so trailing empty columns are omitted.
  let maxAppSlot = -1;
  let maxPepSlot = -1;
  for (const p of sorted) {
    const apps = p.applicators ?? [];
    for (let i = 0; i < apps.length; i++) {
      if (text(apps[i]?.type)) maxAppSlot = Math.max(maxAppSlot, i);
    }
    const peps = (p.pepperonis ?? []).filter((pp) => text(pp.type));
    if (peps.length > 0) maxPepSlot = Math.max(maxPepSlot, peps.length - 1);
  }
  const appSlots = maxAppSlot + 1; // 0 when no applicators used
  const pepSlots = maxPepSlot + 1; // 0 when no peps used
  const hasDoughballWeight = sorted.some((p) => (p.targetDoughballWeight ?? 0) > 0);
  const hasDoughballsPerTray = sorted.some((p) => (p.doughballsPerTray ?? 0) > 0);

  // Build the header row for only the slots in use.
  const header: string[] = [
    "Brand",
    "Flavor",
    "Die Type",
    "Sauce oz/pizza",
    "Dough Recipe",
  ];
  if (hasDoughballWeight) header.push("Target Doughball Weight (oz)");
  if (hasDoughballsPerTray) header.push("Doughballs Per Tray");
  header.push("Sauce Recipe");
  for (let i = 0; i < appSlots; i++) {
    header.push(
      `Applicator ${i + 1} Type`,
      `Applicator ${i + 1} oz/pizza`,
      `Applicator ${i + 1} Recipe`,
    );
  }
  for (let i = 0; i < pepSlots; i++) {
    header.push(`Pepperoni ${i + 1} Type`, `Pepperoni ${i + 1} Sticks`, `Pepperoni ${i + 1} oz/pizza`);
  }

  const rows: string[][] = [header];
  for (const p of sorted) {
    const brand = text(p.brand);
    const flavor = text(p.flavor);
    if (!brand || !flavor) continue;
    const apps = p.applicators ?? [];
    const peps = (p.pepperonis ?? []).filter((pp) => text(pp.type));
    const row: string[] = [
      brand,
      flavor,
      text(p.dieType),
      num(p.sauceOzPerPizza),
      // Dough/Sauce recipe NAMES: the product's assigned dough and sauce types.
      // On re-import the AI reads these as the profile's doughName/sauceName, so
      // a factory export round-trips each product's dough/sauce assignment even
      // when the recipe itself lives on another tab (or doesn't exist yet).
      text(p.doughRecipeName),
    ];
    if (hasDoughballWeight) row.push(num(p.targetDoughballWeight));
    if (hasDoughballsPerTray) row.push(num(p.doughballsPerTray));
    row.push(text(p.sauceRecipeName));
    for (let i = 0; i < appSlots; i++) {
      const a = apps[i];
      const type = text(a?.type);
      row.push(
        type,
        type ? num(a?.ozPerPizza) : "",
        type ? text(p.cheeseRecipeNames?.[i]) : "",
      );
    }
    for (let i = 0; i < pepSlots; i++) {
      const pp = peps[i];
      const type = text(pp?.type);
      row.push(type, type ? num(pp?.sticks) : "", type ? num(pp?.ozPerPizza) : "");
    }
    rows.push(row);
  }
  return {
    name: sheetName,
    rows,
    boldRows: [0],
    accentRows: [0],
    headerRows: [0],
    columnWidths: header.map((label, index) =>
      index < 2 ? Math.max(18, Math.min(30, label.length + 4)) : Math.max(14, Math.min(24, label.length + 2)),
    ),
    wrapText: true,
    freezeRows: 1,
    autoFilter: { startRow: 0, endRow: Math.max(0, rows.length - 1) },
  };
}

// ── Recipe sheets ────────────────────────────────────────────────────────────

/**
 * Build one recipe sheet (dough / sauce / cheese). Each recipe is a block:
 *   Recipe: <name>
 *   <Brand>: <flavor>, <flavor>          (one row per brand it's used for)
 *   Target Doughball Weight (oz) | <n>   (dough only, when known)
 *   Applicator Slot | <n>                (cheese only, when known)
 *   Ingredient | Lbs
 *   <ingredient> | <lbs>
 *   …
 *   (blank spacer)
 * The "Recipe:"/"Ingredient"/"Brand: flavor" shapes are exactly the ones the
 * spec-import parse prompt already recognises, so re-import reconstructs the
 * recipe, its kind (from the tab name + ingredients), and its targets.
 */
function buildRecipeGrid(
  sheetName: string,
  kind: "dough" | "sauce" | "cheese",
  recipes: ReadonlyArray<ExportRecipe>,
  ties: Map<string, RecipeTie>,
  targetBrand?: string,
): SheetGrid {
  const rows: string[][] = [];
  const boldRows: number[] = [];
  const sorted = [...recipes].sort((a, b) => a.name.localeCompare(b.name));
  for (const r of sorted) {
    const name = text(r.name);
    const ingredientRows = (r.rows ?? []).filter((row) => text(row.ingredient));
    if (!name || ingredientRows.length === 0) continue;
    boldRows.push(rows.length); // mark the "Recipe: X" label row as bold
    rows.push([`Recipe: ${name}`]);
    const tie = ties.get(name.toLowerCase());
    if (tie) {
      for (const [brand, flavors] of tie.targetsByBrand) {
        if (targetBrand && brand.toLowerCase() !== targetBrand.toLowerCase()) continue;
        // The AI prompt path clamps each CELL to PROMPT_MAX_CELL_CHARS when the
        // workbook is flattened for parsing. A brand with many flavors renders
        // one long single-cell line — if it exceeds the clamp, the trailing
        // flavors get silently truncated and re-import loses those targets
        // (verified end-to-end: 8-flavor brands lost "BBQ Chicken"/"Veggie").
        // Wrap into multiple "Brand: f1, f2" rows that each fit under the
        // clamp; the importer unions repeated brand rows into one target set.
        let group: string[] = [];
        const flush = () => {
          if (group.length) rows.push([`${brand}: ${group.join(", ")}`]);
          group = [];
        };
        for (const flavor of flavors) {
          const line = `${brand}: ${[...group, flavor].join(", ")}`;
          if (group.length > 0 && line.length > PROMPT_MAX_CELL_CHARS) flush();
          group.push(flavor);
        }
        flush();
      }
      if (
        kind === "dough" &&
        tie.doughballOzs.length === 1 &&
        tie.doughballOzPresentCount === tie.targetCount
      ) {
        rows.push(["Target Doughball Weight (oz)", num(tie.doughballOzs[0])]);
      }
      if (
        kind === "dough" &&
        tie.doughballsPerTrayValues.length === 1 &&
        tie.doughballsPerTrayPresentCount === tie.targetCount
      ) {
        rows.push(["Doughballs Per Tray", num(tie.doughballsPerTrayValues[0])]);
      }
      if (kind === "cheese") {
        const slots = targetBrand
          ? tie.appSlotsByBrand.get(targetBrand) ?? []
          : [...new Set([...tie.appSlotsByBrand.values()].flat())];
        if (slots.length === 1) rows.push(["Applicator Slot", num(slots[0])]);
      }
    }
    rows.push(["Ingredient", "Lbs"]);
    for (const row of ingredientRows) {
      rows.push([text(row.ingredient), num(row.lbs)]);
    }
    rows.push([]); // spacer between blocks
  }
  const headerRows = rows.flatMap((row, index) => row[0] === "Ingredient" ? [index] : []);
  return {
    name: sheetName,
    rows,
    boldRows: [...boldRows, ...headerRows],
    accentRows: boldRows,
    headerRows,
    columnWidths: [42, 16],
    wrapText: true,
    freezeRows: 1,
    numberFormats: [{ columns: [1], format: "0.###" }],
  };
}

function validProfiles(profiles: ReadonlyArray<ExportProfile>): ExportProfile[] {
  return profiles.filter((profile) => text(profile.brand) && text(profile.flavor));
}

/** Specs workbook: one worksheet per brand, preserving the Brand column. */
export function buildSpecsExportGrids(input: SpecExportInput): SheetGrid[] {
  const byBrand = new Map<string, ExportProfile[]>();
  for (const profile of validProfiles(input.profiles ?? [])) {
    const brand = text(profile.brand);
    const list = byBrand.get(brand) ?? [];
    list.push(profile);
    byBrand.set(brand, list);
  }
  return dedupeSheetNames(
    [...byBrand.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([brand, profiles]) => buildProfilesGrid(profiles, brand)),
  );
}

/** Dough workbook: every library recipe gets its own importer-safe worksheet. */
export function buildDoughExportGrids(input: SpecExportInput): SheetGrid[] {
  const ties = tieRecipes(input.profiles ?? [], "dough");
  return dedupeSheetNames(
    [...(input.doughRecipes ?? [])]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((recipe) =>
        buildRecipeGrid(
          recipeSheetName(text(recipe.name) || "Dough Recipe", "Dough"),
          "dough",
          [recipe],
          ties,
        ),
      )
      .filter((grid) => grid.rows.length > 0),
  );
}

/** Sauce workbook: every library recipe gets its own importer-safe worksheet. */
export function buildSauceExportGrids(input: SpecExportInput): SheetGrid[] {
  const ties = tieRecipes(input.profiles ?? [], "sauce");
  return dedupeSheetNames(
    [...(input.sauceRecipes ?? [])]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((recipe) =>
        buildRecipeGrid(
          recipeSheetName(text(recipe.name) || "Sauce Recipe", "Sauce"),
          "sauce",
          [recipe],
          ties,
        ),
      )
      .filter((grid) => grid.rows.length > 0),
  );
}

/**
 * Cheese workbook: one worksheet per using brand. Shared recipes are repeated
 * on every applicable brand sheet; recipes with no profile references live on
 * Unassigned.
 */
export function buildCheeseExportGrids(input: SpecExportInput): SheetGrid[] {
  const recipes = (input.cheeseRecipes ?? []).filter(
    (recipe) => text(recipe.name) && (recipe.rows ?? []).some((row) => text(row.ingredient)),
  );
  const ties = tieRecipes(input.profiles ?? [], "cheese");
  const brands = new Set<string>();
  for (const recipe of recipes) {
    const tie = ties.get(text(recipe.name).toLowerCase());
    for (const brand of tie?.targetsByBrand.keys() ?? []) brands.add(brand);
  }
  const grids: SheetGrid[] = [...brands]
    .sort((a, b) => a.localeCompare(b))
    .map((brand) => {
      const used = recipes.filter((recipe) =>
        ties.get(text(recipe.name).toLowerCase())?.targetsByBrand.has(brand),
      );
      return buildRecipeGrid(brand, "cheese", used, ties, brand);
    });
  const unassigned = recipes.filter(
    (recipe) => (ties.get(text(recipe.name).toLowerCase())?.targetsByBrand.size ?? 0) === 0,
  );
  if (unassigned.length) grids.push(buildRecipeGrid("Unassigned", "cheese", unassigned, ties));
  return dedupeSheetNames(grids);
}

export function buildSpecRecipeExportWorkbooks(input: SpecExportInput): ExportWorkbook[] {
  return [
    { kind: "specs", grids: buildSpecsExportGrids(input) },
    { kind: "dough", grids: buildDoughExportGrids(input) },
    { kind: "sauce", grids: buildSauceExportGrids(input) },
    { kind: "cheese", grids: buildCheeseExportGrids(input) },
  ];
}

/**
 * Build the spec/recipe export workbook (for the AI "Import Spec Sheet"). Only
 * the selected kinds are emitted; a selected-but-empty kind is skipped so the
 * workbook never carries a blank tab. Pure.
 */
export function buildSpecExportGrids(
  input: SpecExportInput,
  selection: SpecExportSelection,
): SheetGrid[] {
  return dedupeSheetNames([
    ...(selection.profiles ? buildSpecsExportGrids(input) : []),
    ...(selection.dough ? buildDoughExportGrids(input) : []),
    ...(selection.sauce ? buildSauceExportGrids(input) : []),
    ...(selection.cheese ? buildCheeseExportGrids(input) : []),
  ]);
}

// ── Mixes workbook (premix format) ───────────────────────────────────────────

/**
 * Build the mixes export workbook — one tab per brand in the DETERMINISTIC premix
 * layout so "Import Premix Sheet" re-reads it exactly:
 *   Product Brand | <brand>
 *   Product Flavor | <flavor>
 *   <mix name>
 *   Pull N Days Early                    (only when daysEarly > 0)
 *   Ingredient | Per Pizza | Per Batch   (the "Per Pizza" anchor)
 *   <ingredient> | <perPizza> |
 *   Total | (blank) | <batchSize>
 * Explicit markers preserve each product association when several vertical
 * blocks share one brand tab. The original mix name keeps deterministic IDs
 * stable on re-import. Pure. Disabled/empty mixes are still exported.
 */
export function buildMixExportGrids(mixes: ReadonlyArray<Mix>): SheetGrid[] {
  const byBrand = new Map<string, Mix[]>();
  for (const mix of mixes) {
    const brand = text(mix.brand) || "Unassigned";
    const list = byBrand.get(brand) ?? [];
    list.push(mix);
    byBrand.set(brand, list);
  }
  const grids: SheetGrid[] = [];
  const entries = [...byBrand.entries()].sort(([a], [b]) => {
    if (a === "Unassigned") return 1;
    if (b === "Unassigned") return -1;
    return a.localeCompare(b);
  });
  for (const [brand, brandMixes] of entries) {
    const rows: string[][] = [];
    const accentRows: number[] = [];
    const headerRows: number[] = [];
    for (const m of [...brandMixes].sort((a, b) =>
      text(a.flavor).localeCompare(text(b.flavor)) || text(a.name).localeCompare(text(b.name)),
    )) {
      const name = text(m.name);
      const components = (m.components ?? []).filter((c) => text(c.ingredient));
      if (!name && components.length === 0) continue;
      if (rows.length) rows.push([]);
      accentRows.push(rows.length);
      rows.push(["Product Brand", text(m.brand)]);
      rows.push(["Product Flavor", text(m.flavor)]);
      rows.push([name || `${text(m.brand)} ${text(m.flavor)}`.trim()]);
      if (m.daysEarly && m.daysEarly > 0) {
        rows.push([`Pull ${m.daysEarly} Days Early`]);
      }
      headerRows.push(rows.length);
      rows.push(["Ingredient", "Per Pizza", "Per Batch"]);
      for (const c of components) {
        rows.push([text(c.ingredient), num(c.perPizza), ""]);
      }
      rows.push(["Total", "", num(m.batchSize)]);
    }
    if (!rows.length) continue;
    grids.push({
      name: brand,
      rows,
      boldRows: [...accentRows, ...headerRows],
      accentRows,
      headerRows,
      columnWidths: [42, 18, 18],
      wrapText: true,
      freezeRows: 1,
      numberFormats: [{ columns: [1, 2], format: "0.###" }],
    });
  }
  return dedupeSheetNames(grids);
}
