import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";
import { sourceFixture, put } from "./fixtures/build-identity-fixture.mjs";
import { captureReleaseIdentity } from "./release-source-identity.mjs";
import {
  atomicWriteBrowserMetadata, claimBrowserAttempt, startBrowserAttempt,
} from "./browser-attempt-progress.mjs";

const budgets = { timeoutMs: 5_400_000, warningMs: 4_800_000 };
const config = {
  workers: 1, globalTimeout: 0,
  projects: [{ name: "chromium", timeout: 60_000, retries: 0 }],
};
const cases = [
  { id: "one", identity: "e2e/example.spec.ts :: first", timeoutMs: 60_000, retries: 0 },
  { id: "two", identity: "e2e/example.spec.ts :: second", timeoutMs: 90_000, retries: 0 },
];
const event = {
  retry: 0, workerIndex: 0, startTime: new Date("2026-10-29T10:00:01Z"),
};
function fixture(t) {
  const root = sourceFixture(t);
  put(root, "scripts/package.json", "{}");
  const identity = captureReleaseIdentity(root);
  let time = Date.parse("2026-10-29T10:00:00Z");
  const now = () => time;
  const attemptId = startBrowserAttempt({ root, identity, runnerBudgets: budgets, now });
  const directory = resolve(root, ".local/browser-verification-attempts", attemptId);
  const read = (name = "progress.json") => JSON.parse(readFileSync(resolve(directory, name), "utf8"));
  const claim = (extra = {}) => claimBrowserAttempt({ root, identity, attemptId, now, ...extra });
  return { root, identity, attemptId, directory, read, claim, tick: () => { time += 1_000; } };
}

test("startup and abandoned lifecycle retain bounded INCOMPLETE metadata without an exit result", (t) => {
  const f = fixture(t);
  assert.equal(f.read("start.json").coverage, "INCOMPLETE");
  assert.equal(f.read("start.json").result, null);
  assert.deepEqual(f.read("start.json").originalRunnerBudgets, budgets);
  const writer = f.claim();
  writer.begin(cases, config);
  f.tick();
  writer.testBegin("one", event);
  writer.testEnd("one", {
    ...event, status: "passed", duration: 123,
    error: { message: "PRIVATE-ERROR" }, attachments: [{ path: "PRIVATE-TRACE" }],
    request: { body: "PRIVATE-BODY", authorization: "PRIVATE-CREDENTIAL" },
  });
  f.tick();
  writer.testBegin("two", event);
  // No onEnd: model a killed process or workspace restart.
  const progress = f.read();
  assert.equal(progress.coverage, "INCOMPLETE");
  assert.equal(progress.result, null);
  assert.equal(progress.elapsedMs, 2_000);
  assert.deepEqual(progress.identity, f.identity);
  assert.deepEqual(progress.originalPlaywrightBudgets, {
    globalTimeoutMs: 0, workers: 1,
    projects: [{ name: "chromium", timeoutMs: 60_000, retries: 0 }],
  });
  assert.equal(progress.cases[0].identity, cases[0].identity);
  assert.equal(progress.cases[0].elapsedMs, 123);
  assert.equal(progress.cases[1].status, "running");
  assert.equal(progress.cases[1].active.startedAt, event.startTime.toISOString());
  assert.doesNotMatch(JSON.stringify(progress), /PRIVATE-|exitCode/);
  assert(readFileSync(resolve(f.directory, "progress.json")).length < 2 * 1024 * 1024);
  assert.throws(() => f.claim(), /already claimed/);
});

test("finalization records only the observed result; interrupted and timedout remain INCOMPLETE", (t) => {
  for (const outcome of ["passed", "failed", "timedout", "interrupted"]) {
    const f = fixture(t);
    const writer = f.claim();
    writer.begin(cases, config);
    for (const row of cases) {
      writer.testBegin(row.id, event);
      writer.testEnd(row.id, { ...event, status: outcome === "failed" ? "failed" : "passed", duration: 10 });
    }
    assert.equal(writer.end(outcome, f.identity, true), true);
    assert.equal(f.read().phase, "ended");
    assert.equal(f.read().result, outcome);
    assert.equal(f.read().coverage, ["passed", "failed"].includes(outcome) ? "COMPLETE" : "INCOMPLETE");
    assert.equal(f.read("start.json").coverage, "INCOMPLETE", "immutable interruption fallback");
    assert.throws(() => writer.testBegin("one", event), /closed/);
  }
});

test("changed tests cannot adopt old progress or promote old passes; a fresh attempt starts empty", (t) => {
  const f = fixture(t);
  const writer = f.claim();
  writer.begin(cases, config);
  writer.testEnd("one", { ...event, status: "passed", duration: 10 });
  put(f.root, "scripts/src/new.test.mjs", "changed verification input");
  const changed = captureReleaseIdentity(f.root);
  assert.equal(changed.sourceRevision, f.identity.sourceRevision);
  assert.notEqual(changed.revision, f.identity.revision);
  assert.throws(() => f.claim({ identity: changed }), /stale/);
  assert.equal(writer.end("passed", changed, true), false);
  assert.equal(f.read().coverage, "INCOMPLETE");
  const next = startBrowserAttempt({ root: f.root, identity: changed });
  const fresh = claimBrowserAttempt({ root: f.root, attemptId: next, identity: changed });
  fresh.begin(cases, config);
  const data = JSON.parse(readFileSync(resolve(f.directory, "..", next, "progress.json"), "utf8"));
  assert(data.cases.every((row) => row.status === "not-run"));
  assert.equal(f.read().cases[0].status, "passed", "old attempt is retained, not merged");
});

