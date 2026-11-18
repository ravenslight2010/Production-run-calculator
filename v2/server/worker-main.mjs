import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { createStationAutoTrackWorker } from "../core/station-auto-track-worker.mjs";
import {
  boundedInteger,
  readRuntimeDatabaseRole,
  requiredV2DatabaseUrl,
  V2StartupError,
} from "./main.mjs";

const { Pool } = pg;

function logStructured(record) {
  console.log(JSON.stringify(record));
}

function safeHealthSnapshot(health) {
  return {
    status: health.status,
    lastCycleAt: health.lastCycleAt,
    lastSuccessAt: health.lastSuccessAt,
    consecutiveFailures: health.consecutiveFailures,
    lastErrorName: health.lastErrorName,
    processedLastCycle: health.processedLastCycle,
  };
}

export function createHealthHandler(getHealth) {
  return (request, response) => {
    if (request.method !== "GET" || request.url !== "/healthz") {
      response.writeHead(404, {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      response.end();
      return;
    }

    const body = JSON.stringify(safeHealthSnapshot(getHealth()));
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-length": Buffer.byteLength(body),
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    });
    response.end(body);
  };
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

export async function startStationWorkerProcess({ env = process.env, logger = logStructured } = {}) {
  const connectionString = requiredV2DatabaseUrl(env);
  const poolMax = boundedInteger(
    env.V2_WORKER_DB_POOL_MAX,
    2,
    1,
    10,
    "V2_WORKER_DB_POOL_MAX",
    "V2_INVALID_POOL_SIZE",
  );
  const healthPort = boundedInteger(
    env.V2_WORKER_HEALTH_PORT,
    3001,
    1,
    65535,
    "V2_WORKER_HEALTH_PORT",
    "V2_INVALID_WORKER_HEALTH_PORT",
  );
  const workerOptions = {
    pollIntervalMs: boundedInteger(
      env.V2_STATION_WORKER_POLL_MS,
      1000,
      100,
      30_000,
      "V2_STATION_WORKER_POLL_MS",
      "V2_INVALID_STATION_WORKER_POLL",
    ),
    leaseSeconds: boundedInteger(
      env.V2_STATION_WORKER_LEASE_SECONDS,
      30,
      10,
      300,
      "V2_STATION_WORKER_LEASE_SECONDS",
      "V2_INVALID_STATION_WORKER_LEASE",
    ),
    batchSize: boundedInteger(
      env.V2_STATION_WORKER_BATCH_SIZE,
      50,
      1,
      500,
      "V2_STATION_WORKER_BATCH_SIZE",
      "V2_INVALID_STATION_WORKER_BATCH",
    ),
  };
  const pool = new Pool({
    connectionString,
    application_name: "lucia-production-assistant-v2-worker",
    max: poolMax,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 5000,
    query_timeout: 7000,
    idle_in_transaction_session_timeout: 10_000,
  });

  let healthServer;
  let worker;
  try {
    const runtimeRole = await readRuntimeDatabaseRole(pool);
    logger({
      event: "v2.worker.database_identity",
      role: runtimeRole,
    });
    worker = createStationAutoTrackWorker({
      query: (text, values) => pool.query(text, values),
      logger,
      ...workerOptions,
    });
    healthServer = createServer(createHealthHandler(() => worker.getHealth()));
    healthServer.requestTimeout = 2000;
    healthServer.headersTimeout = 1500;
    healthServer.keepAliveTimeout = 1000;
    await listen(healthServer, healthPort);
    worker.start();
  } catch (error) {
    if (healthServer?.listening) {
      await new Promise((resolve) => healthServer.close(resolve));
    }
    await pool.end();
    if (error instanceof V2StartupError) throw error;
    logger({
      event: "v2.worker.startup_failed",
      errorName: typeof error?.name === "string" ? error.name.slice(0, 80) : "UnknownError",
    });
    throw new V2StartupError("V2_WORKER_STARTUP_FAILED", "V2 station worker could not start.");
  }

  logger({
    event: "v2.worker.started",
    healthPort,
    poolMax,
    pollIntervalMs: workerOptions.pollIntervalMs,
    leaseSeconds: workerOptions.leaseSeconds,
    batchSize: workerOptions.batchSize,
    nodeVersion: process.versions.node,
  });

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    if (healthServer?.listening) {
      const closed = new Promise((resolve, reject) => {
        healthServer.close((error) => error ? reject(error) : resolve());
      });
      const forceClose = setTimeout(() => healthServer.closeAllConnections(), 1000);
      forceClose.unref();
      try {
        await closed;
      } finally {
        clearTimeout(forceClose);
      }
    }
    await worker.stop();
    await pool.end();
    logger({ event: "v2.worker.stopped" });
  };

  return { worker, pool, healthServer, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startStationWorkerProcess().then(({ close }) => {
    let shutdownPromise;
    const shutdown = () => {
      if (shutdownPromise) return;
      shutdownPromise = close().catch((error) => {
        logStructured({
          event: "v2.worker.shutdown_failed",
          errorName: typeof error?.name === "string" ? error.name.slice(0, 80) : "UnknownError",
        });
        process.exitCode = 1;
      });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  }).catch((error) => {
    logStructured({
      event: "v2.worker.startup_failed",
      failureCode: typeof error?.code === "string" && /^V2_[A-Z0-9_]{1,64}$/.test(error.code)
        ? error.code
        : "V2_WORKER_STARTUP_FAILED",
      errorName: typeof error?.name === "string" ? error.name.slice(0, 80) : "UnknownError",
    });
    process.exitCode = 1;
  });
}
