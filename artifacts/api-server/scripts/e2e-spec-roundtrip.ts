// Manual e2e harness: confirm exported spec sheets re-import through the AI
// "Import Spec Sheet" pipeline with NO data loss (export → xlsx → flatten →
// real AI parse → sanitize → strict diff vs the originals).
//
// NOT part of CI/vitest (it makes a real, non-deterministic AI call). Re-run it
// whenever the export layout (lib/spec-export), the parse prompt
// (src/routes/aiParseSpecSheet.ts), or the importer sanitizer (lib/spec-import)
// changes:
//
//   cd artifacts/api-server
//   ./node_modules/.bin/esbuild scripts/e2e-spec-roundtrip.ts --bundle \
//     --format=esm --platform=node --outfile=/tmp/e2e-spec.mjs \
//     --banner:js="import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);"
//   node /tmp/e2e-spec.mjs
//
// (Bundling is required: Node's native type-stripping cannot load
// @workspace/api-zod's extensionless internal imports, and the esm banner shims
// google-auth-library's dynamic require.) Expected output ends with
// "ALL CHECKS PASSED — full round-trip with no data loss." Raw AI output and
// the sanitized parse are dumped to /tmp/spec-e2e-{raw,parsed}.json for triage
// (scenario 2 dumps to /tmp/spec-sauce-e2e-{raw,parsed}.json).
// Last verified passing (2 consecutive runs): 2026-08-18, gemini-2.5-flash.
//
// SCENARIO 2 (same run): known-sauce grounding — a sheet abbreviating ready-made
// sauces the factory already has (known.sauceNames) must import with NO false
// "not found on the sheet" warning, a control without the known list must warn,
// and a paraphrased unknown sauce must still warn or snap.
//
// Companion harness: scripts/src/verify-large-spec-import.mts (repo-root
// scripts/ package) verifies LARGE imports (30 brands × 8 flavors, chunked
// through the real /ai/parse-spec-sheet endpoint). Run BOTH after changing the
// AI model — this one stresses parse rules, that one stresses size limits.
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { writeFileSync, readFileSync } from "node:fs";

import {
  buildSpecExportGrids,
  type SpecExportInput,
} from "../../../lib/spec-export/src/index.ts";
import { gridsToPromptText, recipeTargets, type SheetGrid } from "@workspace/spec-import";
import {
  buildParseSpecSheetPrompt,
  sanitizeParseSpecSheet,
} from "../src/routes/aiParseSpecSheet.ts";
import { openai, pickModel } from "@workspace/integrations-openai-ai-server";

// xlsx lives in the web artifact (the exporter is web glue); reuse it here so
// the file write/read halves match what the real export/import do. Resolved
// from cwd (run this from artifacts/api-server) because the esbuild bundle
// relocates import.meta.url to /tmp.
const XLSX = await import(
  pathToFileURL(
    resolve(process.cwd(), "../run-calculator/node_modules/xlsx/xlsx.mjs"),
  ).href
);

