import { Client } from "pg";

/**
 * Destructive browser fixtures are only safe against a local database, a
 * database whose name explicitly identifies it as disposable, or an
 * explicitly approved CI/test mode.  REPLIT_DEV_DOMAIN alone is not a safety
 * signal: a development browser can still be pointed at a shared database.
 */
export function requireIsolatedTestDatabase(operation: string): string {
  const url = process.env.DATABASE_URL ?? "";
  let host = "";
  let database = "";
  try {
    const parsed = new URL(url);
    host = parsed.hostname;
    database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  } catch {
    // The diagnostic below includes the required remediation.
  }

  const localHost = host === "localhost" || host === "127.0.0.1" || host === "::1";
  const disposableName = /(?:^|[-_])(e2e|test|tests|tmp|temporary)(?:[-_]|$)/i.test(
    database,
  );
  const approvedMode =
    process.env.E2E_TEST_DB === "1" &&
    process.env.E2E_APPROVED_DESTRUCTIVE_MODE === "1";

  if (!url || !(localHost || disposableName || approvedMode)) {
    throw new Error(
      `${operation} refused to run destructive database setup. ` +
        "Use a local database, a database name containing an explicit " +
        "e2e/test/tmp marker, or set E2E_TEST_DB=1 and " +
        "E2E_APPROVED_DESTRUCTIVE_MODE=1 in an approved test environment. " +
        "REPLIT_DEV_DOMAIN alone is not sufficient; this protects shared and " +
        "production databases from live-day deletion.",
    );
  }
  return url;
}

export function uniqueTestId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

export async function cleanupTestUsers(
  db: Client,
  usernames: Iterable<string>,
): Promise<void> {
  for (const username of usernames) {
    await db.query("DELETE FROM users WHERE username = $1", [username]);
  }
}