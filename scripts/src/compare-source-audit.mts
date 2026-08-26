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

const ROOT = path.resolve(process.cwd(), "..");
const SOURCE_ROOT = path.join(ROOT, "attached_assets/source-library");
const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
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
  const findings = {
    cheeseMissingFromLive: setDiff(sourceCheese.map((r) => r.name), liveNames.cheese),
    cheeseLiveOnly: setDiff(liveNames.cheese, sourceCheese.map((r) => r.name)),
    cheeseComponentDiffs: recipeComponentDiff(sourceCheese, live.cheese_recipes.rows, "lbs"),
    premixLiveOnly: setDiff(liveNames.mixes, sourcePremix.map((r) => r.name)),
    premixComponentDiffs: recipeComponentDiff(sourcePremix, live.mixes.rows, "perPizza"),
    shippingUnmatched: shipping.filter((c) => !c.brand).map((c) => c.guideName),
    shippingUnmapped: shipping.filter((c) => c.unmapped.length).map((c) => ({ brand: c.brand ?? c.guideName, fields: c.unmapped })),
    // Dough and sauce workbooks do not have a shared deterministic parser in
    // this package. Their retained file counts and live row counts are still
    // recorded above; avoid presenting filename heuristics as recipe findings.
    doughWorkbookCount: byKind("dough").length,
    sauceWorkbookCount: byKind("sauce").length,
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
    findings,
    rerun: "From repository root: pnpm --filter @workspace/scripts run audit:source-compare -- --snapshot attached_assets/source-library/audits/production-snapshot-2026-08-26.json --out attached_assets/source-library/audits/source-comparison-2026-08-26.json",
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "w" });
  console.log(`Wrote ${path.relative(ROOT, outPath)}`);
  console.log(JSON.stringify({ workbookCounts, findings: Object.fromEntries(Object.entries(findings).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0])) }, null, 2));
}

main();