// ── Representative dataset (multiple brands/flavors, dough+sauce+cheese) ────
// Deliberately stresses the parse rules: qualifier brands ("Basha's Original"
// vs "Basha's Ultra Thin Crust"), size-in-brand ("Lowes 7in"), a shared dough
// recipe with multiple targets, doughball weights, cheese applicator slots 1/2,
// diced pepperoni inside a cheese recipe, and decimals throughout.
const input: SpecExportInput = {
  profiles: [
    {
      brand: "Basha's Original",
      flavor: "Cheese",
      dieType: "Argus",
      sauceOzPerPizza: 3.5,
      applicators: [
        { type: "Mozzarella Shred", ozPerPizza: 4.25 },
        { type: "Provolone Blend", ozPerPizza: 1.5 },
      ],
      pepperonis: [],
      doughRecipeName: "Standard Dough",
      targetDoughballWeight: 19.5,
      sauceRecipeName: "Classic Pizza Sauce",
      cheeseRecipeNames: ["Cheese Blend A", "Cheese Blend B", undefined, undefined],
    },
    {
      brand: "Basha's Original",
      flavor: "Pepperoni",
      dieType: "Argus",
      sauceOzPerPizza: 3.5,
      applicators: [{ type: "Mozzarella Shred", ozPerPizza: 4 }],
      pepperonis: [{ type: "Cup Char Pepperoni", sticks: 2, ozPerPizza: 1.2 }],
      doughRecipeName: "Standard Dough",
      targetDoughballWeight: 19.5,
      sauceRecipeName: "Classic Pizza Sauce",
      cheeseRecipeNames: ["Cheese Blend A", undefined, undefined, undefined],
    },
    {
      brand: "Basha's Ultra Thin Crust",
      flavor: "Cheese",
      dieType: "Mystic",
      sauceOzPerPizza: 2.75,
      applicators: [{ type: "Mozzarella Shred", ozPerPizza: 3.6 }],
      pepperonis: [],
      doughRecipeName: "Thin Crust Dough",
      targetDoughballWeight: 11,
      sauceRecipeName: "Classic Pizza Sauce",
      cheeseRecipeNames: ["Cheese Blend A", undefined, undefined, undefined],
    },
    {
      brand: "Lowes 7in",
      flavor: "Supreme",
      dieType: "Argus",
      sauceOzPerPizza: 2.1,
      applicators: [
        { type: "Mozzarella Shred", ozPerPizza: 2.4 },
        { type: "Topping Mix", ozPerPizza: 1.1 },
      ],
      pepperonis: [{ type: "Standard Pepperoni", sticks: 1, ozPerPizza: 0.6 }],
      doughRecipeName: "Standard Dough",
      targetDoughballWeight: 19.5,
      sauceRecipeName: "Classic Pizza Sauce",
      cheeseRecipeNames: [undefined, "Cheese Blend B", undefined, undefined],
    },
  ],
  doughRecipes: [
    {
      name: "Standard Dough",
      rows: [
        { ingredient: "Flour", lbs: 500 },
        { ingredient: "Water", lbs: 300.5 },
        { ingredient: "Yeast", lbs: 5 },
        { ingredient: "Salt", lbs: 12 },
        { ingredient: "Sugar", lbs: 8 },
        { ingredient: "Soybean Oil", lbs: 20 },
      ],
    },
    {
      name: "Thin Crust Dough",
      rows: [
        { ingredient: "Flour", lbs: 450 },
        { ingredient: "Water", lbs: 240 },
        { ingredient: "Yeast", lbs: 3.5 },
        { ingredient: "Salt", lbs: 10 },
        { ingredient: "Dough Conditioner", lbs: 2.25 },
      ],
    },
  ],
  sauceRecipes: [
    {
      name: "Classic Pizza Sauce",
      rows: [
        { ingredient: "Tomato Paste", lbs: 120 },
        { ingredient: "Water", lbs: 80 },
        { ingredient: "Spice Blend", lbs: 6.5 },
        { ingredient: "Sugar", lbs: 4 },
      ],
    },
  ],
  cheeseRecipes: [
    {
      name: "Cheese Blend A",
      rows: [
        { ingredient: "Mozzarella", lbs: 400 },
        { ingredient: "Provolone", lbs: 100 },
      ],
    },
    {
      name: "Cheese Blend B",
      rows: [
        { ingredient: "Mozzarella", lbs: 300 },
        { ingredient: "Cheese Substitute", lbs: 150 },
        { ingredient: "Diced Pepperoni", lbs: 25 },
      ],
    },
  ],
};

