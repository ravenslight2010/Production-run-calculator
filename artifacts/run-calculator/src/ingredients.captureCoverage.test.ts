// Catalog-capture COVERAGE guard (Task audit: "capture ingredient names from
// spec imports into the shared suggestion list").
//
// Newly typed ingredient names join the factory-wide catalog through a
// fire-and-forget captureIngredientNamesToCatalog call inside the three pool
// save glues (saveMixes / saveCheeseRecipes / saveNamedRecipes). That only
// stays true while EVERY client write to a recipe pool routes through those
// glues. The 2026-07 audit confirmed all current paths do (spec import,
// premix import, cheese import, mix reconcile, manager editors, one-time
// name consolidation, batch-weight enrichment) and that server-side heals
// only rename/delete pool rows — they never mint new component names.
//
// This test locks the audit in statically: no source file other than the
// glue modules may talk to the pool endpoints directly. If a future feature
// adds a raw fetch to /api/mixes, /api/cheese-recipes, /api/dough-recipes or
// /api/sauce-recipes, this fails and points it at the glue (which captures).
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC_ROOT = join(__dirname);

// The only modules allowed to hit the pool endpoints directly.
const GLUE_FILES = new Set(["mixes.ts", "cheeseRecipes.ts", "namedRecipes.ts"]);

// Endpoint literals whose direct use elsewhere would bypass catalog capture.
const POOL_ENDPOINT_RE =
  /["'`]\/api\/(mixes|cheese-recipes|dough-recipes|sauce-recipes)["'`]/;

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "__snapshots__") continue;
      collectSourceFiles(full, out);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (/\.test\.(ts|tsx)$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

describe("ingredient catalog capture coverage", () => {
  it("no source file outside the pool glue modules fetches a pool endpoint directly", () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(SRC_ROOT)) {
      const rel = relative(SRC_ROOT, file);
      if (GLUE_FILES.has(rel)) continue;
      const text = readFileSync(file, "utf8");
      if (POOL_ENDPOINT_RE.test(text)) offenders.push(rel);
    }
    expect(
      offenders,
      `These files hit a recipe-pool endpoint directly, bypassing ` +
        `captureIngredientNamesToCatalog — route the write through ` +
        `saveMixes / saveCheeseRecipes / saveNamedRecipes instead: ` +
        offenders.join(", "),
    ).toEqual([]);
  });

  it("every pool save glue calls captureIngredientNamesToCatalog", () => {
    for (const glue of GLUE_FILES) {
      const text = readFileSync(join(SRC_ROOT, glue), "utf8");
      expect(
        text.includes("captureIngredientNamesToCatalog("),
        `${glue} must keep the fire-and-forget catalog capture in its save path`,
      ).toBe(true);
    }
  });
});
