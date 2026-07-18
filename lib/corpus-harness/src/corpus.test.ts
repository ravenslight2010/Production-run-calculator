// Corpus regression bench: deterministic importer layers over the REAL
// customer workbooks vs checked-in snapshots. A failing diff means importer
// behavior changed on real files — either fix the regression or, if the
// change is intentional, regenerate and review:
//   pnpm --filter @workspace/corpus-harness run snapshots
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SNAPSHOT_BUILDERS, type SnapshotName } from "./index.js";
import {
  buildCheeseSnapshot,
  buildPremixSnapshot,
  buildShippingSnapshot,
  buildGridsSnapshot,
  buildRoutingSnapshot,
  corpusFiles,
  readGrids,
} from "./index.js";

const SNAP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "snapshots");
function loadSnapshot(name: SnapshotName): unknown {
  const file = path.join(SNAP_DIR, `${name}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(
      `Missing snapshot ${file} — run: pnpm --filter @workspace/corpus-harness run snapshots`,
    );
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

describe("corpus snapshots (deterministic importers)", () => {
  for (const name of Object.keys(SNAPSHOT_BUILDERS) as SnapshotName[]) {
    it(`${name} parse matches snapshots/${name}.json`, () => {
      // JSON round-trip the actual too so undefined-vs-missing never diffs.
      const actual = JSON.parse(JSON.stringify(SNAPSHOT_BUILDERS[name]()));
      expect(actual).toEqual(loadSnapshot(name));
    });
  }
});

describe("corpus invariants (parse-gap tripwires)", () => {
  it("cheese workbook: every customer tab yields recipes with real pounds", () => {
    const snap = buildCheeseSnapshot();
    expect(snap.recipeCount).toBeGreaterThan(0);
    for (const sheet of snap.sheets) {
      expect(sheet.brand, "sheet with no brand").not.toBe("");
      expect(sheet.recipeNames.length, `no recipes parsed for ${sheet.brand}`).toBeGreaterThan(0);
    }
    // No all-zero recipe may come out of the CHEESE workbook itself — that
    // pattern is the spec-import stub pollution the audit flagged, and the
    // dedicated cheese importer must never contribute to it.
    for (const r of snap.recipes) {
      const total = r.components.reduce((s, c) => s + c.lbs, 0);
      expect(total, `all-zero cheese recipe parsed: ${r.name}`).toBeGreaterThan(0);
    }
  });

  it("premix workbook: every mix has components and a positive batch size", () => {
    const snap = buildPremixSnapshot();
    expect(snap.mixCount).toBeGreaterThan(0);
    for (const m of snap.mixes) {
      expect(m.components.length, `empty premix: ${m.name}`).toBeGreaterThan(0);
      // Some real blocks legitimately have no "Total" row (batchSize 0), but a
      // NEGATIVE batch or a nameless block with no sheet tab is a parse bug.
      expect(m.batchSize, `negative batch size: ${m.name}`).toBeGreaterThanOrEqual(0);
      expect(
        (m.name.trim() || m.sheetName.trim()).length,
        "premix block with no name and no sheet name",
      ).toBeGreaterThan(0);
    }
  });

  it("shipping guide: rows parse and every row maps at least one field", () => {
    const snap = buildShippingSnapshot();
    expect(snap.rowCount).toBeGreaterThan(0);
    for (const { row, patch } of snap.rows) {
      expect(Object.keys(patch).length, `nothing mapped for ${row.name}`).toBeGreaterThan(0);
    }
  });

  it("every corpus workbook passes grid sanity and fits the chunk plan", () => {
    const grids = buildGridsSnapshot() as Record<
      string,
      { file: string; sanityIssue: string | null; promptChunks: number; droppedRows: number }[]
    >;
    for (const kind of Object.keys(grids)) {
      for (const f of grids[kind]) {
        expect(f.sanityIssue, `${kind}/${f.file} failed grid sanity`).toBeNull();
        expect(f.promptChunks, `${kind}/${f.file} produced no prompt chunks`).toBeGreaterThan(0);
        // The schedule workbook is huge and imports through its own
        // day-block path, not the spec prompt chunker — its droppedRows value
        // is tracked in the snapshot but not gated here.
        if (kind !== "schedule") {
          expect(f.droppedRows, `${kind}/${f.file} would drop rows at import`).toBe(0);
        }
      }
    }
  });

  it("mix-vs-cheese routing: cheese-workbook names only leak to Mixes via the deliberate mix/blend-word rule", () => {
    const snap = buildRoutingSnapshot();
    // The cheese IMPORTER never consults this spec-import heuristic, so a
    // cheese-workbook blend named "... Mix" routing to Mixes here is a known,
    // deliberate boundary (the mix-word rule must win for real premixes like
    // "White Fajita Mix" that contain cheese). Anything routed WITHOUT a
    // mix/blend word in its name would be a real regression.
    for (const r of snap.cheeseRouting.filter((x) => x.routedToMix)) {
      expect(r.name.toLowerCase(), `${r.name} misrouted without a mix/blend word`).toMatch(
        /\b(?:mix|blend)\b/,
      );
    }
    // Multi-component meat/veggie premixes must default to Mix. Exemptions:
    // nameless blocks (name lives on the sheet tab only), single-component
    // "premixes" (prep steps like drained pineapple — the >=2-component rule
    // can't fire), and cheesy names ("... Cheeseburger Mix" hits the
    // name-mentions-cheese carve-out by design).
    const misrouted = snap.premixRouting.filter((r) => !r.routedToMix);
    for (const r of misrouted) {
      if (!r.name.trim() || r.componentCount < 2) continue;
      expect(r.name.toLowerCase(), `${r.name} did not default to Mix`).toMatch(
        /cheese|mozz|parm|romano|asiago/,
      );
    }
  });

  it("corpus layout: every kind still has its files", () => {
    expect(corpusFiles("specs").length).toBe(19);
    expect(corpusFiles("dough").length).toBe(13);
    expect(corpusFiles("sauce").length).toBe(15);
    expect(corpusFiles("cheese").length).toBe(1);
    expect(corpusFiles("premix").length).toBe(1);
    expect(corpusFiles("shipping").length).toBe(1);
    // Workbooks must still read (xlsx intact, not corrupted/renamed).
    for (const f of corpusFiles("specs")) {
      expect(readGrids("specs", f).length).toBeGreaterThan(0);
    }
  });
});
