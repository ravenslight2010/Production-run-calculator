import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRunLifecycleCommand,
  createPlannedRun,
  RunLifecycleError,
} from "./run-lifecycle.mjs";

const t0 = "2026-11-10T12:00:00.000Z";
const t1 = "2026-11-10T12:01:00.000Z";
const t2 = "2026-11-10T12:02:00.000Z";
const t3 = "2026-11-10T12:03:00.000Z";

function command(type, expectedRevision, serverAt, commandId = `${type}-${expectedRevision}`) {
  return { type, expectedRevision, serverAt, commandId };
}

function transition(run, type, expectedRevision, serverAt) {
  return applyRunLifecycleCommand(run, command(type, expectedRevision, serverAt));
}

function expectLifecycleError(fn, code) {
  assert.throws(fn, (error) => error instanceof RunLifecycleError && error.code === code);
}

test("creates a planned run using only the supplied server identity and time", () => {
  assert.deepEqual(createPlannedRun({ id: "run-1", serverAt: t0 }), {
    id: "run-1",
    status: "planned",
    revision: 0,
    createdAt: t0,
    updatedAt: t0,
    startedAt: null,
    pausedAt: null,
    resumedAt: null,
    completedAt: null,
    pauseIntervals: [],
  });
});

test("start, pause, resume, and complete advance canonical revisions and server times", () => {
  const planned = createPlannedRun({ id: "run-2", serverAt: t0 });
  const started = transition(planned, "start", 0, t1);
  const paused = transition(started, "pause", 1, t2);
  const resumed = transition(paused, "resume", 2, t3);
  const completed = transition(resumed, "complete", 3, "2026-11-10T12:04:00.000Z");

  assert.equal(started.status, "running");
  assert.equal(started.startedAt, t1);
  assert.equal(paused.status, "paused");
  assert.equal(paused.pausedAt, t2);
  assert.equal(resumed.status, "running");
  assert.equal(resumed.pausedAt, null);
  assert.equal(resumed.pauseIntervals[0].endedAt, t3);
  assert.equal(completed.status, "completed");
  assert.equal(completed.completedAt, "2026-11-10T12:04:00.000Z");
  assert.equal(completed.revision, 4);
});

test("completing while paused closes the active pause interval", () => {
  const started = transition(createPlannedRun({ id: "run-3", serverAt: t0 }), "start", 0, t1);
  const paused = transition(started, "pause", 1, t2);
  const completed = transition(paused, "complete", 2, t3);

  assert.equal(completed.status, "completed");
  assert.equal(completed.pausedAt, null);
  assert.deepEqual(completed.pauseIntervals, [{ startedAt: t2, endedAt: t3 }]);
});

test("supports repeated pause and resume intervals without losing server-time order", () => {
  const started = transition(createPlannedRun({ id: "run-11", serverAt: t0 }), "start", 0, t1);
  const firstPause = transition(started, "pause", 1, t2);
  const firstResume = transition(firstPause, "resume", 2, t3);
  const secondPause = transition(firstResume, "pause", 3, "2026-11-10T12:04:00.000Z");
  const secondResume = transition(secondPause, "resume", 4, "2026-11-10T12:05:00.000Z");

  assert.equal(secondResume.status, "running");
  assert.equal(secondResume.resumedAt, "2026-11-10T12:05:00.000Z");
  assert.deepEqual(secondResume.pauseIntervals, [
    { startedAt: t2, endedAt: t3 },
    { startedAt: "2026-11-10T12:04:00.000Z", endedAt: "2026-11-10T12:05:00.000Z" },
  ]);
});

test("stale revisions return a conflict with the latest canonical snapshot", () => {
  const started = transition(createPlannedRun({ id: "run-4", serverAt: t0 }), "start", 0, t1);
  let conflict;

  assert.throws(
    () => transition(started, "pause", 0, t2),
    (error) => {
      conflict = error;
      return error instanceof RunLifecycleError && error.code === "REVISION_CONFLICT";
    },
  );
  assert.equal(conflict.details.expectedRevision, 0);
  assert.notEqual(conflict.details.currentRun, started);
  assert.notEqual(conflict.details.currentRun.pauseIntervals, started.pauseIntervals);
  assert.deepEqual(conflict.details.currentRun, started);
});

