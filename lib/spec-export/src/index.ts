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
// Two distinct output workbooks (the two importers have different formats):
//   * buildSpecExportGrids(...)  → profiles + dough/sauce/cheese recipe tabs,
//     meant for the AI-based "Import Spec Sheet". Uses labelled tabular layouts
//     and "Brand: flavor" header rows the parse prompt already understands.
//   * buildMixExportGrids(...)   → one tab per mix in the DETERMINISTIC premix
//     format ("Per Pizza"/"Per Batch" columns, a "Total" row, an optional
//     "Pull N Days Early" note) so "Import Premix Sheet" re-reads it exactly.
// They are kept in SEPARATE workbooks on purpose: feeding mix tabs to the AI
// spec importer (or spec/recipe tabs to the premix scanner) would cross-parse.

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
  /** Dough target doughball weight in oz (exported alongside the dough recipe). */
  targetDoughballWeight?: number;
  /** Doughballs per tray (exported alongside the dough recipe). */
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

/** Which kinds the user chose to include in the spec/recipe workbook. */
export type SpecExportSelection = {
  profiles: boolean;
  dough: boolean;
  sauce: boolean;
  cheese: boolean;
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

// ── Recipe → targets derivation ──────────────────────────────────────────────

type RecipeTie = {
  /** brand → set of flavors (preserves each flavor exactly once). */
  targetsByBrand: Map<string, string[]>;
  /** Dough only: first non-zero target doughball weight found. */
  doughballOz?: number;
  /** Dough only: first non-zero doughballs-per-tray count found. */
  doughballsPerTray?: number;
  /** Cheese only: applicator slot (1-4) the recipe first ties to. */
  appSlot?: number;
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
      tie = { targetsByBrand: new Map() };
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
        if (tie.doughballOz == null && p.targetDoughballWeight && p.targetDoughballWeight > 0) {
          tie.doughballOz = p.targetDoughballWeight;
        }
        if (tie.doughballsPerTray == null && p.doughballsPerTray && p.doughballsPerTray > 0) {
          tie.doughballsPerTray = p.doughballsPerTray;
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
        if (tie.appSlot == null) tie.appSlot = slot;
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
function buildProfilesGrid(profiles: ReadonlyArray<ExportProfile>): SheetGrid {
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

  // Build the header row for only the slots in use.
  const header: string[] = [
    "Brand",
    "Flavor",
    "Die Type",
    "Sauce oz/pizza",
    "Dough Recipe",
    "Sauce Recipe",
  ];
  for (let i = 0; i < appSlots; i++) {
    header.push(`Applicator ${i + 1} Type`, `Applicator ${i + 1} oz/pizza`);
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
      text(p.sauceRecipeName),
    ];
    for (let i = 0; i < appSlots; i++) {
      const a = apps[i];
      const type = text(a?.type);
      row.push(type, type ? num(a?.ozPerPizza) : "");
    }
    for (let i = 0; i < pepSlots; i++) {
      const pp = peps[i];
      const type = text(pp?.type);
      row.push(type, type ? num(pp?.sticks) : "", type ? num(pp?.ozPerPizza) : "");
    }
    rows.push(row);
  }
  return { name: "Profiles", rows, boldRows: [0] };
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
      if (kind === "dough" && tie.doughballOz != null) {
        rows.push(["Target Doughball Weight (oz)", num(tie.doughballOz)]);
      }
      if (kind === "dough" && tie.doughballsPerTray != null) {
        rows.push(["Doughballs Per Tray", num(tie.doughballsPerTray)]);
      }
      if (kind === "cheese" && tie.appSlot != null) {
        rows.push(["Applicator Slot", num(tie.appSlot)]);
      }
    }
    rows.push(["Ingredient", "Lbs"]);
    for (const row of ingredientRows) {
      rows.push([text(row.ingredient), num(row.lbs)]);
    }
    rows.push([]); // spacer between blocks
  }
  return { name: sheetName, rows, boldRows };
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
  const grids: SheetGrid[] = [];
  const profiles = input.profiles ?? [];
  if (selection.profiles && profiles.some((p) => text(p.brand) && text(p.flavor))) {
    grids.push(buildProfilesGrid(profiles));
  }
  if (selection.dough && (input.doughRecipes ?? []).length) {
    grids.push(
      buildRecipeGrid("Dough Recipes", "dough", input.doughRecipes, tieRecipes(profiles, "dough")),
    );
  }
  if (selection.sauce && (input.sauceRecipes ?? []).length) {
    grids.push(
      buildRecipeGrid("Sauce Recipes", "sauce", input.sauceRecipes, tieRecipes(profiles, "sauce")),
    );
  }
  if (selection.cheese && (input.cheeseRecipes ?? []).length) {
    grids.push(
      buildRecipeGrid("Cheese Recipes", "cheese", input.cheeseRecipes, tieRecipes(profiles, "cheese")),
    );
  }
  return dedupeSheetNames(grids);
}

// ── Mixes workbook (premix format) ───────────────────────────────────────────

/**
 * Build the mixes export workbook — one tab per mix in the DETERMINISTIC premix
 * layout so "Import Premix Sheet" re-reads it exactly:
 *   A1: <mix name>                       (name, ≤4 rows above the header)
 *   A2: Pull N Days Early                (only when daysEarly > 0)
 *   A3: Ingredient | B3: Per Pizza | C3: Per Batch   (the "Per Pizza" anchor)
 *   A4…: <ingredient> | <perPizza> |     (Per Batch left blank; import uses perPizza)
 *   A_n: Total | (blank) | <batchSize>   (the block Total → batchSize)
 * The tab name is the product ("Brand Flavor") so the importer's deterministic
 * name→brand/flavor grounding recovers the same product, and the block name is
 * the mix's own name so the deterministic id (and thus update-not-duplicate)
 * stays stable on re-import. Pure. Disabled/empty mixes are still exported.
 */
export function buildMixExportGrids(mixes: ReadonlyArray<Mix>): SheetGrid[] {
  const grids: SheetGrid[] = [];
  for (const m of mixes) {
    const name = text(m.name);
    const components = (m.components ?? []).filter((c) => text(c.ingredient));
    if (!name && components.length === 0) continue;
    const rows: string[][] = [];
    rows.push([name || `${text(m.brand)} ${text(m.flavor)}`.trim()]);
    if (m.daysEarly && m.daysEarly > 0) {
      rows.push([`Pull ${m.daysEarly} Days Early`]);
    }
    rows.push(["Ingredient", "Per Pizza", "Per Batch"]);
    for (const c of components) {
      rows.push([text(c.ingredient), num(c.perPizza), ""]);
    }
    rows.push(["Total", "", num(m.batchSize)]);
    // Tab name = the product so the importer grounds brand/flavor back; fall
    // back to the mix name when the product is blank.
    const tab = `${text(m.brand)} ${text(m.flavor)}`.trim() || name || "Mix";
    grids.push({ name: tab, rows });
  }
  return dedupeSheetNames(grids);
}
