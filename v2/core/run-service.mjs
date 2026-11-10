import { createHash } from "node:crypto";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(["planned", "running", "paused", "completed"]);
const MAX_SAFE_REVISION = Number.MAX_SAFE_INTEGER;
const MAX_RUN_LIST_LIMIT = 100;

const CREATE_SQL = `SELECT v2.create_planned_run($1::uuid, $2::uuid, $3::text, $4::text, $5::jsonb) AS result`;
const GET_SQL = `SELECT v2.get_run($1::uuid, $2::uuid) AS result`;
const LIST_SQL = `SELECT v2.list_runs($1::uuid, $2::integer) AS result`;

export class RunServiceError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "RunServiceError";
    this.code = code;
    this.status = status;
  }
}

function invalidRequest(message) {
  return new RunServiceError("INVALID_REQUEST", message, 400);
}

function normalizeUuid(value, fieldName, status = 400) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new RunServiceError("INVALID_REQUEST", `${fieldName} must be a UUID.`, status);
  }
  return value.toLowerCase();
}

function normalizeAuth(auth) {
  if (auth?.verified !== true) {
    throw new RunServiceError("UNAUTHENTICATED", "Sign in to access runs.", 401);
  }
  try {
    return {
      facilityId: normalizeUuid(auth.facilityId, "facilityId", 401),
      actorId: normalizeUuid(auth.actorId, "actorId", 401),
    };
  } catch {
    throw new RunServiceError("UNAUTHENTICATED", "Verified facility and staff identity are required.", 401);
  }
}

function normalizeSetupSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidRequest("setupSnapshot must contain a run label and target case count.");
  }
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== "label" || keys[1] !== "targetCases") {
    throw invalidRequest("setupSnapshot contains missing or unsupported fields.");
  }
  if (typeof value.label !== "string") {
    throw invalidRequest("Run label must be text.");
  }
  const label = value.label.trim();
  if (label.length < 1 || label.length > 120) {
    throw invalidRequest("Run label must be between 1 and 120 characters.");
  }
  if (!Number.isSafeInteger(value.targetCases) || value.targetCases < 1) {
    throw invalidRequest("Target cases must be a positive whole number.");
  }
  return { label, targetCases: value.targetCases };
}

function validCanonicalTimestamp(value, nullable = false) {
  if (nullable && value === null) return true;
  if (typeof value !== "string") return false;
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.valueOf()) && timestamp.toISOString() === value;
}

function validateRun(value) {
  if (
    !value || typeof value !== "object" || Array.isArray(value)
    || !UUID_PATTERN.test(value.id)
    || !STATUSES.has(value.status)
    || !Number.isSafeInteger(value.revision)
    || value.revision < 0
    || value.revision > MAX_SAFE_REVISION
    || !validCanonicalTimestamp(value.createdAt)
    || !validCanonicalTimestamp(value.updatedAt)
    || !validCanonicalTimestamp(value.startedAt, true)
    || !validCanonicalTimestamp(value.pausedAt, true)
    || !validCanonicalTimestamp(value.resumedAt, true)
    || !validCanonicalTimestamp(value.completedAt, true)
    || !Array.isArray(value.pauseIntervals)
  ) {
    throw new RunServiceError("INVALID_STORAGE_RESPONSE", "Run storage returned invalid data.", 502);
  }
  try {
    normalizeSetupSnapshot(value.setupSnapshot);
  } catch {
    throw new RunServiceError("INVALID_STORAGE_RESPONSE", "Run storage returned invalid setup data.", 502);
  }
  for (const interval of value.pauseIntervals) {
    if (
      !interval || typeof interval !== "object" || Array.isArray(interval)
      || !validCanonicalTimestamp(interval.startedAt)
      || !validCanonicalTimestamp(interval.endedAt, true)
    ) {
      throw new RunServiceError("INVALID_STORAGE_RESPONSE", "Run storage returned invalid pause history.", 502);
    }
  }
  return value;
}

function requireResult(result, predicate, message) {
  const value = result?.rows?.[0]?.result;
  if (!predicate(value)) {
    throw new RunServiceError("INVALID_STORAGE_RESPONSE", message, 502);
  }
  return value;
}

function throwSafeStorageError(error) {
  if (error?.code === "22023") {
    throw new RunServiceError("IDEMPOTENCY_CONFLICT", "This request ID was already used for different run details.", 409);
  }
  throw error;
}

async function authorize(authorizeAction, auth, action) {
  const allowed = await authorizeAction({ auth, action });
  if (allowed !== true) {
    throw new RunServiceError("FORBIDDEN", "You do not have permission to access this run.", 403);
  }
}

export function createRunService({ query, authorize: authorizeAction }) {
  if (typeof query !== "function") {
    throw new TypeError("A parameterized database query function is required.");
  }
  if (typeof authorizeAction !== "function") {
    throw new TypeError("A server authorization function is required.");
  }

  return Object.freeze({
    async create({ auth, requestId, setupSnapshot }) {
      const identity = normalizeAuth(auth);
      const normalizedRequestId = normalizeUuid(requestId, "requestId");
      const normalizedSetup = normalizeSetupSnapshot(setupSnapshot);
      await authorize(authorizeAction, auth, "run.create");

      const requestHash = createHash("sha256").update(JSON.stringify({
        facilityId: identity.facilityId,
        actorId: identity.actorId,
        requestId: normalizedRequestId,
        setupSnapshot: normalizedSetup,
      }), "utf8").digest("hex");

      let result;
      try {
        result = await query(CREATE_SQL, [
          identity.facilityId,
          identity.actorId,
          normalizedRequestId,
          requestHash,
          JSON.stringify(normalizedSetup),
        ]);
      } catch (error) {
        throwSafeStorageError(error);
      }

      const response = requireResult(
        result,
        (value) => value?.outcome === "created" && typeof value.replayed === "boolean",
        "Run creation returned an unexpected result.",
      );
      validateRun(response.run);
      if (
        response.run.status !== "planned"
        || response.run.setupSnapshot.label !== normalizedSetup.label
        || response.run.setupSnapshot.targetCases !== normalizedSetup.targetCases
      ) {
        throw new RunServiceError("INVALID_STORAGE_RESPONSE", "Run creation returned a different run setup.", 502);
      }
      return response;
    },

    async get({ auth, runId }) {
      const identity = normalizeAuth(auth);
      const normalizedRunId = normalizeUuid(runId, "runId");
      await authorize(authorizeAction, auth, "run.read");
      let result;
      try {
        result = await query(GET_SQL, [identity.facilityId, normalizedRunId]);
      } catch (error) {
        throwSafeStorageError(error);
      }
      const run = requireResult(result, (value) => value === null || typeof value === "object", "Run read returned an unexpected result.");
      return run === null ? null : validateRun(run);
    },

    async list({ auth, limit = 50 }) {
      const identity = normalizeAuth(auth);
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RUN_LIST_LIMIT) {
        throw invalidRequest(`limit must be an integer from 1 to ${MAX_RUN_LIST_LIMIT}.`);
      }
      await authorize(authorizeAction, auth, "run.read");
      let result;
      try {
        result = await query(LIST_SQL, [identity.facilityId, limit]);
      } catch (error) {
        throwSafeStorageError(error);
      }
      const runs = requireResult(result, Array.isArray, "Run list returned an unexpected result.");
      return runs.map(validateRun);
    },
  });
}