test("invalid lifecycle transitions fail without changing the original snapshot", () => {
  const planned = createPlannedRun({ id: "run-5", serverAt: t0 });
  const before = structuredClone(planned);

  expectLifecycleError(() => transition(planned, "pause", 0, t1), "INVALID_TRANSITION");
  expectLifecycleError(() => transition(planned, "resume", 0, t1), "INVALID_TRANSITION");
  expectLifecycleError(() => transition(planned, "complete", 0, t1), "INVALID_TRANSITION");
  assert.deepEqual(planned, before);
});

test("every run status accepts only its defined lifecycle commands", () => {
  const planned = createPlannedRun({ id: "run-6", serverAt: t0 });
  const running = transition(planned, "start", 0, t1);
  const paused = transition(running, "pause", 1, t2);
  const completed = transition(running, "complete", 1, t3);

  const cases = [
    [planned, "start", true],
    [planned, "pause", false],
    [planned, "resume", false],
    [planned, "complete", false],
    [running, "start", false],
    [running, "pause", true],
    [running, "resume", false],
    [running, "complete", true],
    [paused, "start", false],
    [paused, "pause", false],
    [paused, "resume", true],
    [paused, "complete", true],
    [completed, "start", false],
    [completed, "pause", false],
    [completed, "resume", false],
    [completed, "complete", false],
  ];

  for (const [state, type, accepted] of cases) {
    const nextRevision = state.revision;
    const at = new Date(Date.parse(state.updatedAt) + 1_000).toISOString();
    if (accepted) {
      assert.equal(applyRunLifecycleCommand(state, command(type, nextRevision, at)).revision, nextRevision + 1);
    } else {
      expectLifecycleError(
        () => applyRunLifecycleCommand(state, command(type, nextRevision, at)),
        "INVALID_TRANSITION",
      );
    }
  }
});

test("rejects non-canonical, invalid, or regressing server timestamps", () => {
  const planned = createPlannedRun({ id: "run-7", serverAt: t0 });

  expectLifecycleError(
    () => createPlannedRun({ id: "run-8", serverAt: "2026-11-10T12:00:00-05:00" }),
    "INVALID_TIMESTAMP",
  );
  expectLifecycleError(
    () => transition(planned, "start", 0, "not-a-time"),
    "INVALID_TIMESTAMP",
  );
  expectLifecycleError(
    () => transition(planned, "start", 0, "2026-11-10T11:59:59.000Z"),
    "SERVER_TIME_REGRESSION",
  );
});

test("rejects unsupported commands and malformed command identities", () => {
  const planned = createPlannedRun({ id: "run-9", serverAt: t0 });

  expectLifecycleError(
    () => applyRunLifecycleCommand(planned, { ...command("start", 0, t1), commandId: "" }),
    "INVALID_COMMAND",
  );
  expectLifecycleError(
    () => applyRunLifecycleCommand(planned, command("stop", 0, t1)),
    "INVALID_COMMAND",
  );
  expectLifecycleError(
    () => applyRunLifecycleCommand(planned, command("start", -1, t1)),
    "INVALID_REVISION",
  );
});

test("rejects corrupt persisted pause history instead of applying a transition", () => {
  const started = transition(createPlannedRun({ id: "run-10", serverAt: t0 }), "start", 0, t1);
  const malformedPaused = {
    ...started,
    status: "paused",
    revision: 2,
    pausedAt: t2,
    updatedAt: t2,
    pauseIntervals: [],
  };

  expectLifecycleError(
    () => applyRunLifecycleCommand(malformedPaused, command("resume", 2, t3)),
    "INVALID_STATE",
  );
});
