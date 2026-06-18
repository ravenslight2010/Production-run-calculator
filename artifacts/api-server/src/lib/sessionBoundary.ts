import { db, dailySyncTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// The daily reset doubles as a session boundary: when a client performs the
// midnight rollover it advances `dayState.resetAt` on today's `daily_sync` row
// (via the sync endpoints). Any auth token issued before that timestamp is
// treated as signed out, so the whole shift is forced to re-authenticate for the
// new production day — enforced here, server-side, so it applies to every device
// regardless of which one detected midnight.
//
// We read only today's row (primary-key lookup) and cache the value briefly so
// requireAuth, which runs on every request including SSE, never pays for a DB
// round-trip per request.

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const CACHE_TTL_MS = 15_000;
let cachedBoundaryMs = 0;
let cachedAt = 0;

// Returns the current daily-reset boundary as a millisecond epoch (0 when no
// reset has been recorded for today yet, meaning no token is fenced out).
export async function getSessionBoundaryMs(): Promise<number> {
  const now = Date.now();
  if (now - cachedAt < CACHE_TTL_MS) return cachedBoundaryMs;
  try {
    const [row] = await db
      .select()
      .from(dailySyncTable)
      .where(eq(dailySyncTable.date, todayStr()));
    const data = row?.data as
      | { dayState?: { resetAt?: unknown } }
      | null
      | undefined;
    const resetAt = data?.dayState?.resetAt;
    cachedBoundaryMs =
      typeof resetAt === "number" && resetAt > 0 ? resetAt : 0;
    cachedAt = now;
    return cachedBoundaryMs;
  } catch {
    // On a transient DB error, fail open to the last known boundary rather than
    // logging everyone out; cachedAt is left unchanged so the next request
    // retries the read promptly.
    return cachedBoundaryMs;
  }
}
