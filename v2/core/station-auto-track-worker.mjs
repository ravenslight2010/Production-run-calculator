import { createHash, randomUUID } from "node:crypto";
import { STATIONS } from "./station-workflows.mjs";

const LEASE_NAME = "station-auto-track";
const SYSTEM_ACTOR_ID = "00000000-0000-4000-8000-000000000001";
const CLAIM_SQL = "SELECT v2.claim_worker_lease($1::text, $2::uuid, $3::integer) AS generation";
const HEARTBEAT_SQL = "SELECT v2.heartbeat_worker_lease($1::text, $2::uuid, $3::bigint, $4::integer) AS renewed";
const RELEASE_SQL = "SELECT v2.release_worker_lease($1::text, $2::uuid, $3::bigint) AS released";
const DUE_SQL = `SELECT facility_id AS "facilityId", run_id AS "runId",
    expected_revision AS "expectedRevision", station_key AS "stationKey"
  FROM v2.list_due_station_auto_track($1::integer)`;
const APPLY_SQL = `SELECT v2.apply_station_command(
  $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::bigint,
  $7::text, 'auto_track', '{}'::jsonb, '{}'::jsonb, $8::text
) AS result`;

function validateInteger(value, min, max, field) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`${field} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function commandHash({ facilityId, runId, commandId, expectedRevision, stationKey }) {
  return createHash("sha256").update(JSON.stringify({
    facilityId,
    actorId: SYSTEM_ACTOR_ID,
    runId,
    commandId,
    expectedRevision,
    stationKey,
    mode: "auto_track",
    changes: {},
  }), "utf8").digest("hex");
}

function outcomeValue(result) {
  const value = result?.rows?.[0]?.result;
  if (!value || !["accepted", "conflict", "invalid_transition", "not_due", "not_enabled"].includes(value.outcome)) {
    throw new Error("Station storage returned an unexpected worker response.");
  }
  return value;
}

export function createStationAutoTrackWorker({
  query,
  logger = () => {},
  ownerId = randomUUID(),
  pollIntervalMs = 1000,
  leaseSeconds = 30,
  batchSize = 50,
  maxRetryMs = 30_000,
}) {
  if (typeof query !== "function") throw new TypeError("A parameterized database query function is required.");
  if (typeof logger !== "function") throw new TypeError("A structured logger is required.");
  validateInteger(pollIntervalMs, 10, 30_000, "pollIntervalMs");
  validateInteger(leaseSeconds, 10, 300, "leaseSeconds");
  validateInteger(batchSize, 1, 500, "batchSize");
  validateInteger(maxRetryMs, pollIntervalMs, 300_000, "maxRetryMs");

  let leaseGeneration = null;
  let loopPromise = null;
  let cyclePromise = null;
  let timer = null;
  let wakeTimer = null;
  let stopping = false;
  let started = false;
  const health = {
    status: "starting",
    lastCycleAt: null,
    lastSuccessAt: null,
    consecutiveFailures: 0,
    lastErrorName: null,
    processedLastCycle: 0,
  };

  const log = (event, extra = {}) => {
    try {
      logger({ event, ...extra });
    } catch {
      // A logging transport failure must not stop automatic station progress.
    }
  };

  async function renewLease() {
    if (leaseGeneration === null) return false;
    const result = await query(HEARTBEAT_SQL, [LEASE_NAME, ownerId, leaseGeneration, leaseSeconds]);
    if (result?.rows?.[0]?.renewed === true) return true;
    leaseGeneration = null;
    health.status = "standby";
    log("v2.station_worker.lease_lost");
    return false;
  }

  async function acquireLease() {
    const result = await query(CLAIM_SQL, [LEASE_NAME, ownerId, leaseSeconds]);
    const generation = result?.rows?.[0]?.generation;
    if (generation === null || generation === undefined) {
      health.status = "standby";
      return false;
    }
    const parsedGeneration = Number(generation);
    if (!Number.isSafeInteger(parsedGeneration) || parsedGeneration < 1) {
      throw new Error("Station worker lease returned an invalid generation.");
    }
    leaseGeneration = parsedGeneration;
    health.status = "active";
    log("v2.station_worker.lease_acquired");
    return true;
  }

  async function runCycle() {
    health.processedLastCycle = 0;
    try {
      if (leaseGeneration === null) {
        if (!await acquireLease()) {
          health.lastCycleAt = new Date().toISOString();
          health.lastSuccessAt = health.lastCycleAt;
          health.consecutiveFailures = 0;
          health.lastErrorName = null;
          return { status: "standby", processed: 0 };
        }
      } else if (!await renewLease()) {
        health.lastCycleAt = new Date().toISOString();
        health.lastSuccessAt = health.lastCycleAt;
        return { status: "standby", processed: 0 };
      }

      const dueResult = await query(DUE_SQL, [batchSize]);
      const dueStations = dueResult?.rows;
      if (!Array.isArray(dueStations)) throw new Error("Station storage returned an invalid due-work list.");

      for (const due of dueStations) {
        if (stopping) break;
        if (!await renewLease()) break;
        const station = STATIONS[due.stationKey];
        const expectedRevision = Number(due.expectedRevision);
        if (!station || typeof due.facilityId !== "string" || typeof due.runId !== "string"
          || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
          throw new Error("Station storage returned an invalid due-work row.");
        }
        const commandId = `station-auto:${due.runId}:${due.stationKey}:${expectedRevision}`;
        const result = outcomeValue(await query(APPLY_SQL, [
          due.facilityId,
          due.runId,
          SYSTEM_ACTOR_ID,
          commandId,
          commandHash({
            facilityId: due.facilityId,
            runId: due.runId,
            commandId,
            expectedRevision,
            stationKey: due.stationKey,
          }),
          expectedRevision,
          due.stationKey,
          station.autoTrackField,
        ]));
        if (result.outcome === "accepted") health.processedLastCycle += 1;
      }

      health.status = leaseGeneration === null ? "standby" : "active";
      health.lastCycleAt = new Date().toISOString();
      health.lastSuccessAt = health.lastCycleAt;
      health.consecutiveFailures = 0;
      health.lastErrorName = null;
      return { status: health.status, processed: health.processedLastCycle };
    } catch (error) {
      health.status = "degraded";
      health.lastCycleAt = new Date().toISOString();
      health.consecutiveFailures += 1;
      health.lastErrorName = typeof error?.name === "string" ? error.name.slice(0, 80) : "UnknownError";
      log("v2.station_worker.cycle_failed", {
        errorName: health.lastErrorName,
        consecutiveFailures: health.consecutiveFailures,
      });
      return { status: "degraded", processed: health.processedLastCycle };
    }
  }

  function runOnce() {
    if (cyclePromise) return cyclePromise;
    cyclePromise = runCycle().finally(() => {
      cyclePromise = null;
    });
    return cyclePromise;
  }

  function nextDelayMs() {
    if (health.consecutiveFailures === 0) return pollIntervalMs;
    return Math.min(maxRetryMs, pollIntervalMs * (2 ** Math.min(health.consecutiveFailures - 1, 20)));
  }

  function waitForNextCycle() {
    return new Promise((resolve) => {
      wakeTimer = resolve;
      timer = setTimeout(() => {
        timer = null;
        wakeTimer = null;
        resolve();
      }, nextDelayMs());
      timer.unref?.();
    });
  }

  async function loop() {
    while (!stopping) {
      await runOnce();
      if (!stopping) await waitForNextCycle();
    }
  }

  async function releaseLease() {
    if (leaseGeneration === null) return;
    const generation = leaseGeneration;
    leaseGeneration = null;
    try {
      const result = await query(RELEASE_SQL, [LEASE_NAME, ownerId, generation]);
      if (result?.rows?.[0]?.released !== true) {
        log("v2.station_worker.lease_release_skipped");
      }
    } catch (error) {
      log("v2.station_worker.lease_release_failed", {
        errorName: typeof error?.name === "string" ? error.name.slice(0, 80) : "UnknownError",
      });
    }
  }

  return Object.freeze({
    start() {
      if (started || stopping) return;
      started = true;
      stopping = false;
      health.status = "starting";
      log("v2.station_worker.started", { pollIntervalMs, leaseSeconds, batchSize });
      loopPromise = loop().finally(() => {
        loopPromise = null;
      });
    },
    async stop() {
      if (!stopping) {
        stopping = true;
        if (timer) clearTimeout(timer);
        timer = null;
        const wake = wakeTimer;
        wakeTimer = null;
        wake?.();
      }
      if (loopPromise) await loopPromise;
      if (cyclePromise) await cyclePromise;
      await releaseLease();
      health.status = "stopped";
      started = false;
      log("v2.station_worker.stopped");
    },
    runOnce,
    getHealth() {
      return Object.freeze({ ...health });
    },
  });
}