// ── 1. Export → real xlsx file ───────────────────────────────────────────────
const grids = buildSpecExportGrids(input, {
  profiles: true,
  dough: true,
  sauce: true,
  cheese: true,
});
const wb = XLSX.utils.book_new();
for (const g of grids) {
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(g.rows), g.name);
}
const file = "/tmp/spec-recipes-e2e.xlsx";
writeFileSync(file, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
console.log(`Wrote ${file} with sheets: ${grids.map((g: SheetGrid) => g.name).join(", ")}`);

// ── 2. Re-read the file exactly like the web importer does ──────────────────
const data = readFileSync(file);
const wb2 = XLSX.read(data, { type: "buffer" });
const readGrids: SheetGrid[] = [];
for (const name of wb2.SheetNames) {
  const ws = wb2.Sheets[name];
  if (!ws) continue;
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", blankrows: false }) as unknown[][];
  readGrids.push({
    name,
    rows: rows.map((r) => (Array.isArray(r) ? r.map((c) => (c == null ? "" : String(c))) : [])),
  });
}
const workbookText = gridsToPromptText(readGrids);
console.log(`Flattened workbook: ${workbookText.length} chars`);

// ── 3. Build the prompt with the app's "known" lists (re-import into same app)
const known = {
  brands: ["Basha's Original", "Basha's Ultra Thin Crust", "Lowes 7in"],
  flavorsByBrand: {
    "Basha's Original": ["Cheese", "Pepperoni"],
    "Basha's Ultra Thin Crust": ["Cheese"],
    "Lowes 7in": ["Supreme"],
  },
  appTypes: ["Mozzarella Shred", "Provolone Blend", "Topping Mix"],
  pepTypes: ["Cup Char Pepperoni", "Standard Pepperoni"],
  cheeseIngredients: ["Mozzarella", "Provolone", "Cheese Substitute", "Diced Pepperoni"],
  doughIngredients: ["Flour", "Water", "Yeast", "Salt", "Sugar", "Soybean Oil", "Dough Conditioner"],
  sauceIngredients: ["Tomato Paste", "Water", "Spice Blend", "Sugar"],
  dieTypes: ["Argus", "Mystic"],
};
const body = { workbookText, known, aliases: [] };
const { system, user } = buildParseSpecSheetPrompt(body as never);

// ── 4. Real AI call, same params as the route ────────────────────────────────
// The model occasionally truncates/malforms its JSON; the real route fails safe
// (empty result + note) and the user retries — the harness retries here so a
// one-off truncation doesn't abort the whole run.
async function callParseModel(sys: string, usr: string): Promise<{ content: string; raw: unknown }> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`Calling model ${pickModel("full")}… (attempt ${attempt})`);
    const response = await openai.chat.completions.create({
      model: pickModel("full"),
      max_completion_tokens: 65536,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: usr },
      ],
    });
    const content = response.choices[0]?.message?.content ?? "";
    try {
      return { content, raw: JSON.parse(content) };
    } catch (err) {
      lastErr = err;
      console.log(`  attempt ${attempt}: model returned malformed JSON (${content.length} chars), retrying…`);
    }
  }
  throw lastErr;
}

const { content, raw: rawOut } = await callParseModel(system, user);
writeFileSync("/tmp/spec-e2e-raw.json", content);
const parsed = sanitizeParseSpecSheet(rawOut, body as never);
writeFileSync("/tmp/spec-e2e-parsed.json", JSON.stringify(parsed, null, 2));

// ── 5. Deterministic diff vs the originals ──────────────────────────────────
const failures: string[] = [];
const notes: string[] = [];
const ok = (label: string) => notes.push(`PASS ${label}`);
const fail = (label: string) => failures.push(`FAIL ${label}`);
const ci = (s: string | undefined) => (s ?? "").trim().toLowerCase();
const close = (a: number | undefined, b: number | undefined) =>
  a != null && b != null && Math.abs(a - b) < 1e-9;

