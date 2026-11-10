const RUN_STATUSES = new Set(["planned", "running", "paused", "completed"]);
const COMMAND_TYPES = new Set(["start", "pause", "resume", "complete"]);

export class RunLifecycleError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "RunLifecycleError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function requireCanonicalTimestamp(value, field) {
  if (typeof value !== "string") {
    throw new RunLifecycleError("INVALID_TIMESTAMP", `${field} must be a canonical UTC timestamp.`);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new RunLifecycleError("INVALID_TIMESTAMP", `${field} must be a canonical UTC timestamp.`);
  }
  return parsed.valueOf();
}

function requireRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RunLifecycleError("INVALID_REVISION", "expectedRevision must be a non-negative safe integer.");
  }
}

function clonePauseIntervals(intervals) {
  if (!Array.isArray(intervals)) {
    throw new RunLifecycleError("INVALID_STATE", "Run pause history is invalid.");
  }

  return intervals.map((interval) => {
    if (!interval || typeof interval !== "object" || Array.isArray(interval)) {
      throw new RunLifecycleError("INVALID_STATE", "Run pause history is invalid.");
    }
    return { ...interval };
  });
}

function validateRunState(run) {
  if (!run || typeof run !== "object" || Array.isArray(run)) {
    throw new RunLifecycleError("INVALID_STATE", "Run state is invalid.");
  }
  if (typeof run.id !== "string" || run.id.trim() === "") {
    throw new RunLifecycleError("INVALID_STATE", "Run identity is invalid.");
  }
  if (!RUN_STATUSES.has(run.status)) {
    throw new RunLifecycleError("INVALID_STATE", "Run status is invalid.");
  }
  requireRevision(run.revision);
  const createdAt = requireCanonicalTimestamp(run.createdAt, "createdAt");
  const updatedAt = requireCanonicalTimestamp(run.updatedAt, "updatedAt");
  if (updatedAt < createdAt) {
    throw new RunLifecycleError("INVALID_STATE", "Run update time precedes its creation time.");
  }

  const times = {};
  for (const field of ["startedAt", "pausedAt", "resumedAt", "completedAt"]) {
    if (run[field] !== null) times[field] = requireCanonicalTimestamp(run[field], field);
  }

  const intervals = clonePauseIntervals(run.pauseIntervals);
  let previousEnd = times.startedAt ?? createdAt;
  let lastClosedPauseEnd;
  let openIntervals = 0;
  for (const [index, interval] of intervals.entries()) {
    const startedAt = requireCanonicalTimestamp(interval.startedAt, `pauseIntervals[${index}].startedAt`);
    if (startedAt < previousEnd || startedAt > updatedAt) {
      throw new RunLifecycleError("INVALID_STATE", "Run pause history is out of order.");
    }
    if (interval.endedAt === null) {
      openIntervals += 1;
      if (index !== intervals.length - 1) {
        throw new RunLifecycleError("INVALID_STATE", "Only the latest run pause may be open.");
      }
      previousEnd = startedAt;
      continue;
    }

    const endedAt = requireCanonicalTimestamp(interval.endedAt, `pauseIntervals[${index}].endedAt`);
    if (endedAt < startedAt || endedAt > updatedAt) {
      throw new RunLifecycleError("INVALID_STATE", "Run pause history has an invalid end time.");
    }
    previousEnd = endedAt;
    lastClosedPauseEnd = endedAt;
  }

  if (run.status === "planned") {
    if (times.startedAt !== undefined || times.pausedAt !== undefined
      || times.resumedAt !== undefined || times.completedAt !== undefined
      || intervals.length > 0 || updatedAt !== createdAt) {
      throw new RunLifecycleError("INVALID_STATE", "Planned run contains lifecycle history.");
    }
  } else {
    if (times.startedAt === undefined || times.startedAt < createdAt || times.startedAt > updatedAt) {
      throw new RunLifecycleError("INVALID_STATE", "Run start time is invalid.");
    }
    if (times.resumedAt !== undefined && times.resumedAt < times.startedAt) {
      throw new RunLifecycleError("INVALID_STATE", "Run resume time precedes its start time.");
    }
  }

  if (run.status === "running") {
    if (times.pausedAt !== undefined || times.completedAt !== undefined || openIntervals !== 0) {
      throw new RunLifecycleError("INVALID_STATE", "Running state conflicts with its lifecycle history.");
    }
    if (lastClosedPauseEnd === undefined
      ? times.resumedAt !== undefined
      : times.resumedAt !== lastClosedPauseEnd) {
      throw new RunLifecycleError("INVALID_STATE", "Run resume time does not match its pause history.");
    }
  }

  if (run.status === "paused") {
    const openPause = intervals.at(-1);
    if (times.pausedAt === undefined || times.completedAt !== undefined || openIntervals !== 1
      || openPause.startedAt !== run.pausedAt || times.pausedAt !== updatedAt) {
      throw new RunLifecycleError("INVALID_STATE", "Paused state conflicts with its lifecycle history.");
    }
    if (lastClosedPauseEnd !== undefined && times.resumedAt !== lastClosedPauseEnd) {
      throw new RunLifecycleError("INVALID_STATE", "Run resume time does not match its pause history.");
    }
  }

  if (run.status === "completed") {
    if (times.completedAt === undefined || times.completedAt !== updatedAt
      || times.pausedAt !== undefined || openIntervals !== 0) {
      throw new RunLifecycleError("INVALID_STATE", "Completed state conflicts with its lifecycle history.");
    }
    if (times.completedAt < previousEnd || times.completedAt < times.startedAt) {
      throw new RunLifecycleError("INVALID_STATE", "Run completion time precedes its lifecycle history.");
    }
  }
}

