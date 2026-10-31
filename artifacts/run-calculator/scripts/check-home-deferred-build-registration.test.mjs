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

test("production build runs the emitted Home boundary checker after Vite", () => {
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
  const homeBoundaryCheckerIndex = buildCommands.indexOf(
    "node scripts/check-home-deferred-boundary.mjs",
  );

  assert.notEqual(viteBuildIndex, -1, "production build must invoke Vite");
  assert.notEqual(
    homeBoundaryCheckerIndex,
    -1,
    "production build must invoke the emitted Home boundary checker",
  );
  assert.ok(
    homeBoundaryCheckerIndex > viteBuildIndex,
    "Home boundary checker must run after Vite emits the production bundle",
  );
});