for (const p of input.profiles) {
  const got = parsed.profiles.find(
    (q) => ci(q.brand) === ci(p.brand) && ci(q.flavor) === ci(p.flavor),
  );
  const id = `${p.brand}/${p.flavor}`;
  if (!got) {
    fail(`profile ${id}: MISSING`);
    continue;
  }
  ok(`profile ${id}: found`);
  if (ci(got.dieType) !== ci(p.dieType)) fail(`profile ${id}: dieType "${got.dieType}" != "${p.dieType}"`);
  if (!close(got.sauceOzPerPizza, p.sauceOzPerPizza))
    fail(`profile ${id}: sauceOz ${got.sauceOzPerPizza} != ${p.sauceOzPerPizza}`);
  const wantApps = p.applicators.filter((a) => a.type);
  for (const a of wantApps) {
    const g = (got.applicators ?? []).find((x) => ci(x.type) === ci(a.type));
    if (!g) fail(`profile ${id}: applicator "${a.type}" missing`);
    else if (!close(g.ozPerPizza, a.ozPerPizza))
      fail(`profile ${id}: applicator "${a.type}" oz ${g.ozPerPizza} != ${a.ozPerPizza}`);
  }
  if ((got.applicators ?? []).length !== wantApps.length)
    fail(`profile ${id}: applicator count ${(got.applicators ?? []).length} != ${wantApps.length}`);
  const wantPeps = p.pepperonis.filter((x) => x.type);
  for (const pep of wantPeps) {
    const g = (got.pepperonis ?? []).find((x) => ci(x.type) === ci(pep.type));
    if (!g) fail(`profile ${id}: pepperoni "${pep.type}" missing`);
    else {
      if (!close(g.sticks, pep.sticks)) fail(`profile ${id}: pep "${pep.type}" sticks ${g.sticks} != ${pep.sticks}`);
      if (!close(g.ozPerPizza, pep.ozPerPizza))
        fail(`profile ${id}: pep "${pep.type}" oz ${g.ozPerPizza} != ${pep.ozPerPizza}`);
    }
  }
  if ((got.pepperonis ?? []).length !== wantPeps.length)
    fail(`profile ${id}: pepperoni count ${(got.pepperonis ?? []).length} != ${wantPeps.length}`);
}
if (parsed.profiles.length !== input.profiles.length)
  fail(`profile count ${parsed.profiles.length} != ${input.profiles.length}`);

type WantRecipe = {
  kind: "dough" | "sauce" | "cheese";
  name: string;
  rows: { ingredient: string; lbs: number }[];
  targets: { brand: string; flavor: string }[];
  doughballOz?: number;
  app?: number;
};
const wantRecipes: WantRecipe[] = [];
for (const r of input.doughRecipes)
  wantRecipes.push({
    kind: "dough",
    name: r.name,
    rows: r.rows,
    targets: input.profiles
      .filter((p) => ci(p.doughRecipeName) === ci(r.name))
      .map((p) => ({ brand: p.brand, flavor: p.flavor })),
    doughballOz: input.profiles.find((p) => ci(p.doughRecipeName) === ci(r.name))
      ?.targetDoughballWeight,
  });
for (const r of input.sauceRecipes)
  wantRecipes.push({
    kind: "sauce",
    name: r.name,
    rows: r.rows,
    targets: input.profiles
      .filter((p) => ci(p.sauceRecipeName) === ci(r.name))
      .map((p) => ({ brand: p.brand, flavor: p.flavor })),
  });
for (const r of input.cheeseRecipes) {
  const targets: { brand: string; flavor: string }[] = [];
  let app: number | undefined;
  for (const p of input.profiles) {
    (p.cheeseRecipeNames ?? []).forEach((nm, i) => {
      if (ci(nm) === ci(r.name)) {
        targets.push({ brand: p.brand, flavor: p.flavor });
        if (app == null) app = i + 1;
      }
    });
  }
  wantRecipes.push({ kind: "cheese", name: r.name, rows: r.rows, targets, app });
}

