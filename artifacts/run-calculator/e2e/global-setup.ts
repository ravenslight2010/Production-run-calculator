/**
 * Playwright global setup: wipe today's daily_sync row so the test always
 * starts from a clean "pending" run state, regardless of any shared-database
 * state left by previous test runs or manual sessions.
 */

import type { FullConfig } from "@playwright/test";
import { Client } from "pg";

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const today = new Date().toISOString().slice(0, 10);
  await client.query("DELETE FROM daily_sync WHERE date = $1", [today]);

  await client.end();
}
