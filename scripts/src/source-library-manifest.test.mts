import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSourceLibraryManifest, normalizedWorkbookIdentity } from "./source-library-manifest.mts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tsx = path.join(repositoryRoot, "scripts/node_modules/.bin/tsx");

function testRepositoryRootDefaultInputs() {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "source-manifest-cli-"));
  try {
    const outputPath = path.join(outputRoot, "manifest.json");
    const stdout = execFileSync(
      tsx,
      [path.join(repositoryRoot, "scripts/src/source-library-manifest.mts"), "--out", outputPath],
      { cwd: repositoryRoot, encoding: "utf8" },
    );
    assert.match(stdout, /^Wrote .+: 49 retained, 0 excluded\n$/);

    const generated = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    const checkedIn = JSON.parse(fs.readFileSync(
      path.join(repositoryRoot, "attached_assets/source-library/audits/source-library-manifest-2026-08-26.json"),
      "utf8",
    ));
    assert.equal(generated.sha256, checkedIn.sha256);
    assert.equal(generated.root, checkedIn.root);
    assert.equal(generated.retained.length, checkedIn.retained.length);
    assert.equal(generated.excludedOlderDuplicates.length, checkedIn.excludedOlderDuplicates.length);
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "source-manifest-"));
try {
  fs.mkdirSync(path.join(root, "dough"));
  fs.writeFileSync(path.join(root, "dough", "Example_Dough_-_01_1000000000.xlsx"), "old");
  fs.writeFileSync(path.join(root, "dough", "Example_Dough_-_01_2000000000.xlsx"), "new");
  const manifest = buildSourceLibraryManifest(root);
  assert.equal(manifest.retained.length, 1);
  assert.equal(manifest.retained[0]?.path, "dough/Example_Dough_-_01_2000000000.xlsx");
  assert.equal(manifest.excludedOlderDuplicates[0]?.retainedPath, manifest.retained[0]?.path);
  assert.equal(manifest.retained[0]?.importer, "dough-workbook-import");
  assert.equal(normalizedWorkbookIdentity("dough/A_1_1234567890.xlsx"), normalizedWorkbookIdentity("dough/A_1_9999999999.xlsx"));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
testRepositoryRootDefaultInputs();
console.log("Source library manifest tests passed.");