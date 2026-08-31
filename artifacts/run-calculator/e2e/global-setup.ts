/**
 * Playwright global setup: wipe today's daily_sync row so the test always
 * starts from a clean "pending" run state, regardless of any shared-database
 * state left by previous test runs or manual sessions.
 *
 * Safety guard: only proceeds against a local/disposable database or an
 * explicitly approved test mode. REPLIT_DEV_DOMAIN is deliberately not
 * treated as safe because a development browser can still point at a shared
 * operational database.
 */

import type { FullConfig } from "@playwright/test";
import { Client } from "pg";
import { requireIsolatedTestDatabase } from "./isolation";

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const url = requireIsolatedTestDatabase("Playwright global-setup");
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    const today = new Date().toISOString().slice(0, 10);
    await client.query("DELETE FROM daily_sync WHERE date = $1", [today]);
    // Browser journeys create durable operational fixtures. This setup runs
    // only with requireIsolatedTestDatabase's explicit disposable-test guard,
    // so clear the derived queue and its disposable source records as well.
    // Keeping old derived rows makes the serial release suite depend on the
    // order and history of prior browser runs.
    await client.query("DELETE FROM action_items");
    await client.query("DELETE FROM sync_conflict_logs");
    await client.query("DELETE FROM import_history");
    await client.query("DELETE FROM incidents");
    await client.query(
      `DELETE FROM freezer_surplus_allocations
       WHERE lot_id IN (
         SELECT id FROM freezer_surplus_lots WHERE brand = 'Freezer E2E'
       )`,
    );
    await client.query("DELETE FROM freezer_surplus_lots WHERE brand = 'Freezer E2E'");
    await client.query("DELETE FROM incidents WHERE id LIKE 'e2e:%'");
  } finally {
    await client.end().catch(() => {});
  }
}
