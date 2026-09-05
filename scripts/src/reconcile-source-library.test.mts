import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { reconcileSnapshot } from "./reconcile-source-library.mts";

const manifest: any = {
  sha256: "manifest", retained: [], excludedOlderDuplicates: [],
};
// Empty manifests deliberately produce no source-derived writes; this fixture
// still proves duplicate/live-only findings are read-only and deterministic.
const snapshot: any = {
  capturedAt: "2026-08-26T00:00:00.000Z",
  tables: {
    dough_recipes: { rows: [{ id: "dough:1", name: "Dough", components: [{ ingredient: "Flour", lbs: 0 }] }, { id: "dough:2", name: " dough ", components: [{ ingredient: "Flour", lbs: 0 }] }] },
    sauce_recipes: { rows: [] }, cheese_recipes: { rows: [] }, mixes: { rows: [] },
  },
};
const report = reconcileSnapshot(snapshot, manifest);
assert.equal(report.proposals.length, 0);
assert.equal((report.findings.allZeroStubs as unknown[]).length, 2);
assert.equal((report.findings.duplicateRecipes as Array<any>)[0].table, "dough_recipes");
assert.deepEqual(report.safeguards.length, 3);

const retained = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "..", "attached_assets/source-library/audits/source-library-reconciliation-2026-08-26.json"), "utf8"));
const replacements = retained.proposals.filter((proposal: any) => proposal.action === "replace-components-from-approved-source");
assert.ok(replacements.length > 0);
for (const proposal of replacements) {
  assert.equal(proposal.after.id, proposal.before.id);
  assert.equal(proposal.after.name, proposal.before.name);
  assert.ok(Array.isArray(proposal.after.components));
  if (proposal.table === "dough_recipes") {
    assert.ok(Array.isArray(proposal.after.doughballVariants));
    assert.ok("doughballWeightOz" in proposal.after);
  } else if (proposal.table === "cheese_recipes") {
    for (const field of ["brand", "flavors", "shredderSetting", "cellulose", "notes"]) assert.ok(field in proposal.after);
  } else if (proposal.table === "mixes") {
    for (const field of ["brand", "flavor", "daysEarly", "batchSize"]) assert.ok(field in proposal.after);
  }
}
const zeroStubs = retained.findings.allZeroStubs;
assert.equal(zeroStubs.length, 3);
for (const stub of zeroStubs) {
  assert.ok(stub.canonicalId, `expected canonical ID for ${stub.id}`);
  assert.ok(stub.canonicalName, `expected canonical name for ${stub.id}`);
  assert.equal(stub.deletionCandidate, "blocked-until-reference-repoint-and-history-preservation-checks");
}
console.log("Source library reconciliation tests passed.");