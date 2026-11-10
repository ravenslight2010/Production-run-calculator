import { createHash } from "node:crypto";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMAND_TYPES = new Set(["start", "pause", "resume", "complete"]);
const COMMAND_KEYS = ["commandId", "commandType", "expectedRevision", "runId"];
const SQL = `SELECT v2.apply_run_lifecycle_command(
  $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, $7::bigint
) AS result`;

export class RunCommandServiceError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "RunCommandServiceError";
    this.code = code;
    this.status = status;
  }
}

function invalidCommand(message) {
  return new RunCommandServiceError("INVALID_COMMAND", message, 400);
}

function normalizeUuid(value, fieldName) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw invalidCommand(`${fieldName} must be a canonical UUID.`);
  }
  return value.toLowerCase();
}

function normalizeCommand(command) {
  if (command === null || typeof command !== "object" || Array.isArray(command)) {
    throw invalidCommand("Command must be an object.");
  }

  const keys = Object.keys(command).sort();
  if (keys.length !== COMMAND_KEYS.length || keys.some((key, index) => key !== COMMAND_KEYS[index])) {
    throw invalidCommand("Command contains missing or unsupported fields.");
  }

  const commandId = command.commandId;
  if (
    typeof commandId !== "string"
    || commandId.length < 1
    || commandId.length > 200
    || commandId.trim() !== commandId
  ) {
    throw invalidCommand("commandId must be 1–200 characters with no surrounding whitespace.");
  }
  if (!COMMAND_TYPES.has(command.commandType)) {
    throw invalidCommand("commandType is unsupported.");
  }
  if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0) {
    throw invalidCommand("expectedRevision must be a non-negative safe integer.");
  }

  return {
    runId: normalizeUuid(command.runId, "runId"),
    commandId,
    commandType: command.commandType,
    expectedRevision: command.expectedRevision,
  };
}

function normalizeAuth(auth) {
  if (auth?.verified !== true) {
    throw new RunCommandServiceError("UNAUTHENTICATED", "Verified server authentication is required.", 401);
  }
  try {
    return {
      facilityId: normalizeUuid(auth.facilityId, "facilityId"),
      actorId: normalizeUuid(auth.actorId, "actorId"),
    };
  } catch {
    throw new RunCommandServiceError("UNAUTHENTICATED", "Verified facility and actor identity are required.", 401);
  }
}

export function createRunCommandService({ query, authorize }) {
  if (typeof query !== "function") {
    throw new TypeError("A parameterized database query function is required.");
  }
  if (typeof authorize !== "function") {
    throw new TypeError("A server authorization function is required.");
  }

  return Object.freeze({
    async execute({ auth, command }) {
      const identity = normalizeAuth(auth);
      const normalizedCommand = normalizeCommand(command);
      const authorized = await authorize({
        auth,
        action: "run.lifecycle.command",
        commandType: normalizedCommand.commandType,
      });
      if (authorized !== true) {
        throw new RunCommandServiceError("FORBIDDEN", "You cannot change this run.", 403);
      }

      const canonicalRequest = JSON.stringify({
        facilityId: identity.facilityId,
        actorId: identity.actorId,
        runId: normalizedCommand.runId,
        commandId: normalizedCommand.commandId,
        commandType: normalizedCommand.commandType,
        expectedRevision: normalizedCommand.expectedRevision,
      });
      const requestHash = createHash("sha256").update(canonicalRequest, "utf8").digest("hex");
      const result = await query(SQL, [
        identity.facilityId,
        normalizedCommand.runId,
        identity.actorId,
        normalizedCommand.commandId,
        requestHash,
        normalizedCommand.commandType,
        normalizedCommand.expectedRevision,
      ]);
      const outcome = result?.rows?.[0]?.result?.outcome;
      if (!["accepted", "conflict", "invalid_transition"].includes(outcome)) {
        throw new RunCommandServiceError(
          "INVALID_STORAGE_RESPONSE",
          "The run command service received an invalid database result.",
          502,
        );
      }
      return result.rows[0].result;
    },
  });
}
