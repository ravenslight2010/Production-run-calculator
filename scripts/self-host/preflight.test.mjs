import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inspectPreflight, parseArguments } from "./preflight.mjs";
import { SOURCE_LIBRARY_POOL_APPROVAL_ASSETS } from "../src/source-library-pool-approval-assets.mjs";
import {
  REPORT_DIRECTORY,
  REPORT_BASENAME,
  REVIEWED_REPORT_SHA256,
} from "./reviewed-input-contract.mjs";
import { REVIEWED_REPORT_SHA256 as canonicalPin } from "../src/restore-reviewed-build-inputs.mjs";
const marker = "PRIVATE_FIXTURE_VALUES_MUST_NEVER_BE_PRINTED";
const report = JSON.stringify({ syntheticUnitFixture: marker });
const digest = createHash("sha256").update(report).digest("hex");
const setup = {
  site: "runcalc.test.lan",
  timeZone: "America/Chicago",
  manager: "testmanager",
};
function fixture(run) {
  const root = mkdtempSync(path.join(tmpdir(), "selfhost-preflight-"));
  const put = (name, value) => {
    const file = path.join(root, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, value);
  };
  for (const name of [
    "artifacts/api-server/src",
    "artifacts/run-calculator/src",
    "scripts/src",
    "lib",
  ])
    mkdirSync(path.join(root, name), { recursive: true });
  for (const name of [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    ...SOURCE_LIBRARY_POOL_APPROVAL_ASSETS,
  ])
    put(name, "{}");
  put(".nvmrc", "24.21.0");
  put(`${REPORT_DIRECTORY}/${REPORT_BASENAME}.json`, report);
  put(`${REPORT_DIRECTORY}/${REPORT_BASENAME}.sha256`, digest + "\n");
  try {
    return run(root, put);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
const inspect = (root, extra = {}) =>
  inspectPreflight(root, {
    runtimeVersion: "24.21.0",
    expectedReportSha256: digest,
    ...extra,
  });
test("canonical report pin is reused, not copied or relaxed", () =>
  assert.equal(REVIEWED_REPORT_SHA256, canonicalPin));
test("synthetic fixture with prerequisites is ready but never deployment approval", () =>
  fixture((root) => {
    const result = inspect(root, { setup });
    assert.equal(result.status, "ready");
    assert.equal(result.productionReadiness, "not-assessed");
    assert.equal(result.scope, "build-prerequisites-only");
    assert.ok(!JSON.stringify(result).includes(marker));
  }));
test("production default rejects synthetic fixture digest", () =>
  fixture((root) => {
    const result = inspectPreflight(root, { runtimeVersion: "24.21.0" });
    assert.equal(result.status, "blocked");
    assert.ok(
      result.checks.some((c) => c.code === "reviewed-report-invalid-or-unsafe"),
    );
  }));
test("missing report is classified without creating files", () =>
  fixture((root) => {
    const file = path.join(root, `${REPORT_DIRECTORY}/${REPORT_BASENAME}.json`);
    rmSync(file);
    const before = JSON.stringify(inspect(root));
    assert.ok(before.includes("approved-private-report-missing"));
    assert.ok(!before.includes(root) && !before.includes(marker));
    assert.throws(() => readFileSync(file), { code: "ENOENT" });
  }));
test("corrupt or mismatched report never becomes ready", () =>
  fixture((root, put) => {
    put(`${REPORT_DIRECTORY}/${REPORT_BASENAME}.json`, "corrupt");
    assert.equal(inspect(root).status, "blocked");
    put(`${REPORT_DIRECTORY}/${REPORT_BASENAME}.json`, report);
    put(`${REPORT_DIRECTORY}/${REPORT_BASENAME}.sha256`, "a".repeat(64));
    assert.equal(inspect(root).status, "blocked");
  }));
test("oversized report is blocked without exposing bytes", () =>
  fixture((root, put) => {
    put(
      `${REPORT_DIRECTORY}/${REPORT_BASENAME}.json`,
      marker + "x".repeat(1024 * 1024),
    );
    const x = inspect(root);
    assert.equal(x.status, "blocked");
    assert.ok(!JSON.stringify(x).includes(marker));
  }));
test("missing general source prerequisites block even when reviewed report is valid", () =>
  fixture((root) => {
    rmSync(path.join(root, "package.json"));
    const x = inspect(root);
    assert.equal(x.status, "blocked");
    assert.ok(
      x.checks.some((c) => c.code === "source-prerequisites-missing-or-unsafe"),
    );
  }));
test("exact node pin required; never print attacker-controlled pin", () =>
  fixture((root, put) => {
    assert.equal(
      inspect(root, { runtimeVersion: "24.22.1" }).status,
      "blocked",
    );
    put(".nvmrc", marker);
    const x = inspect(root);
    assert.equal(x.status, "blocked");
    assert.ok(!JSON.stringify(x).includes(marker));
  }));
for (const bad of [
  { site: "bad\nTOKEN=" + marker },
  { timeZone: "Mars/Factory" },
  { manager: marker + "\nBAD=yes" },
]) {
  test(
    "invalid setup is classified before setup effects: " + Object.keys(bad)[0],
    () =>
      fixture((root) => {
        const x = inspect(root, { setup: { ...setup, ...bad } });
        assert.equal(x.status, "blocked");
        assert.ok(
          x.checks.some((c) => c.code === "invalid-site-timezone-or-manager"),
        );
        assert.ok(!JSON.stringify(x).includes(marker));
      }),
  );
}
test("unavailable root is a bounded blocked result", () => {
  const x = inspectPreflight("/this-preflight-fixture-does-not-exist");
  assert.equal(x.status, "blocked");
  assert.equal(x.checks.length, 1);
});
test("strict CLI accepts complete optional setup only", () => {
  assert.equal(parseArguments(["--root", "checkout"]).root, "checkout");
  assert.equal(
    parseArguments([
      "--root",
      "checkout",
      "--site",
      setup.site,
      "--time-zone",
      setup.timeZone,
      "--manager",
      setup.manager,
    ]).setup.manager,
    setup.manager,
  );
  for (const args of [
    [],
    ["--root"],
    ["--root", "a", "--root", "b"],
    ["--root", "a", "--site", "a"],
    ["--root", "a", "--expected-hash", digest],
    ["--root", "a", "--unknown", marker],
  ])
    assert.throws(() => parseArguments(args));
});
test("real CLI cannot override pin, echo private values, or create state", () =>
  fixture((root) => {
    const cli = fileURLToPath(new URL("./preflight.mjs", import.meta.url));
    const result = spawnSync(process.execPath, [cli, "--root", root], {
      encoding: "utf8",
      env: { ...process.env, STAFF_SIGNUP_CODE: marker },
    });
    assert.equal(result.status, 2);
    const x = JSON.parse(result.stdout);
    assert.equal(x.status, "blocked");
    assert.ok(!(result.stdout + result.stderr).includes(marker));
    const bad = spawnSync(
      process.execPath,
      [cli, "--root", root, "--expected-hash", marker],
      { encoding: "utf8" },
    );
    assert.equal(bad.status, 2);
    assert.ok(!(bad.stdout + bad.stderr).includes(marker));
  }));
test(
  "report and root symlinks fail closed",
  {
    skip:
      process.platform === "win32"
        ? "Windows symlink creation requires privileges; native no-mutation launcher check runs in CI instead"
        : false,
  },
  () =>
    fixture((root) => {
      const file = path.join(
          root,
          `${REPORT_DIRECTORY}/${REPORT_BASENAME}.json`,
        ),
        target = path.join(root, "private-target.json");
      writeFileSync(target, report);
      rmSync(file);
      symlinkSync(target, file);
      assert.equal(inspect(root).status, "blocked");
      const link = root + "-link";
      symlinkSync(root, link, "dir");
      try {
        assert.equal(inspect(link).status, "blocked");
      } finally {
        rmSync(link);
      }
    }),
);
test("Windows launcher gates fresh setup before all mutations, not cached restarts", () => {
  const text = readFileSync(
    new URL("./Start-SelfHost.ps1", import.meta.url),
    "utf8",
  );
  assert.ok(text.includes("$PSNativeCommandUseErrorActionPreference = $false"));
  assert.ok(text.includes("if ($LASTEXITCODE -ne 0)"));
  const position = text.indexOf("Invoke-Checked 'node' $preflight");
  for (const token of [
    "New-Item -ItemType Directory",
    "Set-Acl -LiteralPath",
    "'config.mjs'",
    "'pull', 'db'",
  ])
    assert.ok(position >= 0 && position < text.indexOf(token), token);
  const gate = text.indexOf("if ($InitializeFresh -or $CheckOnly)");
  assert.ok(gate >= 0 && gate < position);
  assert.ok(
    text
      .slice(position, text.indexOf("Invoke-Checked 'docker'", position))
      .includes("return"),
  );
});
test("explicit fresh profile omits legacy audit but still requires complete sealed-source inputs", () =>
  fixture((root, put) => {
    for (const name of [
      ".dockerignore",
      "Dockerfile",
      "Dockerfile.self-host",
      "Dockerfile.self-host.dockerignore",
      "docker-compose.self-host.yml",
      "docker/Caddyfile.self-host",
      "scripts/self-host/Start-SelfHost.ps1",
    ])
      put(name, "synthetic fixture");
    rmSync(path.join(root, REPORT_DIRECTORY), { recursive: true, force: true });
    const result = inspect(root, { profile: "self-host-fresh", setup });
    assert.equal(result.status, "ready");
    assert.equal(result.profile, "self-host-fresh");
    assert.ok(
      result.checks.some(
        (c) =>
          c.status === "not-applicable" &&
          c.code === "legacy-audit-not-packaged",
      ),
    );
    assert.equal(inspect(root, { setup }).status, "blocked");
    rmSync(path.join(root, "Dockerfile.self-host"));
    assert.equal(
      inspect(root, { profile: "self-host-fresh", setup }).status,
      "blocked",
    );
  }));
test("unsupported profiles cannot disable preflight checks", () =>
  fixture((root) => {
    assert.equal(inspect(root, { profile: "skip" }).status, "blocked");
    assert.throws(() => parseArguments(["--root", root, "--profile", "skip"]));
    assert.equal(parseArguments(["--root", root]).profile, "production");
    assert.equal(
      parseArguments(["--root", root, "--profile", "self-host-fresh"]).profile,
      "self-host-fresh",
    );
  }));
