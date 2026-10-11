import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const launcher = "bash scripts/src/run-release-node.sh ";

test("every Replit validation command selects Node before launching children", () => {
  const config = fs.readFileSync(path.join(root, ".replit"), "utf8");
  const sections = config.split("[[workflows.workflow]]").slice(1);
  let checked = 0;
  for (const section of sections) {
    const name = section.match(/^name = "([^"]+)"/m)?.[1];
    if (name === "Project") continue;
    const command = section.match(/^args = "([^"]+)"$/m)?.[1];
    assert.ok(command, `${name}: missing shell command`);
    assert.ok(command.startsWith(launcher), `${name}: must select pinned Node first`);
    checked++;
  }
  assert.ok(checked >= 18, "expected all Replit validation entry points");
});

test("post-merge selects Node before Corepack and package scripts", () => {
  const hook = fs.readFileSync(path.join(root, "scripts/post-merge.sh"), "utf8");
  const reentry = hook.indexOf("exec bash scripts/src/run-release-node.sh");
  const preflight = hook.indexOf("node scripts/src/check-routine-node-version.mjs");
  const stop = hook.indexOf("node scripts/src/stop-artifact-workflows.mjs");
  const corepack = hook.indexOf("corepack enable");
  const install = hook.indexOf("CI=true pnpm install");
  assert.ok(reentry > 0 && preflight > reentry && stop > preflight);
  assert.ok(corepack > stop && install > corepack);
});