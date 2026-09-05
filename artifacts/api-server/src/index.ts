import app from "./app";
import { logger } from "./lib/logger";
import { seedRoles } from "./lib/roles";
import { runDataHeals } from "./lib/dataHeals";
import { sandboxAllowed, seedSandboxUser } from "./lib/sandbox";
import { recordStartupEvent, recordStartupSlowWarning } from "./lib/observability";
import { runMasterDataHealthScan } from "./lib/masterDataHealth";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  beginStartup,
  claimStartupSlowWarning,
  getStartupHealth,
  getStartupWarningThresholdMs,
  markStartupFailed,
  markStartupReady,
  markStartupStage,
} from "./lib/startupHealth";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function startServer(): Promise<void> {
  const startedAt = performance.now();
  const server = app.listen(port);

  server.once("listening", () => {
    logger.info({ port }, "Server listening");
    markStartupStage("listen");
    recordStartupEvent("listen", { durationMs: performance.now() - startedAt, outcome: "success", safeCounts: { port } });

    void initializeStartup(startedAt);
  });

  server.once("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      logger.error(
        { err, port },
        `Port ${port} is already in use. Stop the existing API workflow or choose a different PORT before starting another API server.`,
      );
    } else {
      logger.error({ err, port }, "API server could not listen on its port");
    }
    process.exit(1);
  });

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Stopping API server");

    const forceExit = setTimeout(() => {
      logger.error({ signal }, "API server did not stop within 5 seconds");
      process.exit(1);
    }, 5_000);
    forceExit.unref();

    server.close((err) => {
      clearTimeout(forceExit);
      if (err) {
        logger.error({ err }, "API server shutdown failed");
        process.exit(1);
      }
      process.exit(0);
    });
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

async function initializeStartup(startedAt: number): Promise<void> {
  const startupTestMode =
    process.env.NODE_ENV !== "production" &&
    process.env.STARTUP_TEST_MODE === "true";
  markStartupStage("database_schema");
  try {
    // Keep the process listening while required database initialization runs so
    // the platform can distinguish "not ready" from a crashed process.
    if (
      startupTestMode &&
      process.env.STARTUP_TEST_FAILURE_STAGE === "database_schema"
    ) {
      throw new Error("forced startup test failure");
    }
    if (
      !startupTestMode ||
      process.env.STARTUP_TEST_DATABASE_READY !== "true"
    ) {
      await db.execute(sql`SELECT 1`);
    }
  } catch {
    const errorCode = "database_schema_failed";
    markStartupFailed("database_schema", errorCode);
    logger.error(
      { stage: "database_schema", durationMs: performance.now() - startedAt, outcome: "degraded", errorCode },
      "Startup initialization failed",
    );
    recordStartupEvent("database_schema", { durationMs: performance.now() - startedAt, outcome: "degraded", errorCode });
    return;
  }

  markStartupStage("seed_roles");
  try {
    // Seed the built-in and default editable roles (additive, only-if-absent)
    // before any authenticated application route is allowed through.
    if (startupTestMode && process.env.STARTUP_TEST_FAILURE_STAGE === "seed_roles") {
      throw new Error("forced startup test failure");
    }
    await seedRoles();
  } catch {
    const errorCode = "seed_roles_failed";
    markStartupFailed("seed_roles", errorCode);
    logger.error(
      { stage: "seed_roles", durationMs: performance.now() - startedAt, outcome: "degraded", errorCode },
      "Startup initialization failed",
    );
    recordStartupEvent("seed_roles", { durationMs: performance.now() - startedAt, outcome: "degraded", errorCode });
    return;
  }

  markStartupStage("data_heals");
  try {
    // Marker-guarded data heals must finish before application requests can
    // mutate the same master data or day-state rows.
    if (startupTestMode && process.env.STARTUP_TEST_FAILURE_STAGE === "data_heals") {
      throw new Error("forced startup test failure");
    }
    await runDataHeals();
  } catch {
    const errorCode = "data_heals_failed";
    markStartupFailed("data_heals", errorCode);
    logger.error(
      { stage: "data_heals", durationMs: performance.now() - startedAt, outcome: "degraded", errorCode },
      "Startup initialization failed",
    );
    recordStartupEvent("data_heals", { durationMs: performance.now() - startedAt, outcome: "degraded", errorCode });
    return;
  }

  markStartupReady();
  logger.info(
    { stage: "ready", durationMs: performance.now() - startedAt, outcome: "success" },
    "API startup initialization complete",
  );
  recordStartupEvent("ready", { durationMs: performance.now() - startedAt, outcome: "success" });

  // Ensure the seeded sandbox account exists with a known password + manager
  // role on every boot. Best-effort and non-production only.
  if (sandboxAllowed()) {
    seedSandboxUser().catch(() => {
      logger.error({ stage: "sandbox_seed", outcome: "degraded", errorCode: "sandbox_seed_failed" }, "Optional startup task failed");
    });
  }

  // Optional read-only health snapshots never hold readiness hostage.
  const intervalMs = Math.max(60_000, Number(process.env.MASTER_DATA_HEALTH_SCAN_INTERVAL_MS ?? 6 * 60 * 60 * 1000));
  const startupDelayMs = Math.max(1_000, Number(process.env.MASTER_DATA_HEALTH_STARTUP_DELAY_MS ?? 10_000));
  const scanScopes = sandboxAllowed() ? ["live", "sandbox"] : ["live"];
  const scan = () => Promise.all(scanScopes.map(async (scope) => {
    try {
      const report = await runMasterDataHealthScan(scope, { maxAgeMs: intervalMs });
      logger.info({
        event: "master_data_health_scan",
        environment: report.environment,
        outcome: "success",
        safeCounts: { findings: report.findings.length, errors: report.summary.error, warnings: report.summary.warning },
      }, "master-data health scan completed");
    } catch {
      logger.error({ scope, outcome: "degraded", errorCode: "master_data_health_scan_failed" }, "Optional background task failed");
    }
  }));
  const startupTimer = setTimeout(() => { void scan(); }, startupDelayMs);
  startupTimer.unref();
  const timer = setInterval(() => { void scan(); }, intervalMs);
  timer.unref();
}
// Schema changes are exclusively owned by the matching one-shot migration
// image (or Render's pre-deploy command). In particular, a long-lived runtime
// must never infer a migration from its environment: replacing it with an
// earlier runtime is an application rollback, not a schema rollback.
beginStartup();
const startupWarningTimer = setTimeout(() => {
  if (claimStartupSlowWarning()) {
    recordStartupSlowWarning(getStartupHealth());
  }
}, getStartupWarningThresholdMs());
startupWarningTimer.unref();
startServer().catch(() => {
  markStartupFailed("listen", "server_start_failed");
  logger.error({ stage: "listen", outcome: "degraded", errorCode: "server_start_failed" }, "API server failed to start");
  process.exit(1);
});
