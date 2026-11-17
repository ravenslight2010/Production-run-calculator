import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { authSessionsTable, db, usersTable } from "@workspace/db";
import { sessionTtlSec } from "./auth";
import { invalidateUserSessions } from "./userValidity";

const IDLE_DEFAULT_MS = 12 * 60 * 60 * 1000;
export function sessionIdleTimeoutMs(): number {
  const value = Number(process.env.SESSION_IDLE_TIMEOUT_SEC);
  return Number.isFinite(value) && value > 0
    ? Math.min(Math.floor(value * 1000), 7 * 24 * 60 * 60 * 1000)
    : IDLE_DEFAULT_MS;
}
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
export async function recordSession(userId: string, token: string, expiresAtMs?: number): Promise<void> {
  await db.insert(authSessionsTable).values({
    id: randomUUID(),
    userId,
    tokenHash: hashSessionToken(token),
    expiresAt: new Date(expiresAtMs ?? Date.now() + sessionTtlSec() * 1000),
  });
}
export async function checkAndTouchSession(
  userId: string,
  token: string,
  now = Date.now(),
): Promise<"ok" | "missing" | "revoked" | "idle" | "expired"> {
  const [row] = await db.select().from(authSessionsTable).where(and(
    eq(authSessionsTable.userId, userId),
    eq(authSessionsTable.tokenHash, hashSessionToken(token)),
  ));
  if (!row) return "missing";
  if (row.revokedAt) return "revoked";
  if (row.expiresAt.getTime() <= now) return "expired";
  if (row.lastSeenAt.getTime() + sessionIdleTimeoutMs() <= now) {
    await db.update(authSessionsTable).set({ revokedAt: new Date(now) }).where(eq(authSessionsTable.id, row.id));
    return "idle";
  }
  await db.update(authSessionsTable).set({ lastSeenAt: new Date(now) }).where(eq(authSessionsTable.id, row.id));
  return "ok";
}
export async function revokeSessionsForUser(userId: string): Promise<void> {
  await db.update(authSessionsTable).set({ revokedAt: new Date() }).where(and(eq(authSessionsTable.userId, userId), isNull(authSessionsTable.revokedAt)));
  invalidateUserSessions(userId);
  await db.update(usersTable).set({ sessionRevokedAt: new Date() }).where(eq(usersTable.id, userId));
}
export async function revokeSession(token: string): Promise<void> {
  await db.update(authSessionsTable).set({ revokedAt: new Date() }).where(eq(authSessionsTable.tokenHash, hashSessionToken(token)));
}
export async function purgeExpiredSessions(): Promise<void> {
  await db.delete(authSessionsTable).where(lt(authSessionsTable.expiresAt, new Date()));
}

export const AUTH_SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const AUTH_SESSION_RETENTION_DELETE_LIMIT = 1_000;

export async function purgeRetainedSessions(now = Date.now()): Promise<number> {
  const cutoff = new Date(now - AUTH_SESSION_RETENTION_MS);
  const candidates = await db.select({ id: authSessionsTable.id })
    .from(authSessionsTable)
    .where(or(
      lt(authSessionsTable.expiresAt, cutoff),
      and(
        isNotNull(authSessionsTable.revokedAt),
        lt(authSessionsTable.revokedAt, cutoff),
      ),
    ))
    .limit(AUTH_SESSION_RETENTION_DELETE_LIMIT);
  if (candidates.length === 0) return 0;
  const deleted = await db.delete(authSessionsTable)
    .where(inArray(authSessionsTable.id, candidates.map(({ id }) => id)))
    .returning({ id: authSessionsTable.id });
  return deleted.length;
}