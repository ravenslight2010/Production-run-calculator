import app from "./app";
import { logger } from "./lib/logger";
import { seedRoles } from "./lib/roles";
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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Seed the built-in and default editable roles (additive, only-if-absent) so
  // capability gating has a role catalog to resolve against. Best-effort.
  seedRoles().catch((err) => {
    logger.error({ err }, "Failed to seed roles");
  });

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
