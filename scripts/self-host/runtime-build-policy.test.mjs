import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import {
  assertFreshRuntimeGraph,
  freshRuntimePlugin,
  FRESH_RUNTIME_BUILD_CONTRACT,
} from "./runtime-build-policy.mjs";
const root = path.resolve("synthetic-root");
const graph = (files) => ({
  inputs: Object.fromEntries(files.map((file) => [file, {}])),
});
test("fresh graph allows sealed authored sources and dependency code only", () => {
  assert.doesNotThrow(() =>
    assertFreshRuntimeGraph(
      root,
      graph([
        "artifacts/api-server/src/selfHostFresh/buildInfo.ts",
        "lib/db/src/index.ts",
        "scripts/self-host/build-identity.mjs",
        "node_modules/.pnpm/pino/index.js",
      ]),
    ),
  );
  assert.deepEqual(FRESH_RUNTIME_BUILD_CONTRACT, {
    schemaVersion: 1,
    buildProfile: "self-host-fresh",
    legacyRepairAuthority: "unavailable",
    historicalAudit: "not-packaged",
  });
});
for (const file of [
  "artifacts/api-server/src/lib/dataHeals.ts",
  "artifacts/api-server/src/lib/buildInfo.ts",
  "artifacts/api-server/src/lib/sourceLibraryReconciliationHeal.ts",
  "artifacts/api-server/src/lib/sourceLibraryReconciliationCapture.ts",
  "artifacts/api-server/src/lib/sourceLibraryReconciliationPlan.generated.ts",
  "artifacts/api-server/src/lib/repairs/arbitraryFutureRepair.ts",
  "artifacts/api-server/src/lib/repairDefinitionFingerprint.ts",
  "artifacts/api-server/src/routes/sourceLibraryReconciliationCapture.ts",
  "scripts/src/source-library-reconciliation-capture-core.mjs",
  "scripts/src/source-library-approval-bundle.mts",
]) {
  test("historical module cannot enter fresh graph: " + file, () =>
    assert.throws(
      () => assertFreshRuntimeGraph(root, graph([file])),
      /Historical/,
    ),
  );
}
for (const file of [
  "attached_assets/private.json",
  "docs/evidence/private.json",
  "lib/math/fixtures/customer.json",
  "../outside/private.js",
  "artifacts/api-server/publish-source-record.json",
]) {
  test("unsealed authored input cannot enter fresh graph: " + file, () =>
    assert.throws(
      () => assertFreshRuntimeGraph(root, graph([file])),
      /Unsealed/,
    ),
  );
}
test("fresh plugin aliases only exact authored modules and denies direct legacy loading", () => {
  let resolve, load;
  freshRuntimePlugin(root).setup({
    onResolve: (_filter, fn) => {
      resolve = fn;
    },
    onLoad: (_filter, fn) => {
      load = fn;
    },
  });
  const source = path.join(root, "artifacts/api-server/src");
  assert.equal(
    resolve({
      resolveDir: path.join(source, "routes"),
      path: "../lib/buildInfo",
    }).path,
    path.join(source, "selfHostFresh/buildInfo.ts"),
  );
  assert.equal(
    resolve({ resolveDir: root, path: "./other/buildInfo.ts" }),
    null,
  );
  assert.equal(
    load({ path: path.join(source, "lib/repairs/newRepair.ts") }).errors.length,
    1,
  );
  assert.equal(
    load({ path: path.join(source, "selfHostFresh/buildInfo.ts") }),
    null,
  );
});
