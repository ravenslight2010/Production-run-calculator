// Large spec-sheet import — end-to-end real-AI verification harness.
//
// WHY THIS EXISTS
// ───────────────
// The spec importer's per-chunk size limits are tuned EMPIRICALLY to the
// CURRENT AI model's output reliability. If the model in
// lib/integrations-openai-ai-server/src/models.ts (AI_MODELS / pickModel) is
// ever changed, these limits can silently become wrong again — and the failure
// mode is the worst kind: an import that "succeeds" but quietly loses data
// (truncated output → non-JSON → empty chunk result, or valid-but-empty JSON).
// Re-run this script whenever the model, the chunking limits, or the
// parse-spec-sheet output budget changes.
//
// Companion harness: artifacts/api-server/scripts/e2e-spec-roundtrip.ts covers
// the SMALL representative round-trip (xlsx write/read + parse-rule stress:
// qualifier brands, size-in-brand, shared targets). THIS script covers SIZE —
// that one won't catch chunk/output-budget regressions, this one will.
//
// CURRENT VERIFIED LIMITS (verified with gemini-3.1-pro-preview, 2026-08-17)
// ────────────────────────────────────────────────────────────────────────────
// - Per-chunk prompt budget: 4,000 chars
//   (DEFAULT_LIMITS.maxTotalChars in lib/spec-import/src/index.ts).
//   4k chunks (~20 profiles or ~15 recipes each) verified correct with zero
//   loss or unit-conversion errors across smoke (4×3), 4×8, and 10×4 runs.
// - max_completion_tokens: 65,536 on POST /ai/parse-spec-sheet
//   (artifacts/api-server/src/routes/ai.ts). A chunk carrying ~240 profiles
//   overflowed 32,768 output tokens, so the route uses the model's full 64k
//   output budget. Unchanged from the prior calibration.
// - Sanitizer maxProfiles: 400 (DEFAULT_SPEC_LIMITS in
//   lib/spec-import/src/index.ts). Unchanged — 4k chunks carry at most ~20
//   profiles so this limit is never reached.
// - Test data: harness ingredient weights use realistic per-ingredient bases
//   (Flour ~50 lbs, Yeast ~0.5 lbs, etc.) so the model does not "correct"
//   them from oz to lbs. Unrealistic values (10–22 lbs of yeast) triggered
//   model grounding that divided all weights by 16.
//
// WHAT IT DOES
// ────────────
// 1. Generates a synthetic factory export: BRANDS × FLAVORS spec profiles plus
//    one dough + one sauce + one cheese recipe per brand, rendered through the
//    real exporter (buildSpecExportGrids) so the workbook shape is exactly what
//    users round-trip.
// 2. Splits it with the real chunker (splitGridsForPrompt) and asserts no rows
//    were dropped.
// 3. Sends EVERY chunk through the real POST /ai/parse-spec-sheet endpoint
//    (real AI call — costs money, throttled to respect the 10-req/min limit).
// 4. Merges the per-chunk results with mergeParsedSpecImports and asserts:
//    - every generated brand+flavor profile is present,
//    - every generated recipe is present (by kind + name),
//    - no recipe is missing ingredient rows (names + lbs match),
//    - every recipe's brand/flavor targets cover all of its flavors.
//
// HOW TO RUN
// ──────────
//   1. Start the API server (dev workflow, port 5000) with DATABASE_URL and the
//      Gemini AI integration env configured.
//   2. From the repo root:
//        pnpm --filter @workspace/scripts run verify-large-spec-import
//      Defaults to the FULL verification: 30 brands × 8 flavors = 240 profiles
//      + 90 recipes, ~10 chunks ≈ that many real AI calls, and (with rate-limit
//      throttling) roughly 10-20 minutes. For a cheap smoke run first:
//        BRANDS=4 FLAVORS=3 pnpm --filter @workspace/scripts run verify-large-spec-import
//      ALWAYS run the full size after an AI model change.
//
//   Env:
//     API_BASE          default http://localhost:5000/api
//     BRANDS / FLAVORS  dataset size (default 30 × 8 — the verified full size)
//     VERIFY_USERNAME / VERIFY_PASSWORD
//                       existing account with the use-ai-tools capability.
//                       When unset, the script signs up a fresh user — that only
//                       works on a database whose FIRST user it becomes (first
//                       user is bootstrapped as manager).
//
// Exit code 0 = all assertions passed; 1 = data was lost or mismatched.

