import app from "./app";
import { logger } from "./lib/logger";
import { seedRoles } from "./lib/roles";
import { runDataHeals } from "./lib/dataHeals";
import { sandboxAllowed, seedSandboxUser } from "./lib/sandbox";
import { recordStartupEvent } from "./lib/observability";
import { startAutoTrackServerTicks } from "./routes/sync";
import { runMasterDataHealthScan } from "./lib/masterDataHealth";
import { spawnSync } from "node:child_process";
import path from "node:path";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

function applyDatabaseSchema(): void {
  if (
    process.env.NODE_ENV !== "production" ||
    process.env.RUN_DB_MIGRATION !== "true"
  ) {
    return;
  }

  logger.info("Applying database schema (drizzle push-force)…");
  const result = spawnSync(
    process.execPath,
    [
      path.join(process.cwd(), "migration", "node_modules", "drizzle-kit", "bin.cjs"),
      "push",
      "--force",
      "--config",
      path.join(process.cwd(), "migration", "drizzle.config.ts"),
    ],
    { stdio: "inherit", env: process.env, cwd: process.cwd() },
  );
  if (result.error) {
    logger.error({ err: result.error }, "Failed to run database schema push");
    process.exit(1);
  }
  if (result.status !== 0) {
    logger.error({ status: result.status }, "Database schema push failed");
    process.exit(1);
  }
  logger.info("Database schema is up to date");
}

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function startServer(): Promise<void> {
  const startedAt = performance.now();
  // Seed the built-in and default editable roles (additive, only-if-absent) so
  // capability gating has a role catalog to resolve against.
  await seedRoles().catch((err) => {
    logger.error({ err }, "Failed to seed roles");
    recordStartupEvent("seed_roles", { durationMs: performance.now() - startedAt, outcome: "degraded", errorCode: "seed_roles_failed" });
  });

  // Apply any pending one-time data heals (marker-guarded, exactly once per
  // database) before accepting requests. A destructive heal must not race a
  // manager's profile write that would make its target recipe live.
  await runDataHeals().catch((err) => {
    logger.error({ err }, "Failed to run data heals");
    recordStartupEvent("data_heals", { durationMs: performance.now() - startedAt, outcome: "degraded", errorCode: "data_heals_failed" });
  });

  const server = app.listen(port);

  server.once("listening", () => {
    logger.info({ port }, "Server listening");
    recordStartupEvent("listen", { durationMs: performance.now() - startedAt, outcome: "success", safeCounts: { port } });

    // Ensure the seeded sandbox account exists with a known password + manager
    // role on every boot. Best-effort: a seeding failure must not take the server
    // down (the rest of the API still works for real users). The sandbox account
    // uses a well-known public password, so it is a non-production feature only —
    // never seed it in a real deployment (see sandboxAllowed()).
    if (sandboxAllowed()) {
      seedSandboxUser().catch((err) => {
        logger.error({ err }, "Failed to seed sandbox user");
      });
    }

    // Keep a persisted, read-only snapshot available even when nobody has
    // opened the manager dashboard. This is deliberately deferred until after
    // startup and uses the existing snapshot when it is fresh; a full scan
    // must not compete with the calculator's first requests.
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
      } catch (err) {
        logger.error({ err, scope }, "master-data health scan failed");
      }
    }));
    const startupTimer = setTimeout(() => { void scan(); }, startupDelayMs);
    startupTimer.unref();
    const timer = setInterval(() => { void scan(); }, intervalMs);
    timer.unref();

    // Server-owned auto-track net-second execution (refactor step 7a): the
    // server fires due sauce/applicator claims itself so runs keep advancing
    // even with no device open. The interval is unref'd and runs inside the
    // same process as the SSE heartbeat, so no extra network traffic.
    startAutoTrackServerTicks();
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
// This opt-in path is useful for deployments that cannot configure a
// pre-deploy command. Compose and Render use their explicit migration paths
// instead, so the long-lived API process does not repeat the schema push.
applyDatabaseSchema();
startServer().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});
