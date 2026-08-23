import app from "./app";
import { logger } from "./lib/logger";
import { seedRoles } from "./lib/roles";
import { runDataHeals } from "./lib/dataHeals";
import { sandboxAllowed, seedSandboxUser } from "./lib/sandbox";
import { recordStartupEvent } from "./lib/observability";
import { runMasterDataHealthScan } from "./lib/masterDataHealth";

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

startServer().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});
