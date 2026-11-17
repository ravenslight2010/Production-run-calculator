import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_MANIFEST_PATH = path.resolve(SCRIPT_DIR, "../package.json");
const PACKAGE_MANIFEST = JSON.parse(
  fs.readFileSync(PACKAGE_MANIFEST_PATH, "utf8"),
);

test("production build runs emitted bundle checks after Vite", () => {
  const buildScript = PACKAGE_MANIFEST.scripts?.build;
  assert.equal(
    typeof buildScript,
    "string",
    "calculator package must define a production build script",
  );
  const buildCommands = buildScript.split(/\s*&&\s*/).map((command) => command.trim());
  const viteBuildIndex = buildCommands.findIndex((command) =>
    command.startsWith("vite build "),
  );
  const checkerCommands = [
    "node scripts/check-workbook-boundary.mjs",
    "node scripts/check-home-deferred-boundary.mjs",
    "node scripts/check-client-bundle-budget.mjs",
  ];

  assert.notEqual(viteBuildIndex, -1, "production build must invoke Vite");
  for (const checkerCommand of checkerCommands) {
    const checkerIndex = buildCommands.indexOf(checkerCommand);
    assert.notEqual(checkerIndex, -1, `production build must run ${checkerCommand}`);
    assert.ok(
      checkerIndex > viteBuildIndex,
      `${checkerCommand} must run after Vite emits the production bundle`,
    );
  }
});