for (const w of wantRecipes) {
  const got = parsed.recipes.find((r) => r.kind === w.kind && ci(r.name) === ci(w.name));
  const id = `${w.kind} recipe "${w.name}"`;
  if (!got) {
    fail(`${id}: MISSING`);
    continue;
  }
  ok(`${id}: found`);
  for (const row of w.rows) {
    const g = (got.rows ?? []).find((x) => ci(x.ingredient) === ci(row.ingredient));
    if (!g) fail(`${id}: ingredient "${row.ingredient}" missing`);
    else if (!close(g.lbs, row.lbs))
      fail(`${id}: "${row.ingredient}" lbs ${g.lbs} != ${row.lbs}`);
  }
  if ((got.rows ?? []).length !== w.rows.length)
    fail(`${id}: row count ${(got.rows ?? []).length} != ${w.rows.length}`);
  if (w.doughballOz != null && !close(got.doughballOz, w.doughballOz))
    fail(`${id}: doughballOz ${got.doughballOz} != ${w.doughballOz}`);
  if (w.app != null && got.app !== w.app) fail(`${id}: app slot ${got.app} != ${w.app}`);
  const gotTargets = recipeTargets(got);
  const anchors = (got.brandAnchors ?? []).map(ci);
  for (const t of w.targets) {
    const hit =
      gotTargets.some((x) => ci(x.brand) === ci(t.brand) && ci(x.flavor) === ci(t.flavor)) ||
      anchors.includes(ci(t.brand));
    if (!hit) fail(`${id}: target ${t.brand}/${t.flavor} not attached`);
  }
}
if (parsed.recipes.length !== wantRecipes.length)
  fail(`recipe count ${parsed.recipes.length} != ${wantRecipes.length}`);

// ── SCENARIO 2: known-sauce grounding (`known.sauceNames`) ───────────────────
// A sheet that references ready-made sauces the factory ALREADY has, but
// abbreviates/misspells them so the canonical name is NOT spelled out on the
// sheet. The AI should snap to the KNOWN name; the sanitizer must then ground
// that name against known.sauceNames and emit NO "not found on the sheet"
// warning. A control re-sanitize WITHOUT the known list proves the list is
// what suppresses the false flag, and a scripted paraphrase proves a genuinely
// unknown sauce name still warns or snaps.
console.log("\n===== SCENARIO 2: sauce-name grounding =====");

