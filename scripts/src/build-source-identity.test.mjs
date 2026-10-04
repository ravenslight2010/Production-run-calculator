import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fingerprintSource, verifiedGitRevision } from "./build-source-files.mjs";
import {
  assertSourceUnchanged, buildInfoFromRecord, completeBuildStage, createSourceRecord,
  EXPECTED_RECORD_PATH, preparePublishSource, readBoundedJson, sealBuildIdentity,
  SOURCE_RECORD_PATH, sourceRecordDigest, validateBuildInfo, validateSourceRecord,
} from "./build-source-identity.mjs";
import { outputs, put, sourceFixture } from "./fixtures/build-identity-fixture.mjs";

const hash = (root) => fingerprintSource(root).sourceFingerprintSha256;

test("source fingerprint is independent of absolute location and file creation order", (t) => {
  const roots = [sourceFixture(t), sourceFixture(t)];
  for (const [index, root] of roots.entries()) {
    const names = ["alpha.ts", "beta.ts", "gamma.ts"];
    for (const name of index === 0 ? names : names.reverse())
      put(root, `lib/math/src/${name}`, `content for ${name}`);
  }
  assert.equal(hash(roots[0]), hash(roots[1]));
});

test("mutation property across each included source category and varied bytes", (t) => {
  const root = sourceFixture(t);
  const paths = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml",
    "artifacts/api-server/src/index.ts", "artifacts/run-calculator/src/main.ts",
    "artifacts/api-server/build.mjs", "artifacts/run-calculator/vite.config.ts",
    "lib/math/src/index.ts", "scripts/src/build.mjs", "artifacts/run-calculator/public/icon.svg"];
  for (const file of paths) {
    const original = readFileSync(path.join(root, file));
    const baseline = hash(root);
    for (const suffix of ["\0", "\n", "é", ":0:", "changed"]) {
      put(root, file, Buffer.concat([original, Buffer.from(suffix)]));
      assert.notEqual(hash(root), baseline, file);
      put(root, file, original);
      assert.equal(hash(root), baseline, file);
    }
  }
});

test("secrets, evidence, fixtures and generated output are excluded and not exposed", (t) => {
  const root = sourceFixture(t);
  const before = hash(root);
  for (const file of [".env", "artifacts/api-server/src/.env.local",
    "lib/math/node_modules/private.js", "lib/math/fixtures/customer.json",
    "scripts/src/build.test.mjs", "artifacts/api-server/dist/index.mjs",
    "artifacts/run-calculator/e2e/scenario.ts", "release-evidence/private.json",
    SOURCE_RECORD_PATH]) put(root, file, "synthetic-private-marker");
  assert.equal(hash(root), before);
  const record = createSourceRecord(root);
  assert(!JSON.stringify(record).includes("synthetic-private-marker"));
  assert(!JSON.stringify(record).includes(root));
});

test("untracked productive source changes identity and cannot acquire Git binding", (t) => {
  const root = sourceFixture(t);
  const before = hash(root);
  put(root, "artifacts/api-server/src/new.ts", "new source");
  assert.notEqual(hash(root), before);
  assert.equal(createSourceRecord(root).gitRevision, null);
});

test("missing required roots and escaping symlinks fail closed", (t) => {
  const root = sourceFixture(t);
  const outside = sourceFixture(t);
  symlinkSync(path.join(outside, "package.json"), path.join(root, "lib/math/src/escape.ts"));
  assert.throws(() => hash(root), /symlink/);
  rmSync(path.join(root, "lib/math/src/escape.ts"));
  rmSync(path.join(root, "artifacts/api-server/src"), { recursive: true });
  assert.throws(() => hash(root), /missing/);
});

