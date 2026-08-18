/**
 * Playwright global setup: wipe today's daily_sync row so the test always
 * starts from a clean "pending" run state, regardless of any shared-database
 * state left by previous test runs or manual sessions.
 *
 * Safety guard: only proceeds when DATABASE_URL is a local address OR when
 * REPLIT_DEV_DOMAIN is set (Replit workspace dev env) OR when E2E_TEST_DB=1
 * is explicitly provided.  Production deployments have REPLIT_DEPLOYMENT set
 * but not REPLIT_DEV_DOMAIN, so this guard prevents accidental wipes of a
 * shared operational factory database when Playwright is pointed at prod.
 */

import type { FullConfig } from "@playwright/test";
import { Client } from "pg";

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  const isTestDb =
    url.includes("localhost") ||
    url.includes("127.0.0.1") ||
    !!process.env.REPLIT_DEV_DOMAIN ||
    process.env.E2E_TEST_DB === "1";

  if (!isTestDb) {
    throw new Error(
      "Playwright global-setup: refusing to delete daily_sync on what appears " +
        "to be a non-local database. Set E2E_TEST_DB=1 to override, or run " +
        "against a local/dev DATABASE_URL.",
    );
  }

  const client = new Client({ connectionString: url });
  await client.connect();

  const today = new Date().toISOString().slice(0, 10);
  await client.query("DELETE FROM daily_sync WHERE date = $1", [today]);

  await client.end();
}
