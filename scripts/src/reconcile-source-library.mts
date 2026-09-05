/**
 * Read-only, bounded reconciliation of the approved workbook manifest against
 * a retained production snapshot. It produces proposals only; it has no DB
 * imports and never writes outside the requested audit artifacts.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";
import { parseCheeseWorkbook, type CheeseSheetGrid } from "@workspace/cheese-import";
import { parsePremixWorkbook, premixToMix, type SheetGrid } from "@workspace/premix-import";
import { parseDoughWorkbook, parseSauceWorkbook } from "./compare-source-audit.mts";
import { buildSourceLibraryManifest, type SourceLibraryManifest } from "./source-library-manifest.mts";

const ROOT = path.resolve(process.cwd(), "..");
const SOURCE_ROOT = path.join(ROOT, "attached_assets/source-library");
const sha = (value: Buffer | string) => crypto.createHash("sha256").update(value).digest("hex");
const key = (value: unknown) => String(value ?? "").toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9]+/g, " ").trim();
const slash = (value: string) => value.split(path.sep).join("/");
type Component = { ingredient: string; amount: number };
type Formula = {
  kind: "dough" | "sauce" | "cheese" | "premix"; name: string; sourceFile: string;
  components: Component[]; ownedAfter: Record<string, unknown>;
};
type Snapshot = { capturedAt: string; tables: Record<string, { rows: Record<string, any>[] }> };
export type ReconciliationReport = {
  format: "source-library-reconciliation"; formatVersion: 1; snapshot: { path: string; sha256: string; capturedAt: string };
  manifest: { path: string; sha256: string; retained: number; excludedOlderDuplicates: number };
  findings: Record<string, unknown>; proposals: Array<Record<string, unknown>>;
  safeguards: string[];
};

function grids(file: string): SheetGrid[] {
  const book = XLSX.read(fs.readFileSync(file), { cellDates: false });
  return book.SheetNames.map((name) => ({ name, rows: XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, defval: "" }) as string[][] }));
}
function sourceFormulas(manifest: SourceLibraryManifest): Formula[] {
  const output: Formula[] = [];
  for (const file of manifest.retained) {
    const full = path.join(SOURCE_ROOT, file.path);
    if (file.path.startsWith("dough/")) {
      const r = parseDoughWorkbook(full);
      const primary = r.doughballVariants[0];
      output.push({
        kind: "dough", name: r.name, sourceFile: file.path,
        components: r.components.map((c) => ({ ingredient: c.ingredient, amount: c.lbs })),
        ownedAfter: {
          components: r.components, doughballVariants: r.doughballVariants,
          ...(primary ? { doughballWeightOz: primary.weightOz, ...(primary.perTray ? { doughballsPerTray: primary.perTray } : {}) } : {}),
        },
      });
    } else if (file.path.startsWith("sauce/")) {
      const r = parseSauceWorkbook(full);
      output.push({ kind: "sauce", name: r.name, sourceFile: file.path, components: r.components.map((c) => ({ ingredient: c.ingredient, amount: c.lbs })), ownedAfter: { components: r.components } });
    } else if (file.path.startsWith("cheese/")) {
      for (const r of parseCheeseWorkbook(grids(full) as CheeseSheetGrid[]).recipes) output.push({
        kind: "cheese", name: r.name, sourceFile: file.path, components: r.components.map((c: any) => ({ ingredient: c.ingredient, amount: Number(c.lbs ?? 0) })),
        ownedAfter: { components: r.components, brand: r.brand, flavors: r.flavors, shredderSetting: r.shredderSetting, cellulose: r.cellulose, notes: r.notes },
      });
    } else if (file.path.startsWith("premix/")) {
      for (const parsed of parsePremixWorkbook(grids(full))) {
        const r: any = premixToMix(parsed); if (r) output.push({
          kind: "premix", name: r.name, sourceFile: file.path, components: r.components.map((c: any) => ({ ingredient: c.ingredient, amount: Number(c.perPizza ?? 0) })),
          ownedAfter: { components: r.components, brand: r.brand, flavor: r.flavor, daysEarly: r.daysEarly, batchSize: r.batchSize, ...(parsed.notes !== undefined ? { notes: parsed.notes } : {}) },
        });
      }
    }
  }
  return output.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name) || a.sourceFile.localeCompare(b.sourceFile));
}
const tableFor = (kind: Formula["kind"]) => ({ dough: "dough_recipes", sauce: "sauce_recipes", cheese: "cheese_recipes", premix: "mixes" })[kind];
const amountFor = (kind: Formula["kind"]) => kind === "premix" ? "perPizza" : "lbs";
function components(row: any, kind: Formula["kind"]): Component[] {
  return (Array.isArray(row.components) ? row.components : []).map((c: any) => ({ ingredient: String(c.ingredient ?? ""), amount: Number(c[amountFor(kind)] ?? 0) }));
}
function componentDiff(expected: Component[], actual: Component[]) {
  const expectedBy = new Map<string, Component[]>, actualBy = new Map<string, Component[]>;
  for (const c of expected) expectedBy.set(key(c.ingredient), [...(expectedBy.get(key(c.ingredient)) ?? []), c]);
  for (const c of actual) actualBy.set(key(c.ingredient), [...(actualBy.get(key(c.ingredient)) ?? []), c]);
  const missing: Component[] = [], extra: Component[] = [], wrongQuantities: Array<{ ingredient: string; before: number; after: number }> = [];
  for (const [k, values] of expectedBy) {
    const live = actualBy.get(k) ?? [];
    if (values.length !== 1 || live.length !== 1) { if (!live.length) missing.push(...values); continue; }
    if (Math.abs(values[0]!.amount - live[0]!.amount) > .005) wrongQuantities.push({ ingredient: values[0]!.ingredient, before: live[0]!.amount, after: values[0]!.amount });
  }
  for (const [k, values] of actualBy) if (!expectedBy.has(k)) extra.push(...values);
  const duplicateComponents = [...expectedBy, ...actualBy].flatMap(([ingredient, values]) => values.length > 1 ? [{ ingredient, count: values.length }] : []);
  return { missing, extra, wrongQuantities, duplicateComponents };
}
function zeroStub(row: any, kind: Formula["kind"]) {
  const values = components(row, kind); return values.length > 0 && values.every((c) => c.amount === 0);
}
function componentIdentitySignature(row: any): string {
  // Stub rows intentionally have zero pounds, so compare the workbook-owned
  // ingredient identity only. Cellulose is a workbook summary/addition and is
  // absent from the historical spec-import stubs.
  return (Array.isArray(row.components) ? row.components : [])
    .map((component: any) => key(component.ingredient).split(" ").sort().join(" "))
    .filter((ingredient: string) => ingredient && ingredient !== "cellulose")
    .sort().join("|");
}
function canonicalStubMatch(stub: any, rows: any[]) {
  if (key(stub.brand) !== "basha s ultra thin crust") return undefined;
  const stubName = key(stub.name);
  const stubBrand = key(stub.brand);
  // Spec-import prefixed the source brand before the already customer-prefixed
  // workbook recipe name; the populated import owns the latter name.
  const canonicalName = stubName.startsWith(`${stubBrand} `)
    ? stubName.slice(stubBrand.length).trim()
    : "";
  const signature = componentIdentitySignature(stub);
  const matches = rows.filter((candidate) =>
    candidate.id !== stub.id &&
    !zeroStub(candidate, "cheese") &&
    key(candidate.brand) === "basha s ultra thin" &&
    key(candidate.name) === canonicalName &&
    componentIdentitySignature(candidate) === signature,
  );
  // Do not guess: an absent or non-unique candidate is not a canonical link.
  if (matches.length !== 1) return undefined;
  return { canonicalId: matches[0]!.id, canonicalName: matches[0]!.name };
}
export function reconcileSnapshot(snapshot: Snapshot, manifest: SourceLibraryManifest): ReconciliationReport {
  const formulas = sourceFormulas(manifest);
  const findings: Record<string, any[]> = { wrongQuantities: [], missingComponents: [], extraComponents: [], duplicateComponents: [], wrongNamesOrLinks: [], allZeroStubs: [], unmatchedSourceRecipes: [], unmatchedLiveRecipes: [], duplicateRecipes: [] };
  const proposals: Array<Record<string, unknown>> = [];
  for (const formula of formulas) {
    const table = tableFor(formula.kind), rows = snapshot.tables[table]?.rows ?? [];
    const exact = rows.filter((row) => key(row.name) === key(formula.name));
    if (exact.length !== 1) {
      if (exact.length > 1) findings.duplicateRecipes.push({ table, name: formula.name, ids: exact.map((r) => r.id).sort() });
      const formulaSignature = JSON.stringify(formula.components.map((c) => [key(c.ingredient), c.amount]).sort());
      const equivalents = rows.filter((row) => JSON.stringify(components(row, formula.kind).map((c) => [key(c.ingredient), c.amount]).sort()) === formulaSignature);
      if (equivalents.length === 1) {
        findings.wrongNamesOrLinks.push({ table, sourceName: formula.name, sourceFile: formula.sourceFile, liveId: equivalents[0]!.id, liveName: equivalents[0]!.name });
        proposals.push({ classification: "automatic", action: "link-source-identity", table, sourceFile: formula.sourceFile, before: { id: equivalents[0]!.id, name: equivalents[0]!.name }, after: { sourceName: formula.name }, note: "Link only; retain the existing row name, history, and references." });
      } else findings.unmatchedSourceRecipes.push({ table, name: formula.name, sourceFile: formula.sourceFile, candidateIds: equivalents.map((r) => r.id).sort() });
      continue;
    }
    const live = exact[0]!, diff = componentDiff(formula.components, components(live, formula.kind));
    for (const [label, entries] of Object.entries({ wrongQuantities: diff.wrongQuantities, missingComponents: diff.missing, extraComponents: diff.extra, duplicateComponents: diff.duplicateComponents })) if (entries.length) findings[label].push({ table, id: live.id, name: live.name, sourceFile: formula.sourceFile, entries });
    if (zeroStub(live, formula.kind)) findings.allZeroStubs.push({ table, id: live.id, name: live.name });
    if (diff.missing.length || diff.extra.length || diff.wrongQuantities.length || diff.duplicateComponents.length) {
      const ambiguous = diff.duplicateComponents.length > 0;
      proposals.push({ classification: ambiguous ? "ambiguous" : "automatic", action: "replace-components-from-approved-source", table, sourceFile: formula.sourceFile, before: { id: live.id, name: live.name, components: components(live, formula.kind) }, after: { id: live.id, name: live.name, ...formula.ownedAfter }, note: ambiguous ? "Duplicate component evidence requires manager choice; preserve row history and references." : "Update this row in place; preserve its id, history, and references." });
    }
  }
  for (const kind of ["dough", "sauce", "cheese", "premix"] as const) {
    const table = tableFor(kind), sourceNames = new Set(formulas.filter((f) => f.kind === kind).map((f) => key(f.name)));
    for (const row of snapshot.tables[table]?.rows ?? []) {
      if (!sourceNames.has(key(row.name))) findings.unmatchedLiveRecipes.push({ table, id: row.id, name: row.name });
      // Stubs matter even when their authoritative workbook is absent; they
      // are exactly the rows a later import might otherwise silently retain.
      if (zeroStub(row, kind) && !findings.allZeroStubs.some((entry) => entry.table === table && entry.id === row.id)) {
        findings.allZeroStubs.push({ table, id: row.id, name: row.name });
      }
    }
    const byName = new Map<string, any[]>();
    for (const row of snapshot.tables[table]?.rows ?? []) byName.set(key(row.name), [...(byName.get(key(row.name)) ?? []), row]);
    for (const [name, rows] of byName) if (rows.length > 1) findings.duplicateRecipes.push({ table, name, ids: rows.map((r) => r.id).sort() });
  }
  const cheeseRows = snapshot.tables.cheese_recipes?.rows ?? [];
  findings.allZeroStubs = findings.allZeroStubs.map((stub) => {
    const row = (snapshot.tables[stub.table]?.rows ?? []).find((candidate) => candidate.id === stub.id);
    const canonical = stub.table === "cheese_recipes" && row ? canonicalStubMatch(row, cheeseRows) : undefined;
    return {
      ...stub,
      ...(canonical ?? {}),
      deletionCandidate: "blocked-until-reference-repoint-and-history-preservation-checks",
    };
  });
  for (const entries of Object.values(findings)) entries.sort((a: any, b: any) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  proposals.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { format: "source-library-reconciliation", formatVersion: 1, snapshot: { path: "", sha256: "", capturedAt: snapshot.capturedAt }, manifest: { path: "", sha256: manifest.sha256, retained: manifest.retained.length, excludedOlderDuplicates: manifest.excludedOlderDuplicates.length }, findings, proposals, safeguards: ["Read-only: this report does not connect to or mutate production.", "No delete proposal is emitted; unmatched and duplicate rows require review.", "Apply any approved proposal in place to preserve row IDs, import history, and references."] };
}
function markdown(report: ReconciliationReport) {
  const lines = ["# Source-library reconciliation", "", `Snapshot captured: ${report.snapshot.capturedAt}`, `Manifest: ${report.manifest.sha256}`, "", "## Findings", ""];
  for (const [kind, entries] of Object.entries(report.findings)) lines.push(`- ${kind}: ${(entries as unknown[]).length}`);
  lines.push("", "## Proposals", "", `- automatic: ${report.proposals.filter((p) => p.classification === "automatic").length}`, `- ambiguous: ${report.proposals.filter((p) => p.classification === "ambiguous").length}`, "", "All proposals are bounded before→after records. They preserve IDs, history, and references; none authorizes deletion or writes to production.", "All-zero stubs remain deletion candidates only after reference repoint and history-preservation checks.");
  return `${lines.join("\n")}\n`;
}
function main() {
  const value = (name: string, fallback: string) => { const i = process.argv.indexOf(name); return path.resolve(ROOT, i < 0 ? fallback : process.argv[i + 1]!); };
  const snapshotPath = value("--snapshot", "attached_assets/source-library/audits/production-snapshot-2026-08-26.json");
  const manifestPath = value("--manifest", "attached_assets/source-library/audits/source-library-manifest-2026-08-26.json");
  const out = value("--out", "attached_assets/source-library/audits/source-library-reconciliation-2026-08-26.json");
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) as SourceLibraryManifest : buildSourceLibraryManifest();
  const report = reconcileSnapshot(JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as Snapshot, manifest);
  report.snapshot = { path: slash(path.relative(ROOT, snapshotPath)), sha256: sha(fs.readFileSync(snapshotPath)), capturedAt: report.snapshot.capturedAt };
  report.manifest.path = slash(path.relative(ROOT, manifestPath)); report.manifest.sha256 = sha(fs.readFileSync(manifestPath));
  fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(out.replace(/\.json$/u, ".md"), markdown(report)); console.log(`Wrote ${slash(path.relative(ROOT, out))}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();