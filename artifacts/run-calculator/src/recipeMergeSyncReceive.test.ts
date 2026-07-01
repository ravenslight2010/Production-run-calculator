// @vitest-environment jsdom
//
// End-to-end sync-receive regression guard for the recipe-name merge. A merge
// re-points per-run recipe-name selections, advances those runs' edit stamps,
// tombstones the merged-away name, and folds its recipe-preset KEY. A stale peer
// that hasn't seen the merge could still push the pre-merge selection (at an old
// stamp) and the folded-away preset key. Two receive-side guards must survive:
//   1. The per-run lost-update loop must NOT overwrite a merged selection with a
//      stale remote value (the merge's stamp bump makes localTs > remoteTs).
//   2. The additive recipe-preset union must NOT resurrect the folded-away key
//      (dropTombstonedPresetKeys drops it via the merged deletion tombstones).
//
// The web receive handler is inline in pages/home.tsx and not importable, so its
// two merge-critical operations were extracted into importable pure helpers
// (`acceptRemoteRunValueOnSync`, `dropTombstonedPresetKeys`). This test drives
// the REAL merge (applyRecipeNameMerge) + REAL storage primitives + those
// extracted helpers exactly as the receive handler wires them, so a future
// refactor that breaks either guard fails here.

import { describe, it, expect, beforeEach } from "vitest";
import {
  applyRecipeNameMerge,
  saveRunValues,
  loadRunValues,
  loadRunValuesUpdated,
  saveRunValuesUpdated,
  saveDoughRecipePresets,
  loadDoughRecipePresets,
  loadDeletedItems,
  unionDeletedItems,
  acceptRemoteRunValueOnSync,
  dropTombstonedPresetKeys,
} from "./storage";
import {
  DEFAULT_VALUES,
  DOUGH_RECIPE_NAMES_KEY,
  type FormValues,
} from "./types";

const run = (doughRecipeName: string): FormValues => ({ ...DEFAULT_VALUES, doughRecipeName });

// Reproduce the two merge-critical operations of the home.tsx sync-receive
// handler, wired exactly as it wires them (see pages/home.tsx). `payload` is a
// stale peer's incoming sync body.
function receiveSync(payload: {
  runValues: Record<string, FormValues>;
  runValuesUpdatedAt: Record<string, number>;
  doughRecipePresets?: Record<string, unknown>;
  deletedItems?: Record<string, string[]>;
}) {
  // Deletion tombstones: union remote + local (the local merge tombstone must
  // survive even though the stale peer doesn't carry it).
  const deletedMap = unionDeletedItems(loadDeletedItems(), payload.deletedItems);

  // Per-run lost-update loop.
  const localUpd = loadRunValuesUpdated();
  const mergedUpd: Record<string, number> = { ...localUpd };
  for (const [id, vals] of Object.entries(payload.runValues)) {
    const rTs = payload.runValuesUpdatedAt[id] ?? 0;
    const lTs = localUpd[id] ?? 0;
    const localVals = loadRunValues(id);
    if (!acceptRemoteRunValueOnSync(vals, localVals, rTs, lTs)) {
      rejectedStaleAdvance(mergedUpd, id, vals, localVals);
      continue;
    }
    saveRunValues(id, vals);
    if (rTs > lTs) mergedUpd[id] = rTs;
  }
  saveRunValuesUpdated(mergedUpd);

  // Recipe-preset additive union, tombstoned keys dropped.
  if (payload.doughRecipePresets && Object.keys(payload.doughRecipePresets).length > 0) {
    const merged = { ...loadDoughRecipePresets(), ...(payload.doughRecipePresets as any) };
    saveDoughRecipePresets(dropTombstonedPresetKeys(merged, deletedMap, "doughRecipeNames"));
  }
}

function rejectedStaleAdvance(
  mergedUpd: Record<string, number>,
  id: string,
  remote: FormValues,
  local: FormValues,
) {
  // Mirrors the handler: only advance the stamp for the empty-over-populated
  // heal case, not for a fresher-local-edit reject.
  const isEmptyOverPopulated =
    JSON.stringify(remote) === JSON.stringify(DEFAULT_VALUES) &&
    JSON.stringify(local) !== JSON.stringify(DEFAULT_VALUES);
  if (isEmptyOverPopulated) mergedUpd[id] = Date.now();
}

beforeEach(() => {
  localStorage.clear();
});

describe("recipe-name merge survives a stale incoming sync (receive path)", () => {
  it("does not resurrect a folded-away preset key or overwrite re-pointed run selections", () => {
    // Local device: two runs point at the soon-merged-away name, one at the
    // target. All at stamp 0 (unedited/imported — the vulnerable case).
    saveRunValues("a", run("Old Dough"));
    saveRunValues("b", run("Old Dough"));
    saveRunValues("c", run("Keep Dough"));
    localStorage.setItem(
      DOUGH_RECIPE_NAMES_KEY,
      JSON.stringify(["Keep Dough", "Old Dough"]),
    );
    saveDoughRecipePresets({
      "Keep Dough": { rows: [{ ingredient: "Flour", lbs: 100 }] },
      "Old Dough": { rows: [{ ingredient: "Flour", lbs: 999 }] },
    });

    // Perform the merge (real code): re-points a,b; tombstones "old dough";
    // folds the "Old Dough" preset key.
    const affected = applyRecipeNameMerge("dough", { "Old Dough": "Keep Dough" });
    expect(affected.sort()).toEqual(["a", "b"]);

    // Merge handler (home.tsx) advances the re-pointed runs' edit stamps so the
    // push strictly wins the per-run guard everywhere.
    const stamp = Date.now();
    const upd = loadRunValuesUpdated();
    for (const id of affected) upd[id] = stamp;
    saveRunValuesUpdated(upd);

    // A stale peer that never saw the merge pushes the PRE-merge selection at
    // stamp 0, plus the folded-away preset key, and no tombstone.
    receiveSync({
      runValues: { a: run("Old Dough"), b: run("Old Dough"), c: run("Keep Dough") },
      runValuesUpdatedAt: { a: 0, b: 0, c: 0 },
      doughRecipePresets: {
        "Old Dough": { rows: [{ ingredient: "Flour", lbs: 999 }] },
        "Keep Dough": { rows: [{ ingredient: "Flour", lbs: 100 }] },
      },
      deletedItems: {},
    });

    // Guard 1: re-pointed selections are NOT overwritten by the stale payload.
    expect(loadRunValues("a").doughRecipeName).toBe("Keep Dough");
    expect(loadRunValues("b").doughRecipeName).toBe("Keep Dough");

    // Guard 2: the folded-away preset key is NOT resurrected; target survives.
    const presets = loadDoughRecipePresets();
    expect(Object.keys(presets)).not.toContain("Old Dough");
    expect(Object.keys(presets)).toContain("Keep Dough");

    // The local merge tombstone must still be present (union kept it).
    expect((loadDeletedItems()["doughRecipeNames"] ?? []).map((n) => n.toLowerCase()))
      .toContain("old dough");
  });

  it("still accepts a genuinely fresher remote edit (extraction didn't over-restrict LWW)", () => {
    // Sanity: normal last-writer-wins must keep working. A remote value with a
    // strictly newer stamp than local should overwrite.
    saveRunValues("a", run("Keep Dough"));
    saveRunValuesUpdated({ a: 100 });

    receiveSync({
      runValues: { a: run("Newer Dough") },
      runValuesUpdatedAt: { a: 200 },
    });

    expect(loadRunValues("a").doughRecipeName).toBe("Newer Dough");
    expect(loadRunValuesUpdated().a).toBe(200);
  });
});
