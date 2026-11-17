import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const START_SCRIPT = join(ROOT, "scripts/start-v2.sh");

function runStart(env) {
  return spawnSync("bash", [START_SCRIPT], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 5000,
  });
}

test("V2 startup refuses project-database mapping unless explicitly enabled", () => {
  const secretLikeUrl = "postgresql://not-a-real-credential@localhost/v2";
  const result = runStart({
    V2_DATABASE_URL: "",
    V2_USE_PROJECT_DATABASE: "",
    DATABASE_URL: secretLikeUrl,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /V2_DATABASE_URL is required/);
  assert.doesNotMatch(result.stdout + result.stderr, /not-a-real-credential/);
});

test("V2 startup maps the managed project URL only when explicitly enabled", () => {
  const temp = mkdtempSync(join(tmpdir(), "v2-start-script-test-"));
  const fakeBin = join(temp, "bin");
  const capture = join(temp, "invoked");
  mkdirSync(fakeBin);
  const fakeSupervisor = join(fakeBin, "process-compose");
  writeFileSync(fakeSupervisor, `#!/usr/bin/env bash
set -euo pipefail
[[ "\${V2_DATABASE_URL:-}" == "postgresql://test.invalid/v2" ]]
printf 'supervisor-started\\n' > "$CAPTURE_FILE"
printf 'supervisor started\\n'
`);
  chmodSync(fakeSupervisor, 0o700);

  try {
    const result = runStart({
      V2_DATABASE_URL: "",
      V2_USE_PROJECT_DATABASE: "true",
      DATABASE_URL: "postgresql://test.invalid/v2",
      CAPTURE_FILE: capture,
      PATH: `${fakeBin}:${process.env.PATH}`,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /supervisor started/);
    assert.doesNotMatch(result.stdout + result.stderr, /test\.invalid/);
    assert.ok((awaitFile(capture)).includes("supervisor-started"));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

function awaitFile(path) {
  return readFileSync(path, "utf8");
}