const KNOWN_SAUCES = ["Marinara", "Zesty Garlic Sauce", "Classic Pizza Sauce"];
const sauceGrid: SheetGrid = {
  name: "Mario Specs",
  rows: [
    ["MARIO'S PIZZA SPECS"],
    [""],
    ["", "Cheese", "Pepperoni"],
    ["Die Type", "Argus", "Argus"],
    // Ready-made sauces, abbreviated the way floor sheets actually do it — the
    // canonical names ("Marinara", "Zesty Garlic Sauce") are NOT on the sheet.
    ["Sauce", "Marnara (ready made)", "Zesty Grlc RTU"],
    ["Sauce oz/pizza", "3.2", "2.8"],
    ["Mozzarella Shred oz", "4.1", "3.9"],
    ["Pepperoni sticks", "", "2"],
    ["Pepperoni oz", "", "1.1"],
  ],
};
const wbS = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wbS, XLSX.utils.aoa_to_sheet(sauceGrid.rows), sauceGrid.name);
const sauceFile = "/tmp/spec-sauce-e2e.xlsx";
writeFileSync(sauceFile, XLSX.write(wbS, { type: "buffer", bookType: "xlsx" }));
const wbS2 = XLSX.read(readFileSync(sauceFile), { type: "buffer" });
const sauceGrids: SheetGrid[] = wbS2.SheetNames.map((name) => {
  const ws = wbS2.Sheets[name];
  const rows = ws
    ? (XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", blankrows: false }) as unknown[][])
    : [];
  return {
    name,
    rows: rows.map((r) => (Array.isArray(r) ? r.map((c) => (c == null ? "" : String(c))) : [])),
  };
});
const sauceText = gridsToPromptText(sauceGrids);

const sauceKnown = {
  brands: ["Mario's"],
  flavorsByBrand: { "Mario's": ["Cheese", "Pepperoni"] },
  appTypes: ["Mozzarella Shred"],
  pepTypes: ["Standard Pepperoni"],
  dieTypes: ["Argus"],
  // The factory's existing sauce/frontline names (incl. ready-made pulls).
  sauceNames: KNOWN_SAUCES,
};
const sauceBody = { workbookText: sauceText, known: sauceKnown, aliases: [] };
const saucePrompt = buildParseSpecSheetPrompt(sauceBody as never);
const { content: sauceContent, raw: sauceRaw } = await callParseModel(
  saucePrompt.system,
  saucePrompt.user,
);
writeFileSync("/tmp/spec-sauce-e2e-raw.json", sauceContent);
const sauceParsed = sanitizeParseSpecSheet(sauceRaw, sauceBody as never);
writeFileSync("/tmp/spec-sauce-e2e-parsed.json", JSON.stringify(sauceParsed, null, 2));

const sauceWarnings = (p: typeof sauceParsed) =>
  (p.warnings ?? []).filter((w) => /sauce/i.test(w.message));
const notFoundWarnings = (p: typeof sauceParsed) =>
  sauceWarnings(p).filter((w) => /not found on the sheet/i.test(w.message));

// 2a. Both profiles carry the KNOWN canonical sauce name.
for (const [flavor, want] of [
  ["Cheese", "Marinara"],
  ["Pepperoni", "Zesty Garlic Sauce"],
] as const) {
  const prof = sauceParsed.profiles.find((q) => ci(q.flavor) === ci(flavor));
  if (!prof) fail(`S2 profile ${flavor}: MISSING`);
  else if (ci(prof.sauceName) !== ci(want))
    fail(`S2 profile ${flavor}: sauceName "${prof.sauceName}" != known "${want}"`);
  else ok(`S2 profile ${flavor}: sauceName snapped to known "${want}"`);
}

// 2b. NO false "not found on the sheet" warning for the known sauces.
const falseFlags = notFoundWarnings(sauceParsed);
if (falseFlags.length)
  fail(`S2: false sauce warnings for known sauces: ${falseFlags.map((w) => w.message).join(" | ")}`);
else ok("S2: no false sauce-name warning with known.sauceNames supplied");

// 2c. CONTROL: the same raw output sanitized WITHOUT known.sauceNames must
// flag (or snap) those names — proving the known list is what grounds them,
// not accidental sheet text.
const controlBody = { workbookText: sauceText, known: { ...sauceKnown, sauceNames: [] }, aliases: [] };
const controlParsed = sanitizeParseSpecSheet(sauceRaw, controlBody as never);
if (sauceWarnings(controlParsed).length === 0)
  fail("S2 control: expected sauce warnings/corrections without known.sauceNames, got none");
else ok(`S2 control: without known list -> ${sauceWarnings(controlParsed).length} sauce warning(s), as expected`);

// 2d. A genuinely unknown/paraphrased sauce name must still warn or snap
// (deterministic — mutate the real raw output).
const paraRaw = JSON.parse(sauceContent);
if (Array.isArray(paraRaw.profiles) && paraRaw.profiles[0]) {
  paraRaw.profiles[0].sauceName = "Golden Tang Dressing";
  const paraParsed = sanitizeParseSpecSheet(paraRaw, sauceBody as never);
  const prof0 = paraParsed.profiles[0];
  const warned = sauceWarnings(paraParsed).length > 0;
  const snapped = prof0 && ci(prof0.sauceName) !== ci("Golden Tang Dressing");
  if (warned || snapped)
    ok(`S2 paraphrase: unknown sauce ${warned ? "warned" : ""}${warned && snapped ? "+" : ""}${snapped ? `snapped to "${prof0?.sauceName}"` : ""}`);
  else fail('S2 paraphrase: unknown sauce "Golden Tang Dressing" neither warned nor snapped');
} else {
  fail("S2 paraphrase: raw output had no profiles to mutate");
}

console.log("\n===== RESULTS =====");
for (const n of notes) console.log(n);
if (failures.length) {
  console.log(`\n${failures.length} FAILURE(S):`);
  for (const f of failures) console.log(f);
  process.exitCode = 1;
} else {
  console.log("\nALL CHECKS PASSED — full round-trip with no data loss.");
}
if (parsed.note) console.log(`\nAI note: ${parsed.note}`);
if (sauceParsed.note) console.log(`S2 AI note: ${sauceParsed.note}`);
