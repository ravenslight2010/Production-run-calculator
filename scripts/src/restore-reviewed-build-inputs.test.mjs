import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync,
  symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import test from "node:test";
import {
  cleanupReviewedBuildInputs, decodeReviewedReport, INPUT_SECRET_NAME,
  REPORT_BASENAME, REPORT_DIRECTORY, restoreReviewedBuildInputs,
  restoreReviewedBuildInputsFromDirectory,
} from "./restore-reviewed-build-inputs.mjs";

const fixture = Buffer.from('{"fixture":"synthetic reviewed report"}\n');
const hash = createHash("sha256").update(fixture).digest("hex");
const encoded = gzipSync(fixture).toString("base64");
function temporaryRoot(t) {
  const root = mkdtempSync(path.join(tmpdir(), "reviewed-input-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("restores exact verified bytes and checksum with restrictive permissions, idempotently", (t) => {
  const root = temporaryRoot(t);
  restoreReviewedBuildInputs(root, encoded, hash);
  restoreReviewedBuildInputs(root, encoded, hash);
  const report = path.join(root, REPORT_DIRECTORY, `${REPORT_BASENAME}.json`);
  assert.deepEqual(readFileSync(report), fixture);
  assert.equal(readFileSync(report.replace(/json$/, "sha256"), "utf8"), `${hash}\n`);
  assert.equal(lstatSync(report).mode & 0o777, 0o600);
});

test("missing, corrupt, oversized, and noncanonical inputs fail before writing files", (t) => {
  const root = temporaryRoot(t);
  for (const value of [undefined, "", "bad\nbase64", "A".repeat(48_004), "eA==", "YR=="]) {
    assert.throws(() => restoreReviewedBuildInputs(root, value, hash));
  }
  assert.throws(() => restoreReviewedBuildInputs(root, encoded, "0".repeat(64)), /SHA-256/);
  assert.equal(existsSync(path.join(root, "attached_assets")), false);
});

test("decompression has a hard output limit", () => {
  const bomb = gzipSync(Buffer.alloc(1024 * 1024 + 1)).toString("base64");
  assert.throws(() => decodeReviewedReport(bomb, hash), /budget/);
});

test("existing different bytes and symlinked files are not overwritten", (t) => {
  const root = temporaryRoot(t);
  const dir = path.join(root, REPORT_DIRECTORY);
  mkdirSync(dir, { recursive: true });
  const report = path.join(dir, `${REPORT_BASENAME}.json`);
  writeFileSync(report, "keep-original");
  assert.throws(() => restoreReviewedBuildInputs(root, encoded, hash), /Existing/);
  assert.equal(readFileSync(report, "utf8"), "keep-original");
  rmSync(report);
  const target = path.join(root, "outside.json");
  writeFileSync(target, fixture);
  symlinkSync(target, report);
  assert.throws(() => restoreReviewedBuildInputs(root, encoded, hash), /Existing/);
  assert.deepEqual(readFileSync(target), fixture);
});

test("symlinked ancestor directories cannot redirect report writes", (t) => {
  const root = temporaryRoot(t);
  const outside = temporaryRoot(t);
  symlinkSync(outside, path.join(root, "attached_assets"));
  assert.throws(() => restoreReviewedBuildInputs(root, encoded, hash), /symlinks/);
  assert.equal(existsSync(path.join(outside, "source-library")), false);
});

test("cleanup is narrowly scoped and will not delete unreviewed bytes", (t) => {
  const root = temporaryRoot(t);
  cleanupReviewedBuildInputs(root);
  restoreReviewedBuildInputs(root, encoded, hash);
  const report = path.join(root, REPORT_DIRECTORY, `${REPORT_BASENAME}.json`);
  assert.throws(() => cleanupReviewedBuildInputs(root), /differs from reviewed bytes/);
  assert.deepEqual(readFileSync(report), fixture);
});

test("CLI cannot override its reviewed hash and never echoes rejected input", (t) => {
  const root = temporaryRoot(t);
  const cli = fileURLToPath(new URL("./restore-reviewed-build-inputs.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [cli], {
    cwd: root, encoding: "utf8",
    env: { ...process.env, [INPUT_SECRET_NAME]: encoded, REVIEWED_REPORT_SHA256: hash },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /reviewed SHA-256/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(encoded));
  assert.equal(existsSync(path.join(root, "attached_assets")), false);
});

test("workflow isolates secrets from PR code and retains all browser cases", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/docker-caddy-browser.yml", import.meta.url), "utf8");
  assert.match(workflow, /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: docker-caddy-reviewed-inputs/);
  assert.doesNotMatch(workflow, /pull_request_target/);
  assert.match(workflow, /SOURCE_LIBRARY_RECONCILIATION_GZIP_BASE64: \$\{\{ secrets\.SOURCE_LIBRARY_RECONCILIATION_GZIP_BASE64 \}\}/);
  assert.match(workflow, /if: always\(\)[\s\S]*restore-reviewed-build-inputs\.mjs --cleanup/);
  assert.match(workflow, /run test:e2e:docker-caddy/);
  const config = readFileSync(new URL("../../artifacts/run-calculator/playwright.docker-caddy.config.ts", import.meta.url), "utf8");
  assert.match(config, /chromium/);
  assert.match(config, /webkit/);
});

function inputDirectory(t) {
  const source = temporaryRoot(t);
  writeFileSync(path.join(source, `${REPORT_BASENAME}.json`), fixture);
  writeFileSync(path.join(source, `${REPORT_BASENAME}.sha256`), `${hash}\n`);
  return source;
}

test("offline directory delivery preserves exact bytes and restrictive modes, without needing a secret", (t) => {
  const root = temporaryRoot(t);
  const source = inputDirectory(t);
  restoreReviewedBuildInputsFromDirectory(root, source, hash);
  restoreReviewedBuildInputsFromDirectory(root, source, hash);
  const report = path.join(root, REPORT_DIRECTORY, `${REPORT_BASENAME}.json`);
  assert.deepEqual(readFileSync(report), fixture);
  assert.equal(lstatSync(report).mode & 0o777, 0o600);
  assert.deepEqual(readFileSync(report.replace(/json$/, "sha256")), Buffer.from(`${hash}\n`));
});

for (const variation of ["report", "checksum", "oversized", "symlink"]) {
  test(`offline directory rejects ${variation} before materializing any input`, (t) => {
    const root = temporaryRoot(t);
    const source = inputDirectory(t);
    const file = path.join(source, `${REPORT_BASENAME}.${variation === "checksum" ? "sha256" : "json"}`);
    if (variation === "symlink") {
      rmSync(file);
      symlinkSync(path.join(source, `${REPORT_BASENAME}.sha256`), file);
    } else if (variation === "oversized") writeFileSync(file, Buffer.alloc(1024 * 1024 + 1));
    else writeFileSync(file, "not approved");
    assert.throws(() => restoreReviewedBuildInputsFromDirectory(root, source, hash));
    assert.equal(existsSync(path.join(root, "attached_assets")), false);
  });
}

test("offline CLI cannot override the production pin or expose source paths and contents", (t) => {
  const root = temporaryRoot(t);
  const source = inputDirectory(t);
  const cli = fileURLToPath(new URL("./restore-reviewed-build-inputs.mjs", import.meta.url));
  for (const input of [source, path.join(source, "private-missing-directory")]) {
    const result = spawnSync(process.execPath, [cli, "--from-directory", input], {
      cwd: root, encoding: "utf8",
      env: { ...process.env, REVIEWED_REPORT_SHA256: hash },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /reviewed SHA-256/);
    assert.ok(!`${result.stdout}${result.stderr}`.includes(source));
    assert.ok(!`${result.stdout}${result.stderr}`.includes(fixture.toString()));
  }
});

test("all newly wired CI consumers keep private delivery main-only, with no lost checks", () => {
  const consumers = [
    ["ci.yml", ["typecheck", "reduced-motion-browser", "test-db", "build"]],
    ["department-navigation.yml", ["department-navigation"]],
    ["release-check.yml", ["release-check-standard", "release-check-full"]],
  ];
  const guard = "github.ref == 'refs/heads/main' && github.event_name != 'pull_request'";
  for (const [file, jobs] of consumers) {
    const workflow = readFileSync(new URL(`../../.github/workflows/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(workflow, /pull_request_target/);
    for (const job of jobs) {
      const section = workflow.match(new RegExp(`^  ${job}:\\n[\\s\\S]*?(?=^  [a-zA-Z][\\w-]*:|$(?![\\s\\S]))`, "m"))?.[0];
      assert.ok(section, `${file}/${job} must remain present`);
      assert.ok(section.includes(`environment: \${{ ${guard} && 'docker-caddy-reviewed-inputs' || 'unprivileged-ci' }}`));
      const restore = section.indexOf("      - name: Restore protected main build inputs");
      assert.ok(restore >= 0);
      const nextStep = section.indexOf("\n      - ", restore + 1);
      const step = section.slice(restore, nextStep < 0 ? undefined : nextStep);
      assert.ok(step.includes(`if: ${guard}`));
      assert.ok(step.includes("SOURCE_LIBRARY_RECONCILIATION_GZIP_BASE64: ${{ secrets.SOURCE_LIBRARY_RECONCILIATION_GZIP_BASE64 }}"));
      assert.match(step, /run: node scripts\/src\/restore-reviewed-build-inputs\.mjs(?:\n|$)/);
      assert.match(section, /if: always\(\) && steps\.reviewed-inputs\.outcome != 'skipped'\s+run: node scripts\/src\/restore-reviewed-build-inputs\.mjs --cleanup/);
      assert.equal(section.match(/secrets\.SOURCE_LIBRARY_RECONCILIATION_GZIP_BASE64/g)?.length, 1);
      const header = section.slice(0, section.indexOf("    steps:"));
      if (job === "release-check-full")
        assert.match(header, /if:.*github\.event_name.*workflow_dispatch.*inputs\.run_full/);
      else assert.ok(!header.includes("\n    if:"), "existing job must not be disabled for PRs");
    }
  }
});
