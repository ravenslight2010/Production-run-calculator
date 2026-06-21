import app from "./app";
import { logger } from "./lib/logger";
import { seedSandboxUser } from "./lib/sandbox";

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

  // Ensure the seeded sandbox account exists with a known password + manager
  // role on every boot. Best-effort: a seeding failure must not take the server
  // down (the rest of the API still works for real users).
  seedSandboxUser().catch((err) => {
    logger.error({ err }, "Failed to seed sandbox user");
  });
});
