import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSourceLibraryManifest, normalizedWorkbookIdentity } from "./source-library-manifest.mts";

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
console.log("Source library manifest tests passed.");