// @workspace/corpus-harness — deterministic importer regression bench over the
// real customer workbook corpus in attached_assets/source-library.
//
// It runs ONLY the deterministic (non-AI) importer layers — cheese workbook,
// premix parse, shipping guide, and the deterministic layers of spec import
// (grid sanity, prompt chunking, dough-family filename hints, mix-vs-cheese
// routing, near-dup matching) — and compares the results against readable
// JSON snapshots checked in under ./snapshots.
//
// Regenerate snapshots after an INTENTIONAL importer behavior change:
//   pnpm --filter @workspace/corpus-harness run snapshots
// then review the JSON diff like code (each file is stable-ordered JSON).
// AI-parsed layers are covered by the manual real-AI harnesses instead
// (scripts: verify-large-spec-import / verify-corpus-spec-import).

import { parseCheeseWorkbook } from "@workspace/cheese-import";
import { parsePremixWorkbook } from "@workspace/premix-import";
import { parseShippingGuide, shippingPatchFromRow } from "@workspace/shipping-import";
import {
  gridSanityIssue,
  splitGridsForPrompt,
  specImportDoughFamilyHintFromFileName,
  specImportCheeseRecipeIsMix,
} from "@workspace/spec-import";
import { buildNearDupNameMatcher } from "@workspace/name-match";
import { corpusFiles, corpusFileKey, readGrids, type CorpusKind } from "./corpus.js";

export * from "./corpus.js";

const NO_MIXES: ReadonlySet<string> = new Set();

/** Cheese workbook → full deterministic parse (recipes, brands, per-sheet). */
export function buildCheeseSnapshot() {
  const [file] = corpusFiles("cheese");
  const parsed = parseCheeseWorkbook(readGrids("cheese", file));
  return {
    file: corpusFileKey(file),
    brands: [...parsed.brands].sort(),
    recipeCount: parsed.recipes.length,
    recipes: parsed.recipes
      .map((r) => ({
        id: r.id,
        name: r.name,
        brand: r.brand,
        flavors: r.flavors,
        components: r.components.map((c) => ({ name: c.ingredient, lbs: c.lbs })),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    sheets: parsed.sheets.map((s) => ({
      brand: s.brand,
      shredderSetting: s.shredderSetting,
      assignments: s.assignments,
      recipeNames: s.recipes.map((r) => r.name),
    })),
  };
}

/** Premix workbook → full deterministic parse. */
export function buildPremixSnapshot() {
  const [file] = corpusFiles("premix");
  const mixes = parsePremixWorkbook(readGrids("premix", file));
  return {
    file: corpusFileKey(file),
    mixCount: mixes.length,
    mixes: mixes.map((m) => ({
      name: m.name,
      sheetName: m.sheetName,
      batchSize: m.batchSize,
      daysEarly: m.daysEarly,
      components: m.components.map((c) => ({
        ingredient: c.ingredient,
        perPizza: c.perPizza,
        perBatch: c.perBatch,
      })),
    })),
  };
}

/** Shipping guide → rows + mapped packaging patches + kept-as-is columns. */
export function buildShippingSnapshot() {
  const [file] = corpusFiles("shipping");
  const rows = parseShippingGuide(readGrids("shipping", file));
  return {
    file: corpusFileKey(file),
    rowCount: rows.length,
    rows: rows.map((row) => {
      const { patch, unmapped } = shippingPatchFromRow(row);
      return { row, patch, unmapped };
    }),
  };
}

/** Deterministic pre-AI layers over every spec/dough/sauce/schedule workbook:
 *  grid sanity, prompt chunk plan, filename dough-family hints. */
export function buildGridsSnapshot() {
  const kinds: CorpusKind[] = ["specs", "dough", "sauce", "schedule"];
  const out: Record<string, unknown> = {};
  for (const kind of kinds) {
    out[kind] = corpusFiles(kind).map((file) => {
      const grids = readGrids(kind, file);
      const split = splitGridsForPrompt(grids);
      return {
        file: corpusFileKey(file),
        sheets: grids.map((g) => ({ name: g.name, rows: g.rows.length })),
        sanityIssue: gridSanityIssue(grids),
        promptChunks: split.chunks.length,
        droppedRows: split.droppedRows,
        doughFamilyHint:
          kind === "dough" ? specImportDoughFamilyHintFromFileName(corpusFileKey(file)) : undefined,
      };
    });
  }
  return out;
}

/** Mix-vs-cheese routing + near-dup matching over the corpus's real names. */
export function buildRoutingSnapshot() {
  const [cheeseFile] = corpusFiles("cheese");
  const [premixFile] = corpusFiles("premix");
  const cheese = parseCheeseWorkbook(readGrids("cheese", cheeseFile));
  const premixes = parsePremixWorkbook(readGrids("premix", premixFile));

  // Every cheese-workbook recipe must ROUTE TO CHEESE (routedToMix=false);
  // premix names with >=2 components and no cheesy ingredient default to Mix.
  const cheeseRouting = cheese.recipes
    .map((r) => ({
      name: r.name,
      routedToMix: specImportCheeseRecipeIsMix(
        r.name,
        NO_MIXES,
        r.components.length,
        r.components.map((c) => c.ingredient ?? ""),
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const premixRouting = premixes
    .map((m) => ({
      name: m.name,
      componentCount: m.components.length,
      routedToMix: specImportCheeseRecipeIsMix(
        m.name,
        NO_MIXES,
        m.components.length,
        m.components.map((c) => c.ingredient ?? ""),
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Near-dup self-scan inside each pool: any non-null hit is a name that a
  // link pass would fold into another — real dup pressure in the source data.
  const nearDups = (names: string[]) => {
    const matcher = buildNearDupNameMatcher(names, { excludeSelf: true });
    return names
      .map((name) => ({ name, match: matcher(name) }))
      .filter((e) => e.match !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  };

  return {
    cheeseRouting,
    premixRouting,
    cheeseNearDups: nearDups(cheese.recipes.map((r) => r.name)),
    premixNearDups: nearDups(premixes.map((m) => m.name)),
  };
}

export const SNAPSHOT_BUILDERS = {
  cheese: buildCheeseSnapshot,
  premix: buildPremixSnapshot,
  shipping: buildShippingSnapshot,
  grids: buildGridsSnapshot,
  routing: buildRoutingSnapshot,
} as const;
export type SnapshotName = keyof typeof SNAPSHOT_BUILDERS;
