import app from "./app";
import { logger } from "./lib/logger";
import { seedRoles } from "./lib/roles";
import { runDataHeals } from "./lib/dataHeals";
import { sandboxAllowed, seedSandboxUser } from "./lib/sandbox";

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
  // Seed the built-in and default editable roles (additive, only-if-absent) so
  // capability gating has a role catalog to resolve against.
  await seedRoles().catch((err) => {
    logger.error({ err }, "Failed to seed roles");
  });

  // Apply any pending one-time data heals (marker-guarded, exactly once per
  // database) before accepting requests. A destructive heal must not race a
  // manager's profile write that would make its target recipe live.
  await runDataHeals().catch((err) => {
    logger.error({ err }, "Failed to run data heals");
  });

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");

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
  });
}

startServer().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});
