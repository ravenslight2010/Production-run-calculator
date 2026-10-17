import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { captureReview, reviewOrdering, unfinishedStates } from "./review-follow-up-ordering.mjs";

const before = "2026-10-01T10:00:00.000Z";
const created = "2026-10-02T10:00:00.000Z";
const after = "2026-10-02T11:00:00.000Z";
const record = (taskRef, state = "PENDING", dependsOn = [], createdAt = created) =>
  ({ taskRef, state, dependsOn, createdAt });
const complete = tasks => ({ tasks, totalCount: tasks.length, truncated: false });
const capture = (overrides = {}) => ({
  version: 1, source: "documented-task-read-callbacks", startedAt: after, capturedAt: after,
  current: complete([record("#1", "MAIN_IN_PROGRESS", [], before)]),
  targets: [record("#2", "PROPOSED", ["#1"]), record("#3", "PROPOSED", ["#1", "#2"])],
  orderedRefs: ["#2", "#3"], executable: complete([]), ...overrides,
});
const receipt = () => ({
  version: 1, kind: "pre-submission-snapshot", capturedAt: before,
  inventory: complete([record("#1", "MAIN_IMPLEMENTED", [], before), record("#9", "PROPOSED", [], before)]),
  readbacks: [ { ...record("#2", "PROPOSED", ["#1"]), observedAt: after },
    { ...record("#3", "PROPOSED", ["#1", "#2"]), observedAt: after } ],
});

