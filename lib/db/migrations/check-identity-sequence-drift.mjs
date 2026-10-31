import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { checkIdentitySequenceDrift } from "./identity-sequence-drift.mjs";

export { checkIdentitySequenceDrift } from "./identity-sequence-drift.mjs";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL must be set to run the identity sequence diagnostic.");
  }

  const pool = new pg.Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 5_000,
  });
  try {
    const report = await checkIdentitySequenceDrift(pool);
    const drifted = report.filter(({ status }) => status === "drift");
    console.log(JSON.stringify({ checked: report.length, drifted }, null, 2));
    if (drifted.length > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
// Bundling changes import.meta.url to the bundle URL, not this CLI's URL.
if (invokedPath &&
    path.basename(fileURLToPath(import.meta.url)) === "check-identity-sequence-drift.mjs" &&
    pathToFileURL(invokedPath).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Identity sequence diagnostic failed.");
    process.exitCode = 2;
  });
}
