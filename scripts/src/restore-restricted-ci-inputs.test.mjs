import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, linkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { authorize, authorizeMain, materialize, cleanup, manifest, archiveManifest, verifyArchivePointer } from "./restore-restricted-ci-inputs.mjs";
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

test("separate main capability permits only main pushes or main manual runs", () => {
  const mainContext = { ...context, GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main", GITHUB_SHA: head };
  const mainEvent = { repository: { full_name: repository }, ref: "refs/heads/main", after: head, deleted: false };
  assert.doesNotThrow(() => authorizeMain(mainContext, mainEvent, cap, sha(cap)));
  assert.doesNotThrow(() => authorizeMain({ ...mainContext, GITHUB_EVENT_NAME: "workflow_dispatch" }, { repository: { full_name: repository } }, cap, sha(cap)));
  for (const change of [{ GITHUB_ACTIONS: "false" }, { GITHUB_REPOSITORY: "fork/repo" }, { GITHUB_REF: "refs/heads/feature" }, { GITHUB_REF: "refs/tags/main" }, { GITHUB_REF: "refs/pull/142/merge" }, { GITHUB_EVENT_NAME: "pull_request" }, { GITHUB_EVENT_NAME: "pull_request_target" }, { GITHUB_EVENT_NAME: "schedule" }, { GITHUB_SHA: "invalid" }]) {
    assert.throws(() => authorizeMain({ ...mainContext, ...change }, mainEvent, cap, sha(cap)));
  }
  for (const change of [{ repository: { full_name: "fork/repo" } }, { ref: "refs/heads/feature" }, { after: "b".repeat(40) }, { deleted: true }]) {
    assert.throws(() => authorizeMain(mainContext, { ...mainEvent, ...change }, cap, sha(cap)));
  }
  for (const value of [undefined, "", "PR-only-capability"]) assert.throws(() => authorizeMain(mainContext, mainEvent, value, sha(cap)));
  assert.throws(() => authorizeMain(context, event, cap, sha(cap)));
  assert.throws(() => authorize(mainContext, mainEvent, head, cap, sha(cap)));
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
  assert.equal(manifest.length, 58); assert.equal(new Set(manifest.map((e) => e.path)).size, manifest.length);
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
    assert.match(text, /if: always\(\) && \(steps\.restricted-inputs\.outcome != 'skipped' \|\| steps\.main-inputs\.outcome != 'skipped'\)/);
    assert.doesNotMatch(text, /SOURCE_LIBRARY_RECONCILIATION_GZIP_BASE64/);
    assert.match(text, /CI_MAIN_INPUT_AUTHORIZATION: \$\{\{ secrets\.CI_MAIN_INPUT_AUTHORIZATION \}\}/);
    assert.match(text, /if: github\.ref == 'refs\/heads\/main' && \(github\.event_name == 'push' \|\| github\.event_name == 'workflow_dispatch'\)/);
    assert.match(text, /main-reviewed-test-inputs/);
  }
  const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  const docker = ci.slice(ci.indexOf("  docker:\n"), ci.indexOf("  build:\n")); assert.doesNotMatch(docker, /cache-to:|cache-from:/); assert.match(docker, /DOCKER_BUILD_RECORD_UPLOAD: "false"/);
  const rollback = readFileSync(new URL("./rehearse-schema-safe-rollback.mts", import.meta.url), "utf8"); assert.match(rollback, /for \(const context of \[parentContext, currentContext\]\)/); assert.match(rollback, /--copy-report/);
});


test("opaque archive manifest is exact, bounded, unique and restricted to routine/release", () => {
  assert.equal(archiveManifest.length, 9);
  assert.equal(new Set(archiveManifest.map((entry) => entry.path)).size, 9);
  assert.equal(archiveManifest.reduce((total, entry) => total + entry.bytes, 0), 286430528);
  assert.equal(archiveManifest.filter((entry) => entry.lfs).length, 3);
  for (const entry of archiveManifest) {
    assert.match(entry.path, /^attached_assets\/[^/]+\.zip$/);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/); assert.match(entry.revision, /^[a-f0-9]{40}$/);
    assert.ok(Number.isSafeInteger(entry.bytes) && entry.bytes > 0 && entry.bytes <= 140 * 1024 * 1024);
  }
  const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.equal(ci.match(/restore-restricted-ci-inputs\.mjs --with-archives/g)?.length, 1);
  assert.equal(ci.match(/restore-restricted-ci-inputs\.mjs --main --with-archives/g)?.length, 1);
  const department = readFileSync(new URL("../../.github/workflows/department-navigation.yml", import.meta.url), "utf8");
  assert.doesNotMatch(department, /--with-archives/);
});