test("valid direct dependency chain with absent receipt never claims historical compliance", () => {
  const report = reviewOrdering(capture());
  assert.equal(report.result, "no-current-link-warnings");
  assert.equal(report.observations[1].historical.creationTimeCompliance, "unverifiable");
  assert.equal(report.observations[1].historical.snapshotComparison, "unverifiable");
  assert.match(report.advisory, /cannot stop automatic acceptance/);
  assert.equal(report.observations[0].executableObserved, false);
});
test("missing prerequisites and unsafe siblings are separate warnings", () => {
  const report = reviewOrdering(capture({ targets: [record("#2", "PROPOSED"), record("#3", "PROPOSED", ["#1"])] }));
  assert.equal(report.result, "warnings");
  assert.deepEqual(report.observations[0].currentPrerequisites.missingLinks, ["#1"]);
  assert.deepEqual(report.observations[1].siblings.missingLinks, ["#2"]);
  assert.deepEqual(report.observations[1].currentPrerequisites.missingLinks, []);
});
test("later arrivals do not become retroactive dependency requirements", () => {
  const report = reviewOrdering(capture({ current: complete([
    record("#1", "MERGING", [], before), record("#4", "QUEUED", [], after),
  ]) }));
  assert.equal(report.result, "no-current-link-warnings");
  assert.deepEqual(report.observations[0].currentPrerequisites.laterArrivalsNotRequired, ["#4"]);
});
test("retained snapshot comparison excludes unapproved Drafts; remains non-atomic", () => {
  const report = reviewOrdering(capture({ receipt: receipt() }));
  assert.equal(report.observations[1].historical.snapshotComparison, "matches-retained-snapshot");
  assert.equal(report.observations[1].historical.creationTimeCompliance, "unverifiable");
});
test("today's repaired edges cannot replace the original retained readback", () => {
  const old = receipt();
  old.readbacks[1].dependsOn = ["#1"];
  const report = reviewOrdering(capture({ receipt: old }));
  assert.equal(report.result, "warnings");
  assert.deepEqual(report.observations[1].historical.missingLinks, ["#2"]);
  assert.deepEqual(report.observations[1].siblings.missingLinks, []);
});
test("missing readback is unverifiable and extra historical edges are reported", () => {
  const old = receipt();
  old.readbacks.pop();
  old.readbacks[0].dependsOn.push("#8");
  const report = reviewOrdering(capture({ receipt: old }));
  assert.deepEqual(report.observations[0].historical.extraLinks, ["#8"]);
  assert.equal(report.observations[1].historical.snapshotComparison, "unverifiable");
});
test("reject truncated, count-mismatched, duplicate and unknown inventories", () => {
  for (const current of [
    { ...complete([]), truncated: true }, { ...complete([]), totalCount: 1 },
    complete([record("#1"), record("1")]), complete([record("#1", "FUTURE_STATE")]),
    complete([record("#9", "PROPOSED")]), complete([record("#1", "PENDING", [], after + "bad")]),
  ]) assert.throws(() => reviewOrdering(capture({ current })));
  assert.throws(() => reviewOrdering(capture({ executable: { ...complete([]), truncated: true } })));
  const old = receipt();
  old.inventory.truncated = true;
  assert.throws(() => reviewOrdering(capture({ receipt: old })));
});
test("main workspace variants and Ready status are not executable/assignment claims", () => {
  for (const state of ["MAIN_PENDING", "main-in-progress", "Main Implemented", "MERGING", "QUEUED"]) {
    const target = record("#2", state, ["#1"]);
    const report = reviewOrdering(capture({
      targets: [target], orderedRefs: ["#2"],
      current: complete([record("#1", "MAIN_IN_PROGRESS", [], before), target]),
    }));
    assert.equal(report.result, "no-current-link-warnings");
    assert.equal(report.observations[0].executableObserved, false);
  }
  assert.throws(() => reviewOrdering(capture({ executable: complete([record("#2", "PROPOSED")]) })));
});
test("waiting executable observation with an unfinished stored dependency warns", () => {
  const target = record("#2", "MAIN_PENDING", ["#1"]);
  const report = reviewOrdering(capture({
    targets: [target], orderedRefs: ["#2"],
    current: complete([record("#1", "IN_PROGRESS", [], before), target]),
    executable: complete([target]),
  }));
  assert.equal(report.observations[0].blockedWhileExecutable, true);
});
test("cycles cannot produce a reassuring chain report", () => {
  const report = reviewOrdering(capture({
    targets: [record("#2", "PROPOSED", ["#1", "#3"]), record("#3", "PROPOSED", ["#1", "#2"])],
  }));
  assert.equal(report.result, "warnings");
  assert.ok(report.observations.every(t => t.dependencyCycleObserved));
});
test("contradictory executable and lifecycle observations reject capture", () => {
  assert.throws(() => reviewOrdering(capture({ executable: complete([record("#2", "PENDING")]) })));
});
test("accepted target missing from inventory fails closed; archived siblings do not block", () => {
  assert.throws(() => reviewOrdering(capture({ targets: [record("#2", "PENDING")], orderedRefs: ["#2"] })));
  const report = reviewOrdering(capture({ targets: [record("#2", "CANCELLED"), record("#3", "PROPOSED", ["#1"])] }));
  assert.deepEqual(report.observations[1].siblings.missingLinks, []);
});
test("read capture uses only documented reads, complete shards, and strips private fields", async () => {
  const calls = [];
  const callbacks = {
    queryProjectTasks: async args => {
      calls.push(args);
      return complete(args.executable ? [] : args.states[0] === "IN_PROGRESS"
        ? [{ ...record("#1", "MAIN_IN_PROGRESS", [], before), description: "PRIVATE", owner: "PRIVATE" }] : []);
    },
    getProjectTask: async args => {
      calls.push(args);
      return { task: { ...record(args.taskRef, "PROPOSED", ["#1"]), title: "PRIVATE" } };
    },
  };
  const result = await captureReview(callbacks, ["#2"]);
  assert.deepEqual(calls, [...unfinishedStates.map(s => ({ states: [s] })), { taskRef: "#2" }, { executable: true }]);
  assert.ok(!JSON.stringify(result).includes("PRIVATE"));
  assert.equal(reviewOrdering(result).result, "no-current-link-warnings");
});
test("capture rejects capped shards, contradictory readback, and wrong exact target", async () => {
  await assert.rejects(captureReview({
    queryProjectTasks: async () => ({ ...complete([]), truncated: true }),
    getProjectTask: async () => { throw Error("must not run"); },
  }, ["#2"]));
  await assert.rejects(captureReview({
    queryProjectTasks: async args => complete(args.states?.[0] === "PENDING" ? [record("#2")] : []),
    getProjectTask: async () => ({ task: record("#2", "IMPLEMENTED") }),
  }, ["#2"]));
  await assert.rejects(captureReview({
    queryProjectTasks: async () => complete([]),
    getProjectTask: async () => ({ task: record("#99") }),
  }, ["#2"]));
});
test("CLI exit codes and output are advisory and redact unrelated fields", async () => {
  const folder = await mkdtemp(join(tmpdir(), "follow-up-review-"));
  try {
    const path = join(folder, "capture.json");
    const script = fileURLToPath(new URL("./review-follow-up-ordering.mjs", import.meta.url));
    const fixture = capture();
    fixture.targets[0].description = "PRIVATE-PLAN";
    fixture.targets[0].owner = "PRIVATE-IDENTITY";
    await writeFile(path, JSON.stringify(fixture));
    const good = spawnSync(process.execPath, [script, path], { encoding: "utf8" });
    assert.equal(good.status, 0);
    assert.ok(!good.stdout.includes("PRIVATE"));
    assert.match(good.stdout, /Advisory only/);
    fixture.targets[1].dependsOn = [];
    await writeFile(path, JSON.stringify(fixture));
    assert.equal(spawnSync(process.execPath, [script, path]).status, 1);
    fixture.current.truncated = true;
    await writeFile(path, JSON.stringify(fixture));
    const bad = spawnSync(process.execPath, [script, path], { encoding: "utf8" });
    assert.equal(bad.status, 2);
    assert.equal(bad.stdout, "");
    assert.match(bad.stderr, /Incomplete inventory/);
    assert.equal(spawnSync(process.execPath, [script]).status, 2);
    await writeFile(path, "{");
    assert.equal(spawnSync(process.execPath, [script, path]).status, 2);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});