function validateCommand(command) {
  if (!command || typeof command !== "object" || Array.isArray(command)) {
    throw new RunLifecycleError("INVALID_COMMAND", "Run command is invalid.");
  }
  if (typeof command.commandId !== "string" || command.commandId.trim() === "" || command.commandId.length > 200) {
    throw new RunLifecycleError("INVALID_COMMAND", "commandId must be a non-empty string of at most 200 characters.");
  }
  if (!COMMAND_TYPES.has(command.type)) {
    throw new RunLifecycleError("INVALID_COMMAND", "Run command type is not supported.");
  }
  requireRevision(command.expectedRevision);
  const commandTime = requireCanonicalTimestamp(command.serverAt, "serverAt");
  return commandTime;
}

function transitionError(run, command) {
  return new RunLifecycleError(
    "INVALID_TRANSITION",
    `Cannot ${command.type} a run while it is ${run.status}.`,
    { runId: run.id, status: run.status, commandType: command.type },
  );
}

/**
 * Create the initial canonical state for a run.
 *
 * The caller must supply an ID and timestamp generated by the server. This
 * function deliberately does not read a browser clock or create an ID.
 */
export function createPlannedRun({ id, serverAt }) {
  if (typeof id !== "string" || id.trim() === "") {
    throw new RunLifecycleError("INVALID_RUN_ID", "Run id must be a non-empty string.");
  }
  requireCanonicalTimestamp(serverAt, "serverAt");

  return {
    id,
    status: "planned",
    revision: 0,
    createdAt: serverAt,
    updatedAt: serverAt,
    startedAt: null,
    pausedAt: null,
    resumedAt: null,
    completedAt: null,
    pauseIntervals: [],
  };
}

/**
 * Apply one revision-guarded lifecycle command to a canonical run snapshot.
 *
 * Persistence, actor authorization, and command idempotency receipts belong in
 * the API transaction that calls this pure transition function.
 */
export function applyRunLifecycleCommand(run, command) {
  validateRunState(run);
  const commandTime = validateCommand(command);

  if (command.expectedRevision !== run.revision) {
    throw new RunLifecycleError(
      "REVISION_CONFLICT",
      "Run changed since this command was prepared.",
      {
        expectedRevision: command.expectedRevision,
        currentRun: { ...run, pauseIntervals: clonePauseIntervals(run.pauseIntervals) },
      },
    );
  }
  if (commandTime < Date.parse(run.updatedAt)) {
    throw new RunLifecycleError("SERVER_TIME_REGRESSION", "Server command time precedes the current run state.");
  }
  if (run.revision === Number.MAX_SAFE_INTEGER) {
    throw new RunLifecycleError("REVISION_EXHAUSTED", "Run revision cannot be advanced safely.");
  }

  const next = {
    ...run,
    revision: run.revision + 1,
    updatedAt: command.serverAt,
    pauseIntervals: clonePauseIntervals(run.pauseIntervals),
  };

  switch (command.type) {
    case "start":
      if (run.status !== "planned") throw transitionError(run, command);
      next.status = "running";
      next.startedAt = command.serverAt;
      break;

    case "pause":
      if (run.status !== "running") throw transitionError(run, command);
      next.status = "paused";
      next.pausedAt = command.serverAt;
      next.pauseIntervals.push({ startedAt: command.serverAt, endedAt: null });
      break;

    case "resume":
      if (run.status !== "paused") throw transitionError(run, command);
      next.status = "running";
      next.resumedAt = command.serverAt;
      next.pausedAt = null;
      next.pauseIntervals.at(-1).endedAt = command.serverAt;
      break;

    case "complete":
      if (run.status !== "running" && run.status !== "paused") throw transitionError(run, command);
      next.status = "completed";
      next.completedAt = command.serverAt;
      if (run.status === "paused") {
        next.pauseIntervals.at(-1).endedAt = command.serverAt;
        next.pausedAt = null;
      }
      break;
  }

  return next;
}