import {
  gridsToPromptText,
  mergeParsedSpecImports,
  recipeTargets,
  splitGridsForPrompt,
  type ParsedRecipe,
  type ParsedSpecImport,
} from "@workspace/spec-import";
import {
  buildSpecExportGrids,
  type ExportProfile,
  type ExportRecipe,
  type SpecExportInput,
} from "@workspace/spec-export";

// ── Config ───────────────────────────────────────────────────────────────────

const API_BASE = (process.env.API_BASE ?? "http://localhost:5000/api").replace(/\/$/, "");
const BRAND_COUNT = clampInt(process.env.BRANDS, 30, 1, 60);
const FLAVOR_COUNT = clampInt(process.env.FLAVORS, 8, 1, 8);
// Cap on parse calls; generous so the full 30×8 export never drops rows. The
// production importer caps at DEFAULT_MAX_PROMPT_CHUNKS per file — this harness
// deliberately raises it because it verifies the CHUNK SIZE, not the file cap.
const MAX_CHUNKS = 32;
// The route allows 10 calls/min per user; stay safely under it.
const CALLS_PER_MINUTE = 8;

function clampInt(raw: string | undefined, dflt: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

// ── Dataset generator ────────────────────────────────────────────────────────
// Realistic-looking, fully deterministic names/numbers so assertion failures
// are reproducible and diffable across runs.

const BRAND_WORDS_A = [
  "Golden", "Rustic", "Alpine", "Harbor", "Prairie", "Copper", "Summit", "Willow",
  "Cedar", "Ember", "Frontier", "Heritage", "Lakeside", "Maple", "Northern", "Orchard",
  "Pioneer", "Quarry", "Redstone", "Silverline", "Timber", "Union", "Valley", "Westport",
  "Yellowfield", "Zephyr", "Bluebird", "Crestwood", "Dockside", "Evergreen",
];
const BRAND_WORDS_B = [
  "Crust", "Hearth", "Stone", "Mills", "Kitchens", "Ovens", "Bakehouse", "Foods",
  "Provisions", "Pie", "Slice", "Table", "Harvest", "Pantry", "Fireside",
];
const FLAVOR_NAMES = [
  "Cheese", "Pepperoni", "Supreme", "Hawaiian", "Margherita", "Sausage", "Veggie",
  "BBQ Chicken",
];
const DIE_TYPES = ["Argus", "Mystic", "Round 12", "Thin 10", "Deep 9"];
const APP_TYPES = ["Shredded Mozzarella", "Provolone Blend", "Cheddar Mix"];
const PEP_TYPES = ["Standard Pepperoni", "Cup Char Pepperoni"];

const DOUGH_INGREDIENTS = ["Flour", "Water", "Yeast", "Salt", "Sugar", "Olive Oil"];
// Realistic per-ingredient base lbs so the model does not "correct" values
// it thinks look wrong. Yeast/Salt/Sugar are small; Flour/Water are large.
// Per-brand step adds variety without leaving the realistic range.
const DOUGH_LBS_BASE = [50, 28, 0.5, 1.5, 3.0, 5.0];
const DOUGH_LBS_STEP = [2.0, 1.0, 0.05, 0.1, 0.1, 0.2];

const SAUCE_INGREDIENTS = ["Tomato Paste", "Water", "Spice Blend", "Sugar", "Salt"];
const SAUCE_LBS_BASE = [15, 20, 0.5, 2.0, 0.5];
const SAUCE_LBS_STEP = [1.0, 0.5, 0.05, 0.1, 0.05];

const CHEESE_INGREDIENTS = ["Mozzarella", "Provolone", "Cheese Substitute"];
const CHEESE_LBS_BASE = [20, 5, 3];
const CHEESE_LBS_STEP = [1.0, 0.5, 0.3];

function brandName(i: number): string {
  return `${BRAND_WORDS_A[i % BRAND_WORDS_A.length]} ${BRAND_WORDS_B[i % BRAND_WORDS_B.length]}`;
}

type Dataset = { input: SpecExportInput; brands: string[]; flavors: string[] };

function buildDataset(brandCount: number, flavorCount: number): Dataset {
  const brands = Array.from({ length: brandCount }, (_, i) => brandName(i));
  const flavors = FLAVOR_NAMES.slice(0, flavorCount);
  const profiles: ExportProfile[] = [];
  const doughRecipes: ExportRecipe[] = [];
  const sauceRecipes: ExportRecipe[] = [];
  const cheeseRecipes: ExportRecipe[] = [];

  brands.forEach((brand, bi) => {
    const doughName = `${brand} Dough`;
    const sauceName = `${brand} Sauce`;
    const cheeseName = `${brand} Cheese Blend`;
    doughRecipes.push({
      name: doughName,
      rows: DOUGH_INGREDIENTS.map((ingredient, ri) => ({
        ingredient,
        lbs: Math.round((DOUGH_LBS_BASE[ri] + bi * DOUGH_LBS_STEP[ri]) * 100) / 100,
      })),
    });
    sauceRecipes.push({
      name: sauceName,
      rows: SAUCE_INGREDIENTS.map((ingredient, ri) => ({
        ingredient,
        lbs: Math.round((SAUCE_LBS_BASE[ri] + bi * SAUCE_LBS_STEP[ri]) * 100) / 100,
      })),
    });
    cheeseRecipes.push({
      name: cheeseName,
      rows: CHEESE_INGREDIENTS.map((ingredient, ri) => ({
        ingredient,
        lbs: Math.round((CHEESE_LBS_BASE[ri] + bi * CHEESE_LBS_STEP[ri]) * 100) / 100,
      })),
    });
    flavors.forEach((flavor, fi) => {
      profiles.push({
        brand,
        flavor,
        dieType: DIE_TYPES[(bi + fi) % DIE_TYPES.length],
        sauceOzPerPizza: 3 + ((bi + fi) % 4) * 0.5,
        applicators: [
          { type: APP_TYPES[(bi + fi) % APP_TYPES.length], ozPerPizza: 6 + (fi % 3) * 0.5 },
        ],
        pepperonis:
          fi % 2 === 1
            ? [{ type: PEP_TYPES[bi % PEP_TYPES.length], sticks: 2 + (fi % 2), ozPerPizza: 1.5 }]
            : [],
        doughRecipeName: doughName,
        targetDoughballWeight: 14 + (bi % 5),
        sauceRecipeName: sauceName,
        cheeseRecipeNames: [cheeseName],
      });
    });
  });

  return {
    input: { profiles, doughRecipes, sauceRecipes, cheeseRecipes },
    brands,
    flavors,
  };
}

// ── API client ───────────────────────────────────────────────────────────────

async function api(path: string, body: unknown, token?: string): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function signIn(): Promise<string> {
  const username = process.env.VERIFY_USERNAME;
  const password = process.env.VERIFY_PASSWORD;
  if (username && password) {
    const res = await api("/auth/sign-in", { username, password });
    if (!res.ok) throw new Error(`sign-in failed (${res.status}): ${await res.text()}`);
    const data = (await res.json()) as { token?: string };
    if (!data.token) throw new Error("sign-in response had no token");
    return data.token;
  }
  // Fresh user; only useful when it becomes the FIRST user (bootstrap manager).
  const name = `spec-verify-${Date.now().toString(36)}`;
  const res = await api("/auth/sign-up", { username: name, password: `Vv1!${name}` });
  if (!res.ok) throw new Error(`sign-up failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error("sign-up response had no token");
  console.log(`Signed up fresh user "${name}" (must be first user to have manager rights).`);
  return data.token;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function parseChunk(
  workbookText: string,
  token: string,
  label: string,
): Promise<ParsedSpecImport> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await api("/ai/parse-spec-sheet", { workbookText }, token);
    if (res.status === 429) {
      console.log(`  ${label}: rate-limited, waiting 65s…`);
      await sleep(65_000);
      continue;
    }
    if (res.status === 403) {
      throw new Error(
        `${label}: 403 — the account lacks the use-ai-tools capability. ` +
          "Set VERIFY_USERNAME/VERIFY_PASSWORD to a manager account.",
      );
    }
    if (!res.ok) throw new Error(`${label}: HTTP ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as ParsedSpecImport;
    const profiles = data.profiles ?? [];
    const recipes = data.recipes ?? [];
    // An empty result from a non-trivial chunk is EXACTLY the silent-loss
    // failure mode this harness exists to catch — but the route also returns
    // empty + note on a truncated response. Retry once to separate a flaky
    // call from a systematic (model/limit) failure.
    if (profiles.length === 0 && recipes.length === 0 && attempt < 3) {
      console.warn(
        `  ${label}: EMPTY result (note: ${data.note ?? "none"}) — retrying (attempt ${attempt + 1})…`,
      );
      await sleep(5_000);
      continue;
    }
    console.log(`  ${label}: ${profiles.length} profiles, ${recipes.length} recipes`);
    return { profiles, recipes, ...(data.note ? { note: data.note } : {}) };
  }
  throw new Error(`${label}: exhausted retries`);
}

// ── Assertions ───────────────────────────────────────────────────────────────

const norm = (s: string | undefined) => (s ?? "").trim().toLowerCase();

function checkResult(dataset: Dataset, merged: ParsedSpecImport): string[] {
  const failures: string[] = [];
  const { input, flavors } = dataset;

  const gotProfiles = new Set(merged.profiles.map((p) => `${norm(p.brand)}|${norm(p.flavor)}`));
  for (const p of input.profiles) {
    if (!gotProfiles.has(`${norm(p.brand)}|${norm(p.flavor)}`)) {
      failures.push(`MISSING PROFILE: ${p.brand} / ${p.flavor}`);
    }
  }

  const recipeByKey = new Map<string, ParsedRecipe>();
  for (const r of merged.recipes) recipeByKey.set(`${r.kind}|${norm(r.name)}`, r);

  const checkRecipes = (kind: "dough" | "sauce" | "cheese", recipes: ExportRecipe[]) => {
    for (const expected of recipes) {
      const got = recipeByKey.get(`${kind}|${norm(expected.name)}`);
      if (!got) {
        failures.push(`MISSING RECIPE: [${kind}] ${expected.name}`);
        continue;
      }
      // Rows: every generated ingredient present with the exact lbs.
      const gotRows = new Map((got.rows ?? []).map((r) => [norm(r.ingredient), r.lbs]));
      for (const row of expected.rows) {
        const lbs = gotRows.get(norm(row.ingredient));
        if (lbs == null) {
          failures.push(`MISSING ROW: [${kind}] ${expected.name} → ${row.ingredient}`);
        } else if (Math.abs(lbs - row.lbs) > 1e-9) {
          failures.push(
            `WRONG LBS: [${kind}] ${expected.name} → ${row.ingredient}: got ${lbs}, expected ${row.lbs}`,
          );
        }
      }
      // Targets: the exported "Brand: flavor, flavor…" header must round-trip so
      // the recipe re-attaches to every profile. The brand is in the recipe name
      // (one recipe per brand in this dataset); check every flavor is targeted.
      const brand = expected.name.replace(/ (Dough|Sauce|Cheese Blend)$/i, "");
      const targets = new Set(
        recipeTargets(got).map((t) => `${norm(t.brand)}|${norm(t.flavor)}`),
      );
      const anchors = new Set((got.brandAnchors ?? []).map(norm));
      const wholeBrand = anchors.has(norm(brand)) || (norm(got.brand) === norm(brand) && !norm(got.flavor));
      for (const flavor of flavors) {
        if (!wholeBrand && !targets.has(`${norm(brand)}|${norm(flavor)}`)) {
          failures.push(`MISSING TARGET: [${kind}] ${expected.name} → ${brand} / ${flavor}`);
        }
      }
    }
  };
  checkRecipes("dough", input.doughRecipes);
  checkRecipes("sauce", input.sauceRecipes);
  checkRecipes("cheese", input.cheeseRecipes);

  return failures;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`Dataset: ${BRAND_COUNT} brands × ${FLAVOR_COUNT} flavors`);
  const dataset = buildDataset(BRAND_COUNT, FLAVOR_COUNT);
  const { input } = dataset;
  console.log(
    `Generated ${input.profiles.length} profiles, ` +
      `${input.doughRecipes.length + input.sauceRecipes.length + input.cheeseRecipes.length} recipes.`,
  );

  const grids = buildSpecExportGrids(input, {
    profiles: true,
    dough: true,
    sauce: true,
    cheese: true,
  });
  const totalChars = grids.reduce(
    (a, g) => a + g.rows.reduce((b, r) => b + r.join("\t").length + 1, 0),
    0,
  );
  console.log(`Export workbook: ${grids.length} sheets, ~${totalChars} chars.`);

  const split = splitGridsForPrompt(grids, {}, MAX_CHUNKS);
  if (split.droppedRows > 0) {
    console.error(
      `FAIL: splitGridsForPrompt dropped ${split.droppedRows} rows at maxChunks=${MAX_CHUNKS}. ` +
        "Raise MAX_CHUNKS in this script — the dataset outgrew the chunk cap.",
    );
    process.exit(1);
  }
  console.log(`Split into ${split.chunks.length} chunks (4k-char budget each).`);

  const token = await signIn();

  const results: ParsedSpecImport[] = [];
  for (let i = 0; i < split.chunks.length; i++) {
    // Throttle to stay under the route's 10-req/min rate limit (retries add calls).
    if (i > 0 && i % CALLS_PER_MINUTE === 0) {
      console.log("  …throttling 65s for the per-minute rate limit…");
      await sleep(65_000);
    }
    const text = gridsToPromptText(split.chunks[i]);
    results.push(await parseChunk(text, token, `chunk ${i + 1}/${split.chunks.length} (${text.length} chars)`));
  }

  const merged = mergeParsedSpecImports(results);
  console.log(`Merged: ${merged.profiles.length} profiles, ${merged.recipes.length} recipes.`);
  if (merged.note) console.log(`Notes from AI:\n${merged.note}`);

  const failures = checkResult(dataset, merged);
  if (failures.length) {
    console.error(`\nFAIL — ${failures.length} problem(s):`);
    for (const f of failures.slice(0, 60)) console.error(`  - ${f}`);
    if (failures.length > 60) console.error(`  … and ${failures.length - 60} more`);
    console.error(
      "\nData was lost or corrupted between export → chunk → AI parse → merge." +
        "\nIf the AI model recently changed, re-tune: the current chunk budget (DEFAULT_LIMITS.maxTotalChars in lib/spec-import)" +
        "\n(DEFAULT_LIMITS.maxTotalChars in lib/spec-import), the 65536" +
        "\nmax_completion_tokens on /ai/parse-spec-sheet, and maxProfiles (400).",
    );
    process.exit(1);
  }
  console.log(
    `\nPASS — all ${input.profiles.length} profiles, all ` +
      `${input.doughRecipes.length + input.sauceRecipes.length + input.cheeseRecipes.length} recipes, ` +
      "all rows and brand/flavor targets survived the chunked AI import.",
  );
}

main().catch((err) => {
  console.error("Harness error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
