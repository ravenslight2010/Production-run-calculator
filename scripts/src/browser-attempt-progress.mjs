import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync,
  renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assessmentRevision, captureReleaseIdentity, sourceRevision } from "./release-source-identity.mjs";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_CASES = 2_000;
const MAX_RESULTS_PER_CASE = 32;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const RESULTS = new Set(["passed", "failed", "timedOut", "skipped", "interrupted"]);
const OUTCOMES = new Set(["passed", "failed", "timedout", "interrupted"]);
const storage = (root) => resolve(root, ".local/browser-verification-attempts");
const safeText = (value) => {
  if (typeof value !== "string" || value.length === 0 || value.length > 4_096)
    throw new Error("Invalid browser attempt metadata.");
  return value;
};
const number = (value) => {
  if (!Number.isFinite(value) || value < 0)
    throw new Error("Invalid browser attempt timing or budget.");
  return value;
};
const workerIndex = (value) => {
  // Playwright uses -1 when no worker ran a skipped/interrupted case.
  if (!Number.isInteger(value) || value < -1)
    throw new Error("Invalid browser attempt worker index.");
  return value;
};
const encode = (value) => {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(bytes) > MAX_BYTES)
    throw new Error("Browser attempt metadata budget exceeded.");
  return bytes;
};
function durableNew(path, bytes) {
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(fd, bytes, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
export function atomicWriteBrowserMetadata(path, bytes) {
  // A failed write/rename leaves the previous snapshot and immutable start
  // intact. Never use truncation on a published snapshot.
  const pending = `${path}.${randomUUID()}.pending`;
  durableNew(pending, bytes);
  renameSync(pending, path);
}
const pickIdentity = (identity) => {
  const keys = ["revision", "sourceRevision", "sourcePolicy",
    "sourceFingerprintSha256", "verificationFingerprintSha256"];
  const picked = Object.fromEntries(keys.map((key) => [key, safeText(identity[key])]));
  if (picked.revision !== assessmentRevision(picked.sourcePolicy,
    picked.sourceFingerprintSha256, picked.verificationFingerprintSha256) ||
    picked.sourceRevision !== sourceRevision(picked.sourceFingerprintSha256))
    throw new Error("Invalid browser attempt source/test identity.");
  return picked;
};
const sameIdentity = (left, right) =>
  JSON.stringify(pickIdentity(left)) === JSON.stringify(pickIdentity(right));

/** Create-only startup record: no loading, merging, or resuming prior passes. */
export function startBrowserAttempt({
  root,
  identity = captureReleaseIdentity(root),
  runnerBudgets = { timeoutMs: null, warningMs: null },
  now = Date.now,
}) {
  const attemptId = randomUUID();
  const directory = resolve(storage(root), attemptId);
  const originalBudgets = {
    timeoutMs: runnerBudgets.timeoutMs === null ? null : number(runnerBudgets.timeoutMs),
    warningMs: runnerBudgets.warningMs === null ? null : number(runnerBudgets.warningMs),
  };
  const start = {
    schemaVersion: 1,
    attemptId,
    environment: "isolated-test",
    authority: "diagnostic-only; never release evidence or resumable passes",
    identity: pickIdentity(identity),
    startedAt: new Date(now()).toISOString(),
    originalRunnerBudgets: originalBudgets,
    coverage: "INCOMPLETE",
    phase: "startup",
    result: null,
    elapsedMs: 0,
    cases: [],
  };
  try {
    mkdirSync(storage(root), { recursive: true, mode: 0o700 });
    mkdirSync(directory, { mode: 0o700 });
    durableNew(resolve(directory, "start.json"), encode(start));
  } catch {
    // If storage is unavailable before the first durable byte, don't run tests.
    // Do not include raw filesystem errors/paths in public output.
    throw new Error("Browser attempt startup persistence failed; execution not authorized.");
  }
  return attemptId;
}

/** A startup manifest can be claimed by exactly one reporter, never resumed. */
export function claimBrowserAttempt({
  root,
  attemptId,
  identity,
  now = Date.now,
  write = atomicWriteBrowserMetadata,
}) {
  if (!UUID.test(attemptId)) throw new Error("Invalid browser attempt identifier.");
  const directory = resolve(storage(root), attemptId);
  let state;
  try {
    state = JSON.parse(readFileSync(resolve(directory, "start.json"), "utf8"));
    if (state.schemaVersion !== 1 || state.attemptId !== attemptId ||
        state.phase !== "startup" || !sameIdentity(state.identity, identity))
      throw new Error("Invalid browser attempt.");
    durableNew(resolve(directory, "reporter-claim"), "claimed\n");
  } catch {
    throw new Error("Browser attempt is stale, already claimed, or unavailable.");
  }
  const startedAt = Date.parse(state.startedAt);
  let failed = false;
  let ended = false;
  const save = () => {
    if (failed || ended) throw new Error("Browser attempt persistence is closed.");
    state.elapsedMs = Math.max(0, now() - startedAt);
    try {
      write(resolve(directory, "progress.json"), encode(state));
    } catch {
      failed = true;
      throw new Error("Browser attempt checkpoint failed; retained progress is INCOMPLETE.");
    }
  };
  const find = (id) => {
    const row = state.cases.find((entry) => entry.id === id);
    if (!row) throw new Error("Unknown browser attempt case.");
    return row;
  };
  return {
    begin(cases, config) {
      if (state.phase !== "startup" || cases.length > MAX_CASES)
        throw new Error("Invalid browser attempt inventory.");
      const ids = new Set();
      state.cases = cases.map((entry) => {
        if (ids.has(entry.id)) throw new Error("Duplicate browser attempt case.");
        ids.add(entry.id);
        return {
          id: safeText(entry.id), identity: safeText(entry.identity),
          timeoutMs: number(entry.timeoutMs), retries: number(entry.retries),
          status: "not-run", elapsedMs: 0, results: [],
        };
      });
      state.originalPlaywrightBudgets = {
        globalTimeoutMs: number(config.globalTimeout),
        workers: number(config.workers),
        projects: config.projects.map((project) => ({
          name: safeText(project.name), timeoutMs: number(project.timeout),
          retries: number(project.retries),
        })),
      };
      state.phase = "running";
      save();
    },
    testBegin(id, result) {
      const row = find(id);
      row.status = "running";
      row.active = {
        retry: number(result.retry), workerIndex: workerIndex(result.workerIndex),
        startedAt: result.startTime.toISOString(),
      };
      save();
    },
    testEnd(id, result) {
      const row = find(id);
      if (!RESULTS.has(result.status) || row.results.length >= MAX_RESULTS_PER_CASE)
        throw new Error("Invalid browser attempt case result.");
      row.status = result.status;
      row.elapsedMs += number(result.duration);
      row.results.push({
        status: result.status, elapsedMs: number(result.duration),
        retry: number(result.retry), workerIndex: workerIndex(result.workerIndex),
        startedAt: result.startTime.toISOString(),
      });
      delete row.active;
      save();
    },
    error() {
      state.reporterErrors = (state.reporterErrors ?? 0) + 1;
      save();
    },
    end(result, currentIdentity, complete) {
      if (!OUTCOMES.has(result)) throw new Error("Invalid browser attempt outcome.");
      // An observed onEnd outcome is not a process exit code. A changed source
      // identity cannot promote this attempt or replace a complete baseline.
      const unchanged = sameIdentity(state.identity, currentIdentity);
      state.phase = "ended";
      state.result = result;
      state.identityUnchanged = unchanged;
      state.coverage = unchanged && complete && state.cases.length > 0 && !state.reporterErrors &&
        state.cases.every((row) => RESULTS.has(row.status)) &&
        result !== "interrupted" && result !== "timedout" ? "COMPLETE" : "INCOMPLETE";
      save();
      ended = true;
      return unchanged && !state.reporterErrors;
    },
  };
}

// The isolated shell invokes this before PostgreSQL/server/browser setup.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const identity = captureReleaseIdentity(root);
    if (process.env.RELEASE_REVISION && process.env.RELEASE_REVISION !== identity.revision)
      throw new Error("Stale revision.");
    console.log(startBrowserAttempt({ root, identity }));
  } catch {
    console.error("Browser attempt startup persistence failed; no browser run started.");
    process.exitCode = 1;
  }
}