test("LFS pointers require exact reviewed oid, length and bounded canonical metadata", () => {
  const entry = { sha256: sha(bytes), bytes: bytes.length };
  const pointer = Buffer.from(`version https://git-lfs.github.com/spec/v1\noid sha256:${entry.sha256}\nsize ${entry.bytes}\n`);
  assert.doesNotThrow(() => verifyArchivePointer(pointer, entry));
  for (const changed of [{ ...entry, sha256: "f".repeat(64) }, { ...entry, bytes: 0 }, { ...entry, bytes: entry.bytes + 1 }, { ...entry, bytes: 140 * 1024 * 1024 + 1 }]) assert.throws(() => verifyArchivePointer(pointer, changed));
  assert.throws(() => verifyArchivePointer(Buffer.concat([pointer, Buffer.from("extra metadata")]), entry));
});

test("separate fixture budgets enforce exact lengths and totals without relaxing source defaults", (t) => {
  const dir = root(t); const opaque = { path: "attached_assets/opaque.zip", sha256: sha(bytes), bytes: bytes.length };
  assert.throws(() => materialize(dir, [{ ...opaque, bytes: bytes.length + 1 }], () => bytes));
  assert.throws(() => materialize(dir, [opaque], () => bytes, { perFile: bytes.length - 1, total: bytes.length }));
  assert.throws(() => materialize(dir, [opaque, { ...opaque, path: "attached_assets/second.zip" }], () => bytes, { perFile: bytes.length, total: bytes.length }));
  materialize(dir, [opaque], () => bytes, { perFile: bytes.length, total: bytes.length });
  assert.deepEqual(readFileSync(path.join(dir, opaque.path)), bytes); cleanup(dir, [opaque]);
});


test("repair PR145 has its own exact branch, reviewed head and independent default capability", () => {
  const repairContext = { ...context, GITHUB_REF: "refs/pull/145/merge" };
  const repairEvent = structuredClone(event);
  repairEvent.number = 145; repairEvent.pull_request.head.ref = "fix/main-green-pr-audit";
  assert.doesNotThrow(() => authorize(repairContext, repairEvent, head, cap, sha(cap)));
  assert.throws(() => authorize(repairContext, repairEvent, head, cap));
  assert.throws(() => authorize(context, repairEvent, head, cap, sha(cap)));
  assert.throws(() => authorize(repairContext, event, head, cap, sha(cap)));
  for (const change of [{ GITHUB_ACTIONS: "false" }, { GITHUB_REPOSITORY: "fork/repo" }, { GITHUB_EVENT_NAME: "push" }, { GITHUB_EVENT_NAME: "pull_request_target" }, { GITHUB_REF: "refs/heads/main" }]) {
    assert.throws(() => authorize({ ...repairContext, ...change }, repairEvent, head, cap, sha(cap)));
  }
  for (const edit of [e => { e.number = 146; }, e => { e.pull_request.head.repo.full_name = "fork/repo"; }, e => { e.pull_request.head.ref = "feat/windows-lan-self-hosting"; }, e => { e.pull_request.base.ref = "other"; }, e => { e.pull_request.head.sha = "b".repeat(40); }]) {
    const e = structuredClone(repairEvent); edit(e);
    assert.throws(() => authorize(repairContext, e, head, cap, sha(cap)));
  }
  const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  const gate = ci.slice(ci.indexOf("  reviewed-docker-caddy-browser:\n"), ci.indexOf("  typecheck:\n"));
  assert.match(gate, /number == 145/); assert.match(gate, /fix\/main-green-pr-audit/);
  assert.match(gate, /environment: pr-145-reviewed-test-inputs/);
  assert.match(gate, /test:e2e:docker-caddy/); assert.match(gate, /permissions:\n      contents: read/);
  assert.match(gate, /DOCKER_BUILD_RECORD_UPLOAD: "false"/);
  assert.doesNotMatch(gate, /SOURCE_LIBRARY_RECONCILIATION_GZIP_BASE64|cache-to:|cache-from:|pull_request_target|--allow/);
});
