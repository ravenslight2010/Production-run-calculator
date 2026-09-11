import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reconcileSnapshot } from "./reconcile-source-library.mts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tsx = path.join(repositoryRoot, "scripts/node_modules/.bin/tsx");

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

function testRepositoryRootDefaultInputs() {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "source-reconciliation-cli-"));
  try {
    const outputPath = path.join(outputRoot, "reconciliation.json");
    const stdout = execFileSync(
      tsx,
      [path.join(repositoryRoot, "scripts/src/reconcile-source-library.mts"), "--out", outputPath],
      { cwd: repositoryRoot, encoding: "utf8" },
    );
    assert.match(stdout, /^Wrote .+\.json\n$/);

    const generated = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    const checkedIn = JSON.parse(fs.readFileSync(
      path.join(repositoryRoot, "attached_assets/source-library/audits/source-library-reconciliation-2026-08-26.json"),
      "utf8",
    ));
    assert.equal(generated.format, checkedIn.format);
    assert.equal(generated.formatVersion, checkedIn.formatVersion);
    assert.deepEqual(generated.snapshot, checkedIn.snapshot);
    assert.deepEqual(generated.manifest, checkedIn.manifest);
    assert.equal(generated.proposals.length, checkedIn.proposals.length);
    const findingCounts = (report: Record<string, any>) =>
      Object.fromEntries(Object.entries(report.findings).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.length : -1,
      ]));
    assert.deepEqual(findingCounts(generated), findingCounts(checkedIn));
    assert.ok(fs.existsSync(outputPath.replace(/\.json$/u, ".md")));
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
}

testRepositoryRootDefaultInputs();
console.log("Source library reconciliation tests passed.");