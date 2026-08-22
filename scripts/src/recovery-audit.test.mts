import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { auditManifest, formatAudit, summarizeAudit, type RecoveryManifest } from "./recovery-audit.mts";

async function fixture(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "recovery-audit-"));
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, content);
  }
  return root;
}

const manifest = (intentionalDifference?: string): RecoveryManifest => ({
  version: 1,
  entries: [{
    id: "fixture",
    feature: "Fixture feature",
    files: ["src/feature.ts"],
    wiring: [{ file: "src/routes.ts", contains: "feature" }],
    contracts: [{ file: "contracts/openapi.yaml", contains: "/feature" }],
    tests: [{ file: "src/feature.test.ts", contains: "feature" }],
    ...(intentionalDifference ? { intentionalDifference } : {}),
  }],
});

async function run() {
  const root = await fixture({
    "src/feature.ts": "export const feature = true;",
    "src/routes.ts": "router.use(feature);",
    "contracts/openapi.yaml": "  /feature:",
    "src/feature.test.ts": "describe('feature', () => {});",
  });
  try {
    let result = await auditManifest(root, manifest());
    assert.equal(result[0].status, "pass");
    assert.deepEqual(summarizeAudit(result), { pass: 1, missing: 0, intentionalDifference: 0 });
    assert.match(formatAudit(result), /PASS fixture/);

    await rm(join(root, "contracts/openapi.yaml"));
    result = await auditManifest(root, manifest());
    assert.equal(result[0].status, "missing");
    assert.match(result[0].missing[0], /contract/);
    assert.equal(summarizeAudit(result).missing, 1);

    result = await auditManifest(root, manifest("The current implementation intentionally uses a different contract."));
    assert.equal(result[0].status, "intentional-difference");
    assert.match(formatAudit(result), /DIFFERENT fixture/);
    assert.equal(summarizeAudit(result).missing, 0);
    assert.equal(summarizeAudit(result).intentionalDifference, 1);
    console.log("Recovery audit tests passed (pass, missing, intentional difference).");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await run();