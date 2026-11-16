import { createHash } from "node:crypto";
import { StationWorkflowError, validateStationCommand } from "./station-workflows.mjs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODES = new Set(["manual", "auto_track", "timer_start", "timer_pause", "timer_resume", "timer_reset"]);
const SQL = `SELECT v2.apply_station_command(
  $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::bigint,
  $7::text, $8::text, $9::jsonb, $10::jsonb, $11::text
) AS result`;

export class RunStationServiceError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "RunStationServiceError";
    this.code = code;
    this.status = status;
  }
}

function normalizeUuid(value, field) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new RunStationServiceError("INVALID_REQUEST", `${field} must be a UUID.`);
  }
  return value.toLowerCase();
}

function normalizeAuth(auth) {
  if (auth?.verified !== true) {
    throw new RunStationServiceError("UNAUTHENTICATED", "Verified server authentication is required.", 401);
  }
  try {
    return {
      facilityId: normalizeUuid(auth.facilityId, "facilityId"),
      actorId: normalizeUuid(auth.actorId, "actorId"),
    };
  } catch {
    throw new RunStationServiceError("UNAUTHENTICATED", "Verified facility and staff identity are required.", 401);
  }
}

function requireCommand(command) {
  if (!command || typeof command !== "object" || Array.isArray(command)) {
    throw new RunStationServiceError("INVALID_COMMAND", "Station command must be an object.");
  }
  const expectedKeys = ["changes", "commandId", "expectedRevision", "mode", "runId", "stationKey"].sort();
  const actualKeys = Object.keys(command).sort();
  if (actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new RunStationServiceError("INVALID_COMMAND", "Station command contains missing or unsupported fields.");
  }
  if (typeof command.commandId !== "string" || command.commandId.length < 1
    || command.commandId.length > 200 || command.commandId.trim() !== command.commandId) {
    throw new RunStationServiceError("INVALID_COMMAND", "commandId must be 1–200 characters with no surrounding whitespace.");
  }
  if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0) {
    throw new RunStationServiceError("INVALID_COMMAND", "expectedRevision must be a non-negative safe integer.");
  }
  if (!MODES.has(command.mode)) {
    throw new RunStationServiceError("INVALID_COMMAND", "Station command mode is not supported.");
  }
  try {
    return {
      runId: normalizeUuid(command.runId, "runId"),
      commandId: command.commandId,
      expectedRevision: command.expectedRevision,
      ...validateStationCommand({
        stationKey: command.stationKey,
        mode: command.mode,
        changes: command.changes,
      }),
    };
  } catch (error) {
    if (error instanceof StationWorkflowError) {
      throw new RunStationServiceError("INVALID_COMMAND", error.message, error.status);
    }
    throw error;
  }
}

function canonicalHash({ facilityId, actorId, command }) {
  return createHash("sha256").update(JSON.stringify({
    facilityId,
    actorId,
    runId: command.runId,
    commandId: command.commandId,
    expectedRevision: command.expectedRevision,
    stationKey: command.stationKey,
    mode: command.mode,
    changes: command.changes,
  }), "utf8").digest("hex");
}

export function createStationCommandService({ query, authorize }) {
  if (typeof query !== "function") throw new TypeError("A parameterized database query function is required.");
  if (typeof authorize !== "function") throw new TypeError("A server authorization function is required.");

  return Object.freeze({
    async execute({ auth, command: rawCommand }) {
      const identity = normalizeAuth(auth);
      const command = requireCommand(rawCommand);
      const authorized = await authorize({ auth, action: "station.command", stationKey: command.stationKey });
      if (authorized !== true) {
        throw new RunStationServiceError("FORBIDDEN", "You cannot change this production station.", 403);
      }

      let result;
      try {
        result = await query(SQL, [
          identity.facilityId,
          command.runId,
          identity.actorId,
          command.commandId,
          canonicalHash({ ...identity, command }),
          command.expectedRevision,
          command.stationKey,
          command.mode,
          JSON.stringify(command.inputs),
          JSON.stringify(command.progress),
          command.autoTrackField,
        ]);
      } catch (error) {
        if (error?.code === "P0002") {
          throw new RunStationServiceError("RUN_NOT_FOUND", "Run not found.", 404);
        }
        if (error?.code === "22023") {
          throw new RunStationServiceError("INVALID_COMMAND", "The station command was not valid.", 400);
        }
        throw error;
      }

      const value = result?.rows?.[0]?.result;
      if (!value || !["accepted", "conflict", "invalid_transition", "not_due", "not_enabled"].includes(value.outcome)) {
        throw new RunStationServiceError("INVALID_STORAGE_RESPONSE", "Station storage returned an unexpected result.", 502);
      }
      if (!value.run && !value.currentRun) {
        throw new RunStationServiceError("INVALID_STORAGE_RESPONSE", "Station storage did not return canonical run state.", 502);
      }
      return value;
    },
  });
}

export { requireCommand as validateRunStationCommand };
