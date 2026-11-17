import { sql } from "drizzle-orm";
import { db, rateLimitCountersTable } from "@workspace/db";
import type { RateLimitResult, RateLimitStore } from "./rateLimit";

// Shared, cross-instance counting backend for the fixed-window rate limiter.
//
// The default in-memory store counts per process, so a horizontally scaled (or
// frequently restarting) API would let a user exceed the cap by spreading
// requests across instances. This store keeps one row per bucket key in
// Postgres and increments it with a single atomic upsert, so every instance
// shares the same counter and the cap holds under scale.
//
// The window is anchored to the application clock (`now`/`windowMs` passed by
// the middleware), not the DB clock: a fresh row is created with
// resetAt = now + windowMs, and the upsert resets the counter once the stored
// window has elapsed. This reproduces the in-memory store's behavior exactly, so
// the emitted headers and the single-instance experience are unchanged.
export class PostgresRateLimitStore implements RateLimitStore {
  constructor(windowMs: number, opts: { enableSweep?: boolean } = {}) {
    // Active keys self-heal on each upsert, but keys that go quiet would leave
    // stale rows behind. Periodically delete expired rows so the table can't
    // grow unbounded. Several instances sweeping concurrently is harmless (the
    // DELETE is idempotent). Disabled in tests for determinism.
    if (opts.enableSweep ?? true) {
      const sweep = setInterval(() => {
        void db
          .delete(rateLimitCountersTable)
          .where(sql`${rateLimitCountersTable.resetAt} <= now()`)
          .catch(() => {
            // Best-effort cleanup; failures are non-fatal and retried next tick.
          });
      }, windowMs);
      // Unref so the timer never keeps the process alive.
      sweep.unref?.();
    }
  }

  async hit(
    key: string,
    windowMs: number,
    now: number,
    cost = 1,
  ): Promise<RateLimitResult> {
    const nowDate = new Date(now);
    const resetAt = new Date(now + windowMs);

    // Atomic upsert: insert a fresh bucket, or on conflict either start a new
    // window (if the stored one has expired) or increment within the current
    // one. ON CONFLICT takes a row lock, so concurrent hits from multiple
    // instances serialize and the count stays exact.
    const rows = await db
      .insert(rateLimitCountersTable)
      .values({ key, count: cost, resetAt })
      .onConflictDoUpdate({
        target: rateLimitCountersTable.key,
        set: {
          count: sql`case when ${rateLimitCountersTable.resetAt} <= ${nowDate} then ${cost} else ${rateLimitCountersTable.count} + ${cost} end`,
          resetAt: sql`case when ${rateLimitCountersTable.resetAt} <= ${nowDate} then ${resetAt} else ${rateLimitCountersTable.resetAt} end`,
        },
      })
      .returning({
        count: rateLimitCountersTable.count,
        resetAt: rateLimitCountersTable.resetAt,
      });

    const row = rows[0];
    if (!row) {
      // Should never happen: an upsert always returns its row.
      throw new Error("rate limit upsert returned no row");
    }
    return { count: row.count, resetAt: row.resetAt.getTime() };
  }
}