test("failed atomic replacement leaves readable INCOMPLETE progress and a prior complete baseline", (t) => {
  const f = fixture(t);
  const baseline = resolve(f.root, "FINAL-REPORT.md");
  writeFileSync(baseline, "PRIOR COMPLETE BASELINE\n");
  let fail = false;
  const writer = f.claim({ write: (path, bytes) => {
    if (fail) {
      // Real filesystem failure at rename, after the pending file is durable.
      const blocker = `${path}.blocked`;
      mkdirSync(blocker);
      atomicWriteBrowserMetadata(blocker, bytes);
    }
    atomicWriteBrowserMetadata(path, bytes);
  } });
  writer.begin(cases, config);
  const before = readFileSync(resolve(f.directory, "progress.json"), "utf8");
  fail = true;
  assert.throws(() => writer.testEnd("one", {
    ...event, status: "failed", duration: 10, error: { message: "PRIVATE" },
  }), /checkpoint failed/);
  assert.equal(readFileSync(resolve(f.directory, "progress.json"), "utf8"), before);
  assert.equal(f.read().coverage, "INCOMPLETE");
  assert.throws(() => writer.end("passed", f.identity, true), /closed/);
  assert.equal(readFileSync(baseline, "utf8"), "PRIOR COMPLETE BASELINE\n");
  assert.equal(f.read("start.json").result, null);
  const pending = readdirSync(f.directory).filter((name) => name.endsWith(".pending"));
  assert.equal(pending.length, 1);
  assert.doesNotMatch(readFileSync(resolve(f.directory, pending[0]), "utf8"), /PRIVATE/);
  // Atomic metadata writing itself must not truncate an existing target.
  const target = resolve(f.directory, "directory-target");
  mkdirSync(target);
  assert.throws(() => atomicWriteBrowserMetadata(target, "safe\n"));
  assert.equal(readFileSync(baseline, "utf8"), "PRIOR COMPLETE BASELINE\n");
});

test("failure before first startup byte fails closed and does not touch retained reports", (t) => {
  const f = fixture(t);
  renameSync(resolve(f.root, ".local"), resolve(f.root, ".local.saved"));
  writeFileSync(resolve(f.root, ".local"), "not a directory");
  assert.throws(() => startBrowserAttempt({ root: f.root, identity: f.identity }), /execution not authorized/);
});

test("bounds reject excessive inventory and raw metadata is never copied", (t) => {
  const f = fixture(t);
  const writer = f.claim();
  assert.throws(() => writer.begin(Array(2_001).fill(cases[0]), config), /inventory/);
  assert.equal(f.read("start.json").coverage, "INCOMPLETE");
});

test("skipped/interrupted worker sentinels and retry histories retain exact metadata", (t) => {
  const f = fixture(t);
  const writer = f.claim();
  writer.begin(cases, config);
  writer.testBegin("one", { ...event, workerIndex: -1 });
  writer.testEnd("one", { ...event, workerIndex: -1, status: "skipped", duration: 0 });
  writer.testEnd("two", { ...event, status: "failed", duration: 12 });
  writer.testBegin("two", { ...event, retry: 1, workerIndex: 2 });
  writer.testEnd("two", { ...event, retry: 1, workerIndex: 2, status: "passed", duration: 15 });
  assert.equal(f.read().cases[0].results[0].workerIndex, -1);
  assert.equal(f.read().cases[1].elapsedMs, 27);
  assert.deepEqual(f.read().cases[1].results.map(({ status, retry, workerIndex }) =>
    ({ status, retry, workerIndex })), [
    { status: "failed", retry: 0, workerIndex: 0 },
    { status: "passed", retry: 1, workerIndex: 2 },
  ]);
  writer.error({ message: "PRIVATE-ERROR" });
  assert.equal(writer.end("failed", f.identity, true), false);
  assert.equal(f.read().coverage, "INCOMPLETE");
  assert.equal(f.read().reporterErrors, 1);
  assert.doesNotMatch(JSON.stringify(f.read()), /PRIVATE/);
});

test("WebKit lanes cannot claim Chromium or one another, including across verification revisions", (t) => {
  const f = fixture(t);
  for (const lane of ["webkit-smoke", "webkit-compatibility", "webkit-compatibility-debug"]) {
    assert.throws(() => f.claim({ lane }), /stale/);
    const attemptId = startBrowserAttempt({ root: f.root, identity: f.identity, lane, runnerBudgets: budgets });
    assert.throws(() => claimBrowserAttempt({ root: f.root, identity: f.identity, attemptId }), /stale/);
    const writer = claimBrowserAttempt({ root: f.root, identity: f.identity, attemptId, lane });
    writer.begin(cases.map((entry) => ({ ...entry, projectName: "phone-webkit" })), {
      ...config, projects: [{ name: "phone-webkit", timeout: 75_000, retries: 0 }],
    });
    for (const row of cases) writer.testEnd(row.id, { ...event, status: "passed", duration: 1 });
    put(f.root, `scripts/src/${lane}.test.mjs`, "changed verification");
    assert.equal(writer.end("passed", captureReleaseIdentity(f.root), true), false);
    const data = JSON.parse(readFileSync(resolve(f.directory, "..", attemptId, "progress.json"), "utf8"));
    assert.equal(data.coverage, "INCOMPLETE");
    assert.equal(data.lane, lane);
    assert.equal(data.cases[0].projectName, "phone-webkit");
  }
});
