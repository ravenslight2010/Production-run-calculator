import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const bootstrap = path.join(root, "scripts/coding-assistant/bootstrap-local.mjs");
const fixture = path.join(
  root,
  "docs/coding-assistant/fixtures/host-report-candidate-7b.json",
);

test("bootstrap --fixture renders a read-only profile to --out", () => {
  assert.equal(existsSync(fixture), true);
  const dir = mkdtempSync(path.join(tmpdir(), "coding-assistant-"));
  const out = path.join(dir, "opencode.local.json");
  try {
    const r = spawnSync(
      process.execPath,
      [bootstrap, "--fixture", "--out", out],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.equal(existsSync(out), true);
    const profile = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(profile.model, "plant-local/qwen2.5-coder:7b");
    assert.equal(profile.providers["plant-local"].settings.baseURL, "http://127.0.0.1:11434/v1");
    assert.equal(
      profile.permissions.some((rule) => rule.action === "edit" && rule.effect === "allow"),
      false,
    );
    assert.equal(
      profile.permissions.some((rule) => rule.action === "shell" && rule.effect === "allow"),
      false,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
