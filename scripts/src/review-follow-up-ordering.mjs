import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const unfinishedStates = ["PENDING", "IN_PROGRESS", "IMPLEMENTED", "MERGING", "QUEUED"];
const knownStates = new Set([...unfinishedStates, "PROPOSED", "MERGED", "CANCELLED"]);
const advisory = "Advisory only: cannot stop automatic acceptance, enforce platform scheduling, or assign work. Executable results are observations, not assignment or UI Ready status.";

function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}
function ref(value) {
  requireThat(typeof value === "string" && /^#?\d+$/.test(value), "Invalid task ref");
  return `#${value.replace(/^#/, "")}`;
}
function refs(values) {
  requireThat(Array.isArray(values), "Expected dependency/ref array");
  const result = values.map(ref);
  requireThat(new Set(result).size === result.length, "Duplicate task refs");
  return result;
}
function state(value) {
  requireThat(typeof value === "string", "Missing task state");
  const normalized = value.toUpperCase().replace(/[- ]/g, "_").replace(/^MAIN_/, "");
  requireThat(knownStates.has(normalized), `Unknown task state: ${normalized}`);
  return normalized;
}
function timestamp(value) {
  requireThat(typeof value === "string" && Number.isFinite(Date.parse(value)), "Invalid/missing timestamp");
  return Date.parse(value);
}
function task(value) {
  requireThat(value && typeof value === "object", "Missing task record");
  timestamp(value.createdAt);
  // Deliberately strip descriptions, titles, identities and all unrelated fields.
  return { taskRef: ref(value.taskRef), state: state(value.state),
    createdAt: value.createdAt, dependsOn: refs(value.dependsOn) };
}
function inventory(value) {
  requireThat(value && value.truncated === false && Array.isArray(value.tasks)
    && Number.isSafeInteger(value.totalCount) && value.totalCount === value.tasks.length,
  "Incomplete inventory: require truncated=false and matching totalCount");
  const tasks = value.tasks.map(task);
  refs(tasks.map(t => t.taskRef));
  return tasks;
}
const active = t => unfinishedStates.includes(t.state);
const difference = (expected, actual) => expected.filter(r => !actual.includes(r));

/**
 * Inject ONLY the documented read callbacks from the agent environment.
 * No task SDK, credentials, mutation callbacks, or undocumented platform fields.
 */
export async function captureReview({ queryProjectTasks, getProjectTask }, orderedRefs) {
  const order = refs(orderedRefs);
  requireThat(order.length > 0, "At least one reviewer-selected target is required");
  const startedAt = new Date().toISOString();
  const tasks = [];
  // Base-state queries include MAIN_* variants. Never silently accept a capped shard.
  for (const filter of unfinishedStates) {
    const shard = inventory(await queryProjectTasks({ states: [filter] }));
    requireThat(shard.every(t => t.state === filter), "State-filter inventory mismatch");
    tasks.push(...shard);
  }
  refs(tasks.map(t => t.taskRef)); // cross-shard transitions must be recaptured
  const targets = [];
  for (const taskRef of order) {
    const target = task((await getProjectTask({ taskRef })).task);
    requireThat(target.taskRef === taskRef, "Target read returned another task");
    const queued = tasks.find(t => t.taskRef === taskRef);
    requireThat(!queued || JSON.stringify(queued) === JSON.stringify(target),
      "Task changed during capture; recapture before reviewing");
    targets.push(target);
  }
  const executable = inventory(await queryProjectTasks({ executable: true }));
  return {
    version: 1, source: "documented-task-read-callbacks", startedAt,
    capturedAt: new Date().toISOString(),
    current: { tasks, totalCount: tasks.length, truncated: false },
    targets, orderedRefs: order,
    executable: { tasks: executable, totalCount: executable.length, truncated: false },
  };
}

/**
 * Receipt is optional, supplied by the reviewer, and must retain a complete
 * pre-submission inventory plus the original readback. Today's edges cannot
 * stand in for those historical edges.
 */
export function reviewOrdering(input) {
  requireThat(input?.version === 1 && input.source === "documented-task-read-callbacks", "Unsupported review capture");
  const started = timestamp(input.startedAt);
  const captured = timestamp(input.capturedAt);
  requireThat(started <= captured, "Capture time range is reversed");
  const current = inventory(input.current);
  requireThat(current.every(active), "Current inventory must contain only unfinished accepted work");
  const executable = inventory(input.executable);
  requireThat(executable.every(t => t.state === "PENDING"), "Executable inventory contains non-waiting work");
  const order = refs(input.orderedRefs);
  requireThat(order.length > 0 && Array.isArray(input.targets), "Missing targets");
  const targets = input.targets.map(task);
  requireThat(JSON.stringify(targets.map(t => t.taskRef)) === JSON.stringify(order), "Targets must match reviewer-selected sibling order");
  requireThat([...current, ...targets, ...executable].every(t => timestamp(t.createdAt) <= captured),
    "Task created after capture");
  for (const target of targets) {
    const queued = current.find(t => t.taskRef === target.taskRef);
    requireThat(!queued || JSON.stringify(queued) === JSON.stringify(target), "Inconsistent current target");
    requireThat(!active(target) || queued, "Accepted unfinished target missing from inventory");
  }
  for (const entry of executable) {
    const queued = current.find(t => t.taskRef === entry.taskRef);
    requireThat(queued && JSON.stringify(queued) === JSON.stringify(entry),
      "Executable observation changed during capture; recapture before reviewing");
  }
  const graph = new Map([...current, ...targets].map(t => [t.taskRef, t.dependsOn]));
  const hasCycle = target => {
    const pending = [...target.dependsOn];
    const visited = new Set();
    while (pending.length) {
      const next = pending.pop();
      if (next === target.taskRef) return true;
      if (visited.has(next)) continue;
      visited.add(next);
      pending.push(...(graph.get(next) ?? []));
    }
    return false;
  };
  const observations = [];
  for (let index = 0; index < targets.length; index++) {
    const target = targets[index];
    // A later arrival is not a retroactive dependency requirement. Siblings are
    // checked separately, using explicit reviewer order, never timestamp ties.
    const earlierCurrent = current.filter(t => !order.includes(t.taskRef)
      && timestamp(t.createdAt) <= timestamp(target.createdAt));
    const laterCurrent = current.filter(t => !order.includes(t.taskRef)
      && timestamp(t.createdAt) > timestamp(target.createdAt));
    const previousSiblings = targets.slice(0, index).filter(t => t.state !== "CANCELLED");
    const missingPrerequisites = difference(earlierCurrent.map(t => t.taskRef), target.dependsOn);
    const unorderedSiblings = difference(previousSiblings.map(t => t.taskRef), target.dependsOn);
    const historical = historicalReview(input.receipt, target, order.slice(0, index));
    observations.push({
      taskRef: target.taskRef,
      currentPrerequisites: { missingLinks: missingPrerequisites,
        basis: "Currently unfinished accepted tasks created no later than target; NOT a creation-time inventory.",
        laterArrivalsNotRequired: laterCurrent.map(t => t.taskRef) },
      siblings: { missingLinks: unorderedSiblings, basis: "Reviewer-selected order; direct links to all earlier non-archived siblings." },
      historical,
      dependencyCycleObserved: hasCycle(target),
      executableObserved: executable.some(t => t.taskRef === target.taskRef),
      blockedWhileExecutable: executable.some(t => t.taskRef === target.taskRef)
        && current.some(t => target.dependsOn.includes(t.taskRef)),
      taskStatus: target.state === "PROPOSED" ? "Draft (excluded from prerequisite inventory)"
        : target.state === "IMPLEMENTED" ? "Ready to merge, not proof of execution eligibility"
          : "Stored lifecycle observation only; no assignment claim",
    });
  }
  const warnings = observations.some(t => t.currentPrerequisites.missingLinks.length
    || t.siblings.missingLinks.length || t.blockedWhileExecutable
    || t.dependencyCycleObserved
    || t.historical.snapshotComparison === "mismatch");
  return { version: 1, advisory, capturedAt: input.capturedAt,
    source: input.source, nonAtomicCapture: true,
    result: warnings ? "warnings" : "no-current-link-warnings",
    observations };
}

function historicalReview(receipt, target, earlierSiblings) {
  const boundary = "Creation-time compliance unverifiable: documented reads are not an atomic creation receipt.";
  if (!receipt) return { creationTimeCompliance: "unverifiable", snapshotComparison: "unverifiable", reason: "No retained snapshot receipt.", boundary };
  requireThat(receipt.version === 1 && receipt.kind === "pre-submission-snapshot", "Unsupported receipt");
  const captured = timestamp(receipt.capturedAt);
  const baseline = inventory(receipt.inventory);
  requireThat(baseline.every(t => timestamp(t.createdAt) <= captured), "Receipt contains future task");
  requireThat(Array.isArray(receipt.readbacks), "Missing retained readbacks");
  const readbacks = receipt.readbacks.map(t => {
    timestamp(t.observedAt);
    return { ...task(t), observedAt: t.observedAt };
  });
  refs(readbacks.map(t => t.taskRef));
  const historical = readbacks.find(t => t.taskRef === target.taskRef);
  if (!historical) return { creationTimeCompliance: "unverifiable", snapshotComparison: "unverifiable", reason: "Receipt has no retained readback for target.", boundary };
  requireThat(captured <= timestamp(historical.createdAt)
    && timestamp(historical.createdAt) <= timestamp(historical.observedAt), "Receipt chronology is invalid");
  requireThat(historical.createdAt === target.createdAt, "Receipt target identity mismatch");
  const expected = refs([...baseline.filter(t => active(t) && t.taskRef !== target.taskRef
    && !earlierSiblings.includes(t.taskRef)).map(t => t.taskRef), ...earlierSiblings]);
  const missingLinks = difference(expected, historical.dependsOn);
  const extraLinks = difference(historical.dependsOn, expected);
  return { creationTimeCompliance: "unverifiable",
    snapshotComparison: missingLinks.length || extraLinks.length ? "mismatch" : "matches-retained-snapshot",
    capturedAt: receipt.capturedAt, observedAt: historical.observedAt, missingLinks, extraLinks, boundary };
}

export async function main(args) {
  requireThat(args.length === 1, "Usage: node scripts/src/review-follow-up-ordering.mjs <capture.json>");
  const report = reviewOrdering(JSON.parse(await readFile(args[0], "utf8")));
  console.log(JSON.stringify(report, null, 2));
  return report.result === "warnings" ? 1 : 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await main(process.argv.slice(2)); }
  catch (error) {
    console.error(`Review unavailable: ${error.message}. No task changes made.`);
    process.exitCode = 2;
  }
}