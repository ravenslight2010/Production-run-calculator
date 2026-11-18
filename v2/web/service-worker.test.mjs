import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const serviceWorkerPath = fileURLToPath(new URL("./service-worker.js", import.meta.url));

test("offline shell caches every approved setup-import module", async () => {
  const source = await readFile(serviceWorkerPath, "utf8");
  for (const path of [
    "/v2/web/setup-catalog.js",
    "/v2/core/setup-catalog-csv.mjs",
    "/v2/core/import-csv.mjs",
  ]) {
    assert.match(source, new RegExp(`["']${path.replaceAll(".", "\\.")}["']`, "u"), path);
  }
  assert.match(source, /fieldline-v2-shell-6/u);
});
