/**
 * Compare a retained production snapshot with the retained source-library
 * workbooks. This is intentionally read-only and file-based: it never needs a
 * database connection and can be rerun from the committed snapshot + corpus.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run audit:source-compare -- \
 *     --snapshot attached_assets/source-library/audits/production-snapshot-2026-08-26.json \
 *     --out attached_assets/source-library/audits/source-comparison-2026-08-26.json
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";
import {
  parseCheeseWorkbook,
  type CheeseSheetGrid,
} from "@workspace/cheese-import";
import {
  parsePremixWorkbook,
  premixToMix,
  type SheetGrid,
} from "@workspace/premix-import";
import {
  buildShippingCandidates,
  parseShippingGuide,
} from "@workspace/shipping-import";

type Snapshot = {
  format: string;
  formatVersion: number;
  capturedAt: string;
  sourceLibrary: { root: string; manifest: { files: Array<{ path: string; bytes: number; sha256: string }>; sha256: string } };
  comparisonScope: { tables: string[] };
  tables: Record<string, { rowCount: number; rows: Record<string, any>[] }>;
};

type WorkbookRow = unknown[];
export type FormulaComponent = { ingredient: string; lbs: number };
export type DoughballVariant = { label: string; weightOz: number; perTray?: number };
export type ParsedDough = {
  sourceFile: string;
  name: string;
  components: FormulaComponent[];
  doughballVariants: DoughballVariant[];
};
export type ParsedSauce = {
  sourceFile: string;
  name: string;
  components: FormulaComponent[];
};

const ROOT = path.resolve(process.cwd(), "..");
const SOURCE_ROOT = path.join(ROOT, "attached_assets/source-library");
const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const comparisonKey = (s: unknown) =>
  norm(s)
    .replace(/[“”]/g, '"')
    .replace(/[’‘]/g, "'")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

function filesUnder(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "audits" ? [] : filesUnder(full);
    return entry.isFile() ? [full] : [];
  }).sort();
}

function grids(file: string): SheetGrid[] {
  const workbook = XLSX.read(fs.readFileSync(file), { cellDates: false });
  return workbook.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: "" }) as string[][],
  }));
}

function workbookRows(file: string): WorkbookRow[] {
  return grids(file).flatMap((grid) => grid.rows as unknown as WorkbookRow[]);
}

function cellText(value: unknown): string {
  return String(value ?? "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function cellNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = cellText(value);
  const match = text.match(/^(-?(?:\d+\.?\d*|\.\d+))(?:\s|$|\()/);
  if (!match) return undefined;
  const result = Number(match[1]);
  return Number.isFinite(result) ? result : undefined;
}

function numericColumns(row: WorkbookRow): number[] {
  return row.flatMap((value, index) => cellNumber(value) === undefined ? [] : [index]);
}

function firstTextBeforeNumber(row: WorkbookRow): { text: string; numberIndex: number } | null {
  const numberIndex = numericColumns(row)[0];
  if (numberIndex === undefined) return null;
  for (let index = 0; index < numberIndex; index++) {
    const text = cellText(row[index]);
    if (text) return { text, numberIndex };
  }
  return null;
}

function totalRow(row: WorkbookRow): boolean {
  return row.some((value) => /^total(?:\s+weight)?$/i.test(cellText(value)));
}

function retainedDoughName(file: string): string {
  const namesByFile: Record<string, string> = {
    "Aldo's_Dough_Mixing_Procedure_-_09_1784339683714.xlsx": "Aldo's Dough",
    "Brand_Dough_Mixing_Procedure_-_08_1784339683868.xlsx": "Brand Dough",
    "CRB_Dough_Mixing_Procedure_-_39_1784339683921.xlsx": "CRB Dough",
    "Lowe's_French_Fry_Dough_Mixing_Procedure_-_03_1784339683985.xlsx": "Lowe's French Fry Dough",
    "Lucia's_French_Fry_Dough_Mixing_Procedure_-_06_1784339684078.xlsx": "Lucia's French Fry Dough",
    "Malted_Barley_Dough_Mixing_Procedure_-_29_1784339684152.xlsx": "Malted Barley Dough",
    "Margherita_Dough_Mixing_Procedure_-_05_1784339684241.xlsx": "Margherita Dough",
    "Masa_Dough,_Natural,_(Lowe's)_Mixing_Procedure_-_04_1784339684386.xlsx": "Masa Dough - Natural",
    "Masa_Dough_Mixing_Procedure_-_12_1784339684313.xlsx": "Masa Dough",
    "Microwavable_Lucia's_Dough_Mixing_Procedure_-_04_1784339684454.xlsx": "Microwavable Lucia's Dough",
    "Modified_Malted_Barley_Dough_Mixing_Procedure_-_07_1784339684515.xlsx": "MODIFIED - MALTED BARLEY DOUGH",
    "Naan_Dough_Mixing_Procedure_-_12_1784339684591.xlsx": "Naan Dough",
    "Sriracha_Dough_Mixing_Procedure_-_01_1784339684659.xlsx": "Sriracha DOUGH",
  };
  const name = namesByFile[path.basename(file)];
  if (!name) throw new Error(`No retained dough-name mapping for ${path.basename(file)}`);
  return name;
}

function retainedSauceName(file: string): string {
  const namesByFile: Record<string, string> = {
    "Aldo_Pizza_Sauce_02_1784339518984.xlsx": "Aldo's Pizza Sauce",
    "Alfredo_Pizza_Sauce_07_1784339519130.xlsx": "Alfredo Sauce",
    "Asiago_Sauce_02_1784339519196.xlsx": "Asiago Sauce",
    "Bobo's_Buffalo_Pizza_Sauce_-_01_1784339519274.xlsx": "Bobo's Buffalo Pizza Sauce",
    "Bobo's_Pizza_Sauce_01_1784339519352.xlsx": "Bobo's Pizza Sauce",
    "Brand_Marriott_Pizza_Sauce_03_1784339519433.xlsx": "BRAND CONCESSIONS MARRIOTT SAUCE",
    "Four_Hands_Red_Hot_Pizza_Sauce_-_03_1784339519513.xlsx": "Red Hot Pizza Sauce",
    "Garlic_Alfredo_Pizza_Sauce_02_1784339519592.xlsx": "Garlic Alfredo Sauce",
    "Gravy_Sauce_-_05_1784339519678.xlsx": "Gravy Sauce",
    "Lucia_Pizza_Sauce_06_1784339519754.xlsx": "Lucia’s Sauce",
    "Medulla's_TOI_Pizza_Sauce_03_1784339519838.xlsx": "Medulla Toi Pizza Sauce",
    "Mystic_Pizza_Sauce_05_1784339519919.xlsx": "Mystic Pizza Sauce",
    "Sweet_Chili_Sauce_02_1784339520083.xlsx": "Sweet Chili Sauce",
    "Sweet_and_Sour_Sauce_02_1784339519999.xlsx": "Legacy Sweet & Sour sauce",
    "Tikka_Masala_Process_1784339520201.xlsx": "Tika Masala Sauce",
  };
  const name = namesByFile[path.basename(file)];
  if (!name) throw new Error(`No retained sauce-name mapping for ${path.basename(file)}`);
  return name;
}

function instructionAmount(rows: WorkbookRow[], ingredient: string): number | undefined {
  // A pair of French-fry workbooks lists the component in the materials table
  // but puts its weight only in the numbered procedure ("ADD 18 LB ...").
  const ingredientKey = comparisonKey(ingredient).replace(/^25029\s+/, "");
  if (!ingredientKey) return undefined;
  for (const row of rows) {
    const text = cellText(row.filter((value) => typeof value === "string").join(" "));
    if (!text || !comparisonKey(text).includes(ingredientKey)) continue;
    const amount = text.match(/(\d+(?:\.\d+)?)\s*(?:lb|lbs|pound|pounds)\b/i);
    if (amount) return Number(amount[1]);
  }
  return undefined;
}

export function parseDoughRows(rows: WorkbookRow[], file: string): ParsedDough {
  const formulaHeaderIndex = rows.findIndex((row) =>
    row.some((value) => /^lbs?\.?$/i.test(cellText(value))),
  );
  if (formulaHeaderIndex < 0) {
    throw new Error(`Dough workbook has no LBS formula header: ${path.basename(file)}`);
  }
  const header = rows[formulaHeaderIndex]!;
  const preferredColumn = header.findIndex((value) => /^4\s*bag$/i.test(cellText(value)));
  const components: FormulaComponent[] = [];
  for (let index = formulaHeaderIndex + 1; index < rows.length; index++) {
    const row = rows[index]!;
    if (totalRow(row)) break;
    const candidate = firstTextBeforeNumber(row);
    const ingredient = candidate?.text ?? row.map(cellText).find(Boolean) ?? "";
    if (!ingredient || /^(?:lbs?|oz|yield|per\s+tray)$/i.test(ingredient)) continue;
    if (/^(?:all ingredients|scale must|acceptable range|\*|\d+\.)/i.test(ingredient)) continue;

    let amount: number | undefined;
    if (preferredColumn >= 0) amount = cellNumber(row[preferredColumn]);
    if (amount === undefined && candidate) {
      amount = cellNumber(row.slice(candidate.numberIndex)[0]);
    }
    if (amount === undefined) amount = instructionAmount(rows.slice(index + 1), ingredient);
    if (amount === undefined) {
      // Only formula rows reach this point: the parser has already bounded the
      // scan to the LBS table and stops at TOTAL. Refuse to guess if a retained
      // revision introduces a new table shape.
      throw new Error(`Unable to parse dough amount for "${ingredient}" in ${path.basename(file)}`);
    }
    components.push({ ingredient, lbs: amount });
  }
  if (components.length === 0) {
    throw new Error(`Dough workbook has no formula components: ${path.basename(file)}`);
  }

  const variantHeaderIndex = rows.findIndex((row) => {
    const oz = row.findIndex((value) => /^oz\.?$/i.test(cellText(value)));
    const tray = row.findIndex((value) => /\btray\b/i.test(cellText(value)));
    return oz >= 0 && tray > oz;
  });
  const doughballVariants: DoughballVariant[] = [];
  if (variantHeaderIndex >= 0) {
    const variantHeader = rows[variantHeaderIndex]!;
    const ozColumn = variantHeader.findIndex((value) => /^oz\.?$/i.test(cellText(value)));
    const trayColumn = variantHeader.findIndex((value) => /\btray\b/i.test(cellText(value)));
    for (let index = variantHeaderIndex + 1; index < rows.length; index++) {
      const row = rows[index]!;
      const weightOz = cellNumber(row[ozColumn]);
      if (weightOz === undefined || !(weightOz > 0)) continue;
      let label = "";
      for (let labelIndex = ozColumn - 1; labelIndex >= 0; labelIndex--) {
        label = cellText(row[labelIndex]);
        if (label) break;
      }
      if (!label) continue;
      const perTray = cellNumber(row[trayColumn]);
      doughballVariants.push({
        label,
        weightOz,
        ...(perTray !== undefined && perTray > 0 ? { perTray } : {}),
      });
    }
  }
  return {
    sourceFile: path.relative(SOURCE_ROOT, file).split(path.sep).join("/"),
    name: retainedDoughName(file),
    components,
    doughballVariants,
  };
}

export function parseDoughWorkbook(file: string): ParsedDough {
  return parseDoughRows(workbookRows(file), file);
}

export function parseSauceRows(rows: WorkbookRow[], file: string): ParsedSauce {
  if (path.basename(file) === "Four_Hands_Red_Hot_Pizza_Sauce_-_03_1784339519513.xlsx") {
    const components: FormulaComponent[] = [];
    for (const row of rows) {
      if (row.some((value) => /all ingredients are to be weighed/i.test(cellText(value)))) break;
      const amountColumn = numericColumns(row).find((column) => column >= 5);
      if (amountColumn === undefined) continue;
      const ingredient = cellText(row[amountColumn - 1]);
      const amount = cellNumber(row[amountColumn]);
      if (!ingredient || amount === undefined) continue;
      components.push({ ingredient, lbs: amount });
    }
    if (components.length === 0) {
      throw new Error(`Sauce workbook has no tested formula table: ${path.basename(file)}`);
    }
    return {
      sourceFile: path.relative(SOURCE_ROOT, file).split(path.sep).join("/"),
      name: retainedSauceName(file),
      components,
    };
  }
  const ingredientsMarkerIndex = rows.findIndex((row) =>
    row.some((value) => /^(?:ingredients:?)$/i.test(cellText(value))),
  );
  const formulaHeaderIndex = ingredientsMarkerIndex >= 0
    ? ingredientsMarkerIndex
    : rows.findIndex((row) => row.some((value) =>
      /^lbs?\.?$/i.test(cellText(value)) || /^(?:drum|single)\s+batch$/i.test(cellText(value)),
    ));
  if (formulaHeaderIndex < 0) {
    throw new Error(`Sauce workbook has no formula header: ${path.basename(file)}`);
  }

  const components: FormulaComponent[] = [];
  for (let index = formulaHeaderIndex + 1; index < rows.length; index++) {
    const row = rows[index]!;
    if (totalRow(row) || row.some((value) => /^process$/i.test(cellText(value)))) break;
    const firstText = row.map(cellText).find(Boolean) ?? "";
    if (!firstText || /^(?:lbs?|full batch|half batch|single batch)$/i.test(firstText)) continue;
    if (cellNumber(firstText) !== undefined) continue;
    const numeric = numericColumns(row);
    if (numeric.length === 0) {
      throw new Error(`Unable to parse sauce amount for "${firstText}" in ${path.basename(file)}`);
    }
    const textColumns = row
      .map((value, column) => ({ text: cellText(value), column }))
      .filter(({ text }) => text);
    const firstTextColumn = textColumns[0]?.column ?? 0;
    const repeatedTextColumn = textColumns.find(
      ({ text, column }) => column > firstTextColumn && comparisonKey(text) === comparisonKey(firstText),
    )?.column;
    // Tika Masala has a six-batch calculation table. Its per-batch amount is
    // the last numeric cell before the repeated ingredient name; all other
    // retained sauce sheets use their first numeric cell (full/single batch).
    const amountColumn = repeatedTextColumn === undefined
      ? numeric[0]!
      : [...numeric].reverse().find((column) => column < repeatedTextColumn) ?? numeric[0]!;
    const amount = cellNumber(row[amountColumn]);
    if (amount === undefined) continue;
    components.push({ ingredient: firstText, lbs: amount });
  }
  if (components.length === 0) {
    throw new Error(`Sauce workbook has no formula components: ${path.basename(file)}`);
  }
  return {
    sourceFile: path.relative(SOURCE_ROOT, file).split(path.sep).join("/"),
    name: retainedSauceName(file),
    components,
  };
}

export function parseSauceWorkbook(file: string): ParsedSauce {
  return parseSauceRows(workbookRows(file), file);
}

function names(rows: Record<string, any>[]): string[] {
  return rows.map((row) => String(row.name ?? "").trim()).filter(Boolean);
}

function setDiff(a: string[], b: string[]) {
  const bs = new Set(b.map(norm));
  const seen = new Set<string>();
  return a.filter((x) => {
    const key = norm(x);
    if (bs.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sourceManifest(expected?: Array<{ path: string }>) {
  const expectedPaths = expected ? new Set(expected.map((file) => file.path)) : undefined;
  return filesUnder(SOURCE_ROOT).filter((full) => {
    const relative = path.relative(SOURCE_ROOT, full).split(path.sep).join("/");
    return !expectedPaths || expectedPaths.has(relative);
  }).map((full) => {
    const bytes = fs.readFileSync(full);
    return { path: path.relative(SOURCE_ROOT, full).split(path.sep).join("/"), bytes: bytes.length, sha256: sha(bytes) };
  });
}

function recipeComponentDiff(
  source: Array<{ name: string; components: Array<{ ingredient: string; lbs?: number; perPizza?: number }> }>,
  live: Record<string, any>[],
  amount: "lbs" | "perPizza",
) {
  const liveByName = new Map(live.map((r) => [norm(r.name), r]));
  const diffs: Array<{ name: string; missing: string[]; changed: string[] }> = [];
  for (const recipe of source) {
    const current = liveByName.get(norm(recipe.name));
    if (!current) continue;
    const actual = new Map((current.components ?? []).map((c: any) => [norm(c.ingredient), Number(c[amount] ?? 0)]));
    const missing: string[] = [];
    const changed: string[] = [];
    for (const component of recipe.components) {
      const expected = Number(component[amount] ?? 0);
      const got = actual.get(norm(component.ingredient));
      if (got === undefined) missing.push(`${component.ingredient}=${expected}`);
      else if (typeof got === "number" && Math.abs(got - expected) > 0.005) changed.push(`${component.ingredient}: source ${expected}, live ${got}`);
    }
    if (missing.length || changed.length) diffs.push({ name: recipe.name, missing, changed });
  }
  return diffs;
}

function componentMap(components: Array<{ ingredient: string; lbs?: number }>): Map<string, number> {
  const result = new Map<string, number>();
  for (const component of components) {
    const key = comparisonKey(component.ingredient);
    if (!key) continue;
    result.set(key, (result.get(key) ?? 0) + Number(component.lbs ?? 0));
  }
  return result;
}

function compareFormulaComponents(
  source: Array<{ name: string; sourceFile: string; components: FormulaComponent[] }>,
  live: Record<string, any>[],
) {
  const liveByName = new Map(live.map((row) => [comparisonKey(row.name), row]));
  const sourceMissingFromLive: Array<{ name: string; sourceFile: string }> = [];
  const liveOnly = new Set(live.map((row) => String(row.name ?? "").trim()).filter(Boolean));
  const componentDiffs: Array<{
    name: string;
    sourceFile: string;
    missing: string[];
    changed: string[];
    liveOnly: string[];
  }> = [];

  for (const recipe of source) {
    const current = liveByName.get(comparisonKey(recipe.name));
    if (!current) {
      sourceMissingFromLive.push({ name: recipe.name, sourceFile: recipe.sourceFile });
      continue;
    }
    liveOnly.delete(String(current.name ?? "").trim());
    const expected = componentMap(recipe.components);
    const actual = componentMap(current.components ?? []);
    const missing: string[] = [];
    const changed: string[] = [];
    for (const component of recipe.components) {
      const key = comparisonKey(component.ingredient);
      if (!key || !expected.has(key)) continue;
      const got = actual.get(key);
      const expectedAmount = expected.get(key)!;
      if (got === undefined) {
        missing.push(`${component.ingredient}=${expectedAmount}`);
      } else if (Math.abs(got - expectedAmount) > 0.005) {
        changed.push(`${component.ingredient}: source ${expectedAmount}, live ${got}`);
      }
    }
    const sourceKeys = new Set(expected.keys());
    const extra = [...actual.keys()]
      .filter((key) => !sourceKeys.has(key))
      .map((key) => `${key}=${actual.get(key)}`);
    if (missing.length || changed.length || extra.length) {
      componentDiffs.push({
        name: recipe.name,
        sourceFile: recipe.sourceFile,
        missing,
        changed,
        liveOnly: extra,
      });
    }
  }
  return {
    sourceMissingFromLive,
    liveOnly: [...liveOnly].sort((a, b) => a.localeCompare(b)),
    componentDiffs,
  };
}

function compareDoughballVariants(source: ParsedDough[], live: Record<string, any>[]) {
  const liveByName = new Map(live.map((row) => [comparisonKey(row.name), row]));
  const sourceMissingFromLive: Array<{ name: string; sourceFile: string }> = [];
  const variantDiffs: Array<{
    name: string;
    sourceFile: string;
    missing: string[];
    changed: string[];
    liveOnly: string[];
  }> = [];
  for (const recipe of source) {
    const current = liveByName.get(comparisonKey(recipe.name));
    if (!current) {
      sourceMissingFromLive.push({ name: recipe.name, sourceFile: recipe.sourceFile });
      continue;
    }
    const sourceByLabel = new Map(recipe.doughballVariants.map((variant) => [
      comparisonKey(variant.label),
      variant,
    ]));
    const liveVariants = Array.isArray(current.doughball_variants) ? current.doughball_variants : [];
    const liveByLabel = new Map(liveVariants.map((variant: any) => [
      comparisonKey(variant.label),
      variant,
    ]));
    const missing: string[] = [];
    const changed: string[] = [];
    for (const variant of recipe.doughballVariants) {
      const key = comparisonKey(variant.label);
      const actual = liveByLabel.get(key);
      if (!actual) {
        missing.push(`${variant.label}=${variant.weightOz}oz/${variant.perTray ?? "?"} per tray`);
        continue;
      }
      const actualWeight = Number(actual.weightOz ?? 0);
      const actualPerTray = Number(actual.perTray ?? 0);
      if (Math.abs(actualWeight - variant.weightOz) > 0.005 || (variant.perTray ?? 0) !== actualPerTray) {
        changed.push(
          `${variant.label}: source ${variant.weightOz}oz/${variant.perTray ?? "?"} per tray, ` +
          `live ${actualWeight}oz/${actualPerTray || "?"} per tray`,
        );
      }
    }
    const liveOnly = [...liveByLabel.keys()]
      .filter((key) => !sourceByLabel.has(key))
      .map((key) => {
        const variant = liveByLabel.get(key);
        return `${variant.label}=${variant.weightOz}oz/${variant.perTray ?? "?"} per tray`;
      });
    if (missing.length || changed.length || liveOnly.length) {
      variantDiffs.push({
        name: recipe.name,
        sourceFile: recipe.sourceFile,
        missing,
        changed,
        liveOnly,
      });
    }
  }
  return { sourceMissingFromLive, variantDiffs };
}

function main() {
  const snapshotPath = path.resolve(ROOT, arg("--snapshot") ?? "attached_assets/source-library/audits/production-snapshot-2026-08-26.json");
  const outPath = path.resolve(ROOT, arg("--out") ?? "attached_assets/source-library/audits/source-comparison-2026-08-26.json");
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as Snapshot;
  if (snapshot.format !== "source-audit-production-snapshot" || snapshot.formatVersion !== 1) {
    throw new Error("Unsupported production snapshot format");
  }

  // The snapshot manifest is the immutable input boundary. This prevents a
  // newly written report/comparison file from changing a rerun's source set.
  const sourceFiles = sourceManifest(snapshot.sourceLibrary.manifest.files);
  if (sourceFiles.length !== snapshot.sourceLibrary.manifest.files.length) {
    throw new Error("Retained source inputs are missing; refusing a partial comparison");
  }
  const byKind = (kind: string) => sourceFiles.filter((f) => f.path.startsWith(`${kind}/`) && f.path.endsWith(".xlsx"));
  const live = snapshot.tables;
  const liveNames = {
    cheese: names(live.cheese_recipes.rows),
    dough: names(live.dough_recipes.rows),
    sauce: names(live.sauce_recipes.rows),
    mixes: names(live.mixes.rows),
    brands: [...new Set(live.brand_profiles.rows.map((r) => String(r.brand ?? "").trim()).filter(Boolean))],
  };

  const cheeseFile = byKind("cheese")[0];
  const cheese = parseCheeseWorkbook(grids(path.join(SOURCE_ROOT, cheeseFile.path)) as CheeseSheetGrid[]);
  const premixFile = byKind("premix")[0];
  const premixes = parsePremixWorkbook(grids(path.join(SOURCE_ROOT, premixFile.path)));
  const knownMixes = premixes.map((p) => premixToMix(p)).filter(Boolean) as any[];
  const shippingFile = byKind("shipping")[0];
  const shippingRows = parseShippingGuide(grids(path.join(SOURCE_ROOT, shippingFile.path)));
  const shipping = buildShippingCandidates(shippingRows, liveNames.brands);
  const sourceDough = byKind("dough").map((file) => parseDoughWorkbook(path.join(SOURCE_ROOT, file.path)));
  const sourceSauce = byKind("sauce").map((file) => parseSauceWorkbook(path.join(SOURCE_ROOT, file.path)));

  const workbookCounts = {
    specs: byKind("specs").length,
    dough: byKind("dough").length,
    sauce: byKind("sauce").length,
    cheese: cheese.recipes.length,
    premixBlocks: premixes.length,
    shippingRows: shippingRows.length,
  };
  const sourceCheese = cheese.recipes.map((r) => ({ name: r.name, components: r.components }));
  const sourcePremix = knownMixes.map((r) => ({ name: r.name, components: r.components }));
  const doughFormulaComparison = compareFormulaComponents(sourceDough, live.dough_recipes.rows);
  const sauceFormulaComparison = compareFormulaComponents(sourceSauce, live.sauce_recipes.rows);
  const doughVariantComparison = compareDoughballVariants(sourceDough, live.dough_recipes.rows);
  const findings = {
    cheeseMissingFromLive: setDiff(sourceCheese.map((r) => r.name), liveNames.cheese),
    cheeseLiveOnly: setDiff(liveNames.cheese, sourceCheese.map((r) => r.name)),
    cheeseComponentDiffs: recipeComponentDiff(sourceCheese, live.cheese_recipes.rows, "lbs"),
    premixLiveOnly: setDiff(liveNames.mixes, sourcePremix.map((r) => r.name)),
    premixComponentDiffs: recipeComponentDiff(sourcePremix, live.mixes.rows, "perPizza"),
    shippingUnmatched: shipping.filter((c) => !c.brand).map((c) => c.guideName),
    shippingUnmapped: shipping.filter((c) => c.unmapped.length).map((c) => ({ brand: c.brand ?? c.guideName, fields: c.unmapped })),
    doughMissingFromLive: doughFormulaComparison.sourceMissingFromLive,
    doughLiveOnly: doughFormulaComparison.liveOnly,
    doughComponentDiffs: doughFormulaComparison.componentDiffs,
    doughVariantMissingFromLive: doughVariantComparison.sourceMissingFromLive,
    doughVariantDiffs: doughVariantComparison.variantDiffs,
    sauceMissingFromLive: sauceFormulaComparison.sourceMissingFromLive,
    sauceLiveOnly: sauceFormulaComparison.liveOnly,
    sauceComponentDiffs: sauceFormulaComparison.componentDiffs,
  };

  const result = {
    format: "source-audit-comparison",
    formatVersion: 1,
    comparedAt: new Date().toISOString(),
    inputs: {
      snapshot: { path: path.relative(ROOT, snapshotPath), sha256: sha(fs.readFileSync(snapshotPath)), capturedAt: snapshot.capturedAt },
      sourceLibrary: { root: "attached_assets/source-library", manifestSha256: sha(Buffer.from(JSON.stringify(sourceFiles))), files: sourceFiles },
    },
    liveRowCounts: Object.fromEntries(Object.entries(live).map(([k, v]) => [k, v.rowCount])),
    workbookCounts,
    parsedFormulas: {
      dough: sourceDough,
      sauce: sourceSauce,
    },
    findings,
    rerun: "From repository root: pnpm --filter @workspace/scripts run audit:source-compare -- --snapshot attached_assets/source-library/audits/production-snapshot-2026-08-26.json --out attached_assets/source-library/audits/source-comparison-2026-08-26.json",
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "w" });
  console.log(`Wrote ${path.relative(ROOT, outPath)}`);
  console.log(JSON.stringify({ workbookCounts, findings: Object.fromEntries(Object.entries(findings).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0])) }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