test("Git binding is verified only for clean tracked build inputs; backup is never queried", (t) => {
  const root = sourceFixture(t);
  const git = (args) => execFileSync("git", args, {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000,
  });
  git(["init"]);
  git(["add", "."]);
  git(["-c", "user.name=Identity Fixture", "-c", "user.email=identity@invalid.example",
    "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "-m", "Fixture"]);
  assert.equal(createSourceRecord(root).gitRevision, git(["rev-parse", "HEAD"]).trim());
  put(root, "docs/note.md", "Non-build documentation");
  assert.equal(createSourceRecord(root).gitBinding, "verified");
  put(root, "lib/math/src/index.ts", "dirty productive source");
  assert.equal(createSourceRecord(root).gitBinding, "unavailable");
  const captured = fingerprintSource(root);
  put(root, "lib/math/src/index.ts", "a different commit's source");
  git(["add", "lib/math/src/index.ts"]);
  git(["-c", "user.name=Identity Fixture", "-c", "user.email=identity@invalid.example",
    "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "-m", "Advance"]);
  // A now-clean checkout at another HEAD cannot prove the earlier captured bytes.
  assert.equal(verifiedGitRevision(root, captured), null);
  rmSync(path.join(root, "lib/math/src/index.ts"));
  assert.equal(createSourceRecord(root).gitBinding, "unavailable");
});

test("independent expected record survives preparation and stale reuse is rejected", (t) => {
  const root = sourceFixture(t);
  const record = preparePublishSource(root);
  assert.deepEqual(readBoundedJson(path.join(root, EXPECTED_RECORD_PATH)), record);
  assert.equal(preparePublishSource(root, { reuse: true }).appBuildId, record.appBuildId);
  put(root, "artifacts/run-calculator/src/main.ts", "changed");
  assert.throws(() => preparePublishSource(root, { reuse: true }), /changed/);
  assert.throws(() => assertSourceUnchanged(root, record), /changed/);
});

test("a partial or missing compiled build cannot seal; complete matching stages can", (t) => {
  const root = sourceFixture(t);
  const record = preparePublishSource(root);
  assert.throws(() => completeBuildStage(root, record, "api"), /entry is missing/);
  outputs(root);
  assert.equal(completeBuildStage(root, record, "api"), false);
  assert.throws(() => sealBuildIdentity(root), /Both API and web/);
  const info = completeBuildStage(root, record, "web");
  assert.equal(info.buildMode, "release");
  assert.equal(info.appBuildId, record.appBuildId);
  assert.deepEqual(readBoundedJson(path.join(root, "artifacts/api-server/dist/build-info.json")),
    readBoundedJson(path.join(root, "artifacts/run-calculator/dist/public/build-info.json")));
  const saved = readFileSync(path.join(root, "artifacts/api-server/dist/build-info.json"), "utf8");
  put(root, "artifacts/api-server/src/index.ts", "later editor change");
  assert.equal(readFileSync(path.join(root, "artifacts/api-server/dist/build-info.json"), "utf8"), saved);
  assert.throws(() => sealBuildIdentity(root), /changed/);
});

test("compiled output mutation and mismatched artifact-set IDs block finalization", (t) => {
  const root = sourceFixture(t);
  let record = preparePublishSource(root);
  outputs(root);
  completeBuildStage(root, record, "api");
  completeBuildStage(root, record, "web");
  put(root, "artifacts/api-server/dist/index.mjs", "changed compiled output");
  assert.throws(() => sealBuildIdentity(root), /Compiled output changed/);
  record = preparePublishSource(root);
  completeBuildStage(root, record, "api");
  assert.throws(() => sealBuildIdentity(root), /do not share/);
});

test("development metadata is explicit and cannot serve as a complete release", (t) => {
  const root = sourceFixture(t);
  outputs(root);
  const record = createSourceRecord(root, "development");
  completeBuildStage(root, record, "api");
  assert.equal(readBoundedJson(path.join(root, "artifacts/api-server/dist/build-info.json")).buildMode, "development");
});

test("strict bounded records reject invented SHA, forged binding and extra sensitive fields", (t) => {
  const record = createSourceRecord(sourceFixture(t));
  const info = buildInfoFromRecord(record, "release");
  assert.throws(() => validateSourceRecord({ ...record, gitRevision: "a".repeat(64), gitBinding: "verified" }));
  assert.throws(() => validateBuildInfo({ ...info, gitBinding: "verified" }));
  assert.throws(() => validateBuildInfo({ ...info, password: "synthetic" }));
  assert.throws(() => validateBuildInfo({ ...info, appBuildId: "app-build:" + "-".repeat(36) }));
  assert.equal(sourceRecordDigest(record), sourceRecordDigest({ ...record }));
  const root = sourceFixture(t);
  put(root, "large.json", "x".repeat(8193));
  assert.throws(() => readBoundedJson(path.join(root, "large.json")), /budget/);
});