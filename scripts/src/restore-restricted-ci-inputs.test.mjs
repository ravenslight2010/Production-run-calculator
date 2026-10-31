import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, linkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { authorize, materialize, cleanup, manifest } from "./restore-restricted-ci-inputs.mjs";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const cap = "synthetic-capability-not-a-secret";
const head = "a".repeat(40);
const repository = "ravenslight2010/Production-run-calculator";
const context = { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: repository, GITHUB_EVENT_NAME: "pull_request", GITHUB_REF: "refs/pull/142/merge" };
const event = { number: 142, pull_request: { head: { repo: { full_name: repository }, ref: "feat/windows-lan-self-hosting", sha: head }, base: { ref: "main" } } };
function root(t) { const dir = mkdtempSync(path.join(tmpdir(), "ci-input-test-")); t.after(() => rmSync(dir, { force: true, recursive: true })); return dir; }
const bytes = Buffer.from("synthetic workbook bytes, not production data");
const entry = { path: "attached_assets/source-library/dough/fixture.xlsx", sha256: sha(bytes) };

test("only exact reviewed same-repo PR context and capability are authorized", () => {
  assert.doesNotThrow(() => authorize(context, event, head, cap, sha(cap)));
  for (const changed of [ { GITHUB_ACTIONS: "false" }, { GITHUB_REPOSITORY: "other/repo" }, { GITHUB_EVENT_NAME: "pull_request_target" }, { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main" }, { GITHUB_REF: "refs/pull/143/merge" } ]) {
    assert.throws(() => authorize({ ...context, ...changed }, event, head, cap, sha(cap)));
  }
  for (const edit of [ (e) => { e.number = 143; }, (e) => { e.pull_request.head.repo.full_name = "fork/repo"; }, (e) => { e.pull_request.head.ref = "other"; }, (e) => { e.pull_request.base.ref = "other"; }, (e) => { e.pull_request.head.sha = "b".repeat(40); } ]) {
    const e = structuredClone(event); edit(e); assert.throws(() => authorize(context, e, head, cap, sha(cap)));
  }
  for (const [approved, value] of [[undefined, cap], ["", cap], [head, ""], [head, "wrong"]]) assert.throws(() => authorize(context, event, approved, value, sha(cap)));
});

test("exact bytes materialize privately, idempotently, and clean only allowlisted files", (t) => {
  const dir = root(t); materialize(dir, [entry], () => bytes); materialize(dir, [entry], () => bytes);
  const file = path.join(dir, entry.path); assert.deepEqual(readFileSync(file), bytes);
  if (process.platform !== "win32") assert.equal(lstatSync(file).mode & 0o777, 0o600);
  const other = path.join(path.dirname(file), "unrelated.xlsx"); writeFileSync(other, "keep");
  cleanup(dir, [entry]); cleanup(dir, [entry]); assert.equal(existsSync(file), false); assert.equal(readFileSync(other, "utf8"), "keep");
});

test("mismatch and over-budget input cannot write any payload", (t) => {
  const dir = root(t);
  assert.throws(() => materialize(dir, [entry], () => Buffer.from("wrong")));
  assert.throws(() => materialize(dir, [entry], () => Buffer.alloc(4 * 1024 * 1024 + 1)));
  assert.equal(existsSync(path.join(dir, entry.path)), false);
});

test("invalid paths, overwrite, symlink and hardlink cases fail closed", (t) => {
  for (const p of ["../outside.xlsx", "attached_assets/source-library/../outside.xlsx", "/tmp/x.xlsx", "attached_assets/source-library/x.txt"]) assert.throws(() => materialize(root(t), [{ ...entry, path: p }], () => bytes));
  const dir = root(t); const file = path.join(dir, entry.path); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, "keep");
  assert.throws(() => materialize(dir, [entry], () => bytes)); assert.equal(readFileSync(file, "utf8"), "keep"); rmSync(file);
  const outside = path.join(dir, "outside"); writeFileSync(outside, bytes); symlinkSync(outside, file);
  assert.throws(() => materialize(dir, [entry], () => bytes)); assert.throws(() => cleanup(dir, [entry])); rmSync(file);
  linkSync(outside, file); assert.throws(() => materialize(dir, [entry], () => bytes)); assert.throws(() => cleanup(dir, [entry]));
  const otherRoot = root(t); symlinkSync(dir, path.join(otherRoot, "attached_assets")); assert.throws(() => materialize(otherRoot, [entry], () => bytes));
});

test("cleanup validates whole set before deleting and preserves changed files", (t) => {
  const dir = root(t); const second = { ...entry, path: entry.path.replace("fixture", "second") };
  materialize(dir, [entry, second], () => bytes); writeFileSync(path.join(dir, second.path), "changed");
  assert.throws(() => cleanup(dir, [entry, second])); assert.equal(existsSync(path.join(dir, entry.path)), true);
});

test("manifest has unique exact historical pins and bounded safe paths", (t) => {
  assert.equal(manifest.length, 52); assert.equal(new Set(manifest.map((e) => e.path)).size, manifest.length);
  for (const e of manifest) { assert.match(e.sha256, /^[a-f0-9]{64}$/); assert.match(e.revision, /^[a-f0-9]{40}$/); }
  // Synthetic bytes validate every production path without reading historical data.
  const entries = manifest.map((e) => ({ ...e, sha256: sha(bytes) })); const dir = root(t); materialize(dir, entries, () => bytes); cleanup(dir, entries);
});

test("CLI denies unapproved callers before git fetch and never logs supplied secrets", (t) => {
  const dir = root(t); const eventFile = path.join(dir, "event.json"); writeFileSync(eventFile, JSON.stringify(event));
  const script = new URL("./restore-restricted-ci-inputs.mjs", import.meta.url).pathname;
  const result = spawnSync(process.execPath, [script], { cwd: dir, encoding: "utf8", env: { ...process.env, ...context, GITHUB_EVENT_PATH: eventFile, REVIEWED_PR_HEAD_SHA: head, CI_REVIEWED_INPUT_AUTHORIZATION: cap, CI_REVIEWED_GITHUB_TOKEN: "synthetic-token" } });
  assert.equal(result.status, 1); assert.doesNotMatch(result.stdout + result.stderr, /synthetic-capability|synthetic-token/); assert.equal(existsSync(path.join(dir, "attached_assets")), false);
});

test("workflows retain both protected main and narrowly restricted PR lanes without cache export", () => {
  for (const file of ["ci.yml", "department-navigation.yml", "release-check.yml"]) {
    const text = readFileSync(new URL(`../../.github/workflows/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /pull_request_target/); assert.match(text, /github\.event\.pull_request\.number == 142/); assert.match(text, /head\.repo\.full_name == github\.repository/); assert.match(text, /vars\.REVIEWED_PR_HEAD_SHA/);
    assert.match(text, /if: always\(\) && steps\.restricted-inputs\.outcome != 'skipped'/);
    assert.match(text, /SOURCE_LIBRARY_RECONCILIATION_GZIP_BASE64: \$\{\{ secrets\.SOURCE_LIBRARY_RECONCILIATION_GZIP_BASE64 \}\}/);
  }
  const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  const docker = ci.slice(ci.indexOf("  docker:\n"), ci.indexOf("  build:\n")); assert.doesNotMatch(docker, /cache-to:|cache-from:/); assert.match(docker, /DOCKER_BUILD_RECORD_UPLOAD: "false"/);
  const rollback = readFileSync(new URL("./rehearse-schema-safe-rollback.mts", import.meta.url), "utf8"); assert.match(rollback, /for \(const context of \[parentContext, currentContext\]\)/); assert.match(rollback, /--copy-report/);
});
