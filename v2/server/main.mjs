import { createServer } from "node:http";
import { isIP } from "node:net";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { createAuthAdapter } from "./auth-adapter.mjs";
import { createV2Api } from "./api.mjs";
import { createStationAutoTrackWorker } from "../core/station-auto-track-worker.mjs";

const { Pool } = pg;

class V2StartupError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "V2StartupError";
    this.code = code;
  }
}

function logStructured(record) {
  console.log(JSON.stringify(record));
}

function requiredV2DatabaseUrl(env) {
  const value = env.V2_DATABASE_URL;
  if (typeof value !== "string" || value.length === 0) {
    throw new V2StartupError(
      "V2_DATABASE_URL_REQUIRED",
      "V2_DATABASE_URL is required; the V1 DATABASE_URL is never used by V2.",
    );
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new V2StartupError("V2_DATABASE_URL_INVALID", "V2_DATABASE_URL must be a valid PostgreSQL connection URL.");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new V2StartupError("V2_DATABASE_URL_PROTOCOL", "V2_DATABASE_URL must use the PostgreSQL protocol.");
  }
  return value;
}

function boundedInteger(value, fallback, minimum, maximum, name, errorCode) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new V2StartupError(errorCode, `${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return parsed;
}

function getClientKeyResolver(env) {
  const trustForwardedFor = env.V2_TRUST_X_FORWARDED_FOR === "true";
  return (request) => {
    const remoteAddress = request.socket?.remoteAddress;
    if (trustForwardedFor) {
      const forwarded = request.headers["x-forwarded-for"];
      if (typeof forwarded === "string" && forwarded.length <= 512) {
        const candidate = forwarded.split(",", 1)[0].trim();
        if (isIP(candidate)) return candidate;
      }
    }
    return typeof remoteAddress === "string" && remoteAddress.length <= 128
      ? remoteAddress
      : "unknown-client";
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
    server.listen(port, "0.0.0.0");
  });
}

export async function startV2Server({ env = process.env, logger = logStructured } = {}) {
  const connectionString = requiredV2DatabaseUrl(env);
  const port = boundedInteger(env.PORT, 3000, 0, 65535, "PORT", "V2_INVALID_PORT");
  const poolMax = boundedInteger(env.V2_DB_POOL_MAX, 5, 1, 20, "V2_DB_POOL_MAX", "V2_INVALID_POOL_SIZE");
  const stationWorkerOptions = {
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
    application_name: "lucia-production-assistant-v2",
    max: poolMax,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 5000,
    query_timeout: 7000,
    idle_in_transaction_session_timeout: 10_000,
  });

  try {
    await pool.query({ text: "SELECT 1", query_timeout: 3000 });
  } catch (error) {
    try {
      await pool.end();
    } catch (closeError) {
      logger({
        event: "v2.startup.pool_close_failed",
        errorName: typeof closeError?.name === "string" ? closeError.name.slice(0, 80) : "UnknownError",
      });
    }
    logger({
      event: "v2.startup.database_unavailable",
      errorName: typeof error?.name === "string" ? error.name.slice(0, 80) : "UnknownError",
    });
    throw new V2StartupError("V2_DATABASE_UNAVAILABLE", "V2 could not connect to its configured database.");
  }

  const authAdapter = createAuthAdapter({
    query: (text, values) => pool.query(text, values),
    bootstrapSecret: env.V2_INITIAL_MANAGER_BOOTSTRAP_CODE,
    logger,
  });
  const stationWorker = createStationAutoTrackWorker({
    query: (text, values) => pool.query(text, values),
    logger,
    ...stationWorkerOptions,
  });
  const api = createV2Api({
    pool,
    authAdapter,
    getClientKey: getClientKeyResolver(env),
    secureCookies: env.NODE_ENV !== "development",
    logger,
    workerHealth: () => stationWorker.getHealth(),
  });
  const server = createServer(api);
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;

  try {
    await listen(server, port);
  } catch (error) {
    try {
      await pool.end();
    } catch (closeError) {
      logger({
        event: "v2.startup.pool_close_failed",
        errorName: typeof closeError?.name === "string" ? closeError.name.slice(0, 80) : "UnknownError",
      });
    }
    logger({
      event: "v2.startup.listen_failed",
      errorName: typeof error?.name === "string" ? error.name.slice(0, 80) : "UnknownError",
    });
    throw new V2StartupError("V2_LISTEN_FAILED", "V2 could not start its HTTP listener.");
  }

  const address = server.address();
  stationWorker.start();
  logger({
    event: "v2.server.started",
    port: typeof address === "object" && address ? address.port : port,
    poolMax,
    stationWorker: true,
  });

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    const closed = new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    const forceClose = setTimeout(() => server.closeAllConnections(), 5000);
    forceClose.unref();
    try {
      await closed;
    } finally {
      clearTimeout(forceClose);
      await stationWorker.stop();
      await pool.end();
    }
    logger({ event: "v2.server.stopped" });
  };

  return { server, pool, stationWorker, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startV2Server().then(({ close }) => {
    const shutdown = () => {
      void close().catch((error) => {
        logStructured({
          event: "v2.server.shutdown_failed",
          errorName: typeof error?.name === "string" ? error.name.slice(0, 80) : "UnknownError",
        });
        process.exitCode = 1;
      });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  }).catch((error) => {
    logStructured({
      event: "v2.server.startup_failed",
      failureCode: typeof error?.code === "string" && /^V2_[A-Z0-9_]{1,64}$/.test(error.code)
        ? error.code
        : "V2_STARTUP_FAILED",
      errorName: typeof error?.name === "string" ? error.name.slice(0, 80) : "UnknownError",
    });
    process.exitCode = 1;
  });
}
