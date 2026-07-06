// Integration tests for the daily-reset session fence, end to end through the
// real router and a disposable Postgres database.
//
// The contract being protected:
//  - A token issued BEFORE today's reset boundary is rejected (401), so the new
//    production day starts from a re-authenticated state on every device.
//  - A token issued AFTER the boundary is accepted (200).
//  - When today has no reset recorded, no one is fenced out (200).
//  - The boundary is read from TODAY's row only: scheduling a FUTURE day (which
//    writes resetAt on a future daily_sync row) must NOT invalidate today's
//    sessions.
//  - Legacy tokens (no `iat`) fall back to the process start time, so they are
//    subject to the fence rather than slipping past it or being purged spuriously.
//
// Mirrors roles.integration.test.ts: throwaway DB created from the dev
// DATABASE_URL's server, schema pushed via drizzle-kit, dropped on teardown, so
// nothing here touches real data. The session cache is module-level, so we clear
// it before each case to read each case's freshly written boundary.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, sql } from "drizzle-orm";
import express, { type Express } from "express";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { signToken } from "../lib/auth";

// NOTE: do NOT statically import anything that pulls in @workspace/db (e.g.
// ../lib/sessionBoundary) here — the db pool binds to process.env.DATABASE_URL
// at import time, and beforeAll repoints it at the throwaway DB. clearSession-
// BoundaryCache is therefore loaded dynamically below, after the repoint.
type DbModule = typeof import("@workspace/db");
let db: DbModule["db"];
let pool: DbModule["pool"];
let dailySyncTable: DbModule["dailySyncTable"];
let userRolesTable: DbModule["userRolesTable"];
let usersTable: DbModule["usersTable"];

let clearUserValidityCache: () => void;
let clearSessionBoundaryCache: () => void;

let adminPool: pg.Pool;
let testDbName: string;
let originalDatabaseUrl: string | undefined;
let server: Server;
let baseUrl: string;

const USER = "user-1";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function tomorrowStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function yesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set to run integration tests");

  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  adminPool.on("error", () => {});
  testDbName = `helium_boundary_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await adminPool.query(`CREATE DATABASE "${testDbName}"`);

  const testUrl = new URL(originalDatabaseUrl);
  testUrl.pathname = `/${testDbName}`;
  const testUrlStr = testUrl.toString();

  const push = spawnSync("pnpm", ["--filter", "@workspace/db", "run", "push-force"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: testUrlStr },
    encoding: "utf8",
  });
  if (push.status !== 0) {
    throw new Error(`drizzle push failed:\n${push.stdout}\n${push.stderr}`);
  }

  process.env.DATABASE_URL = testUrlStr;
  const dbMod = await import("@workspace/db");
  const routerMod = await import("./index");
  const userValidityMod = await import("../lib/userValidity");
  const sessionBoundaryMod = await import("../lib/sessionBoundary");
  clearUserValidityCache = userValidityMod.clearUserValidityCache;
  clearSessionBoundaryCache = sessionBoundaryMod.clearSessionBoundaryCache;
  db = dbMod.db;
  pool = dbMod.pool;
  dailySyncTable = dbMod.dailySyncTable;
  userRolesTable = dbMod.userRolesTable;
  usersTable = dbMod.usersTable;

  const app: Express = express();
  app.use(express.json({ limit: "10mb" }));
  app.use((req, _res, next) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).log = { info() {}, warn() {}, error() {}, debug() {} };
    next();
  });
  app.use("/api", routerMod.default);

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
}, 60_000);

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (pool) await pool.end();
  if (adminPool) {
    if (testDbName) {
      await adminPool.query(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
    }
    await adminPool.end();
  }
  process.env.DATABASE_URL = originalDatabaseUrl;
}, 30_000);

beforeEach(async () => {
  clearUserValidityCache();
  clearSessionBoundaryCache();
  await db.execute(
    sql`TRUNCATE ${dailySyncTable}, ${userRolesTable}, ${usersTable} RESTART IDENTITY CASCADE`,
  );
  await db.insert(usersTable).values({ id: USER, username: "user", passwordHash: "x" });
  await db.insert(userRolesTable).values({ userId: USER, role: "operator" });
});

// Write a daily_sync row for `date` carrying a reset boundary. The fence reads
// `resetBoundaryAt` (set only for a genuine same-day reset), so record both it and
// `resetAt` here to model exactly what a real same-day rollover persists.
async function writeReset(date: string, resetAtMs: number): Promise<void> {
  const dayState = { resetAt: resetAtMs, resetBoundaryAt: resetAtMs };
  await db
    .insert(dailySyncTable)
    .values({ date, data: { dayState }, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [dailySyncTable.date, dailySyncTable.scope],
      set: { data: { dayState } },
    });
}

// A request to /api/me carrying the given Authorization token (or none).
async function meWith(token: string | null): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token) headers["authorization"] = `Bearer ${token}`;
  return fetch(`${baseUrl}/api/me`, { headers });
}

// Forge a legacy token (valid signature, no `iat`) signed with the live secret.
function legacyToken(sub: string): string {
  const secret = process.env.AUTH_TOKEN_SECRET || process.env.SESSION_SECRET;
  if (!secret) throw new Error("missing token secret");
  const b64url = (s: Buffer | string) =>
    Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const body = b64url(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 100_000 }));
  const sig = b64url(createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

// Forge a token with an explicit whole-second `iat`, signed with the live secret.
// Lets a test pin the exact relationship between the token's second-granularity
// issue time and a millisecond boundary (impossible with signToken's iat=now).
function tokenWithIat(sub: string, iatSec: number): string {
  const secret = process.env.AUTH_TOKEN_SECRET || process.env.SESSION_SECRET;
  if (!secret) throw new Error("missing token secret");
  const b64url = (s: Buffer | string) =>
    Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const body = b64url(JSON.stringify({ sub, iat: iatSec, exp: iatSec + 100_000 }));
  const sig = b64url(createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

describe("daily-reset session fence", () => {
  it("rejects a token issued before today's reset (401)", async () => {
    // Reset boundary sits in the future relative to the token we are about to
    // mint, i.e. the token was issued before the reset → fenced out.
    await writeReset(todayStr(), Date.now() + 60_000);
    const res = await meWith(signToken(USER));
    expect(res.status).toBe(401);
  });

  it("accepts a token issued after today's reset (200)", async () => {
    // Reset already happened in the past; the freshly minted token is newer.
    await writeReset(todayStr(), Date.now() - 60_000);
    const res = await meWith(signToken(USER));
    expect(res.status).toBe(200);
  });

  it("accepts every session when today has no reset recorded (200)", async () => {
    // No daily_sync row for today → boundary 0 → nobody is fenced.
    const res = await meWith(signToken(USER));
    expect(res.status).toBe(200);
  });

  it("uses today's row only: a future scheduled reset does not invalidate today (200)", async () => {
    // Scheduling a future production day writes resetAt on a FUTURE row. If the
    // boundary read leaked across days, this far-future reset would log everyone
    // out right now. It must be ignored entirely.
    await writeReset(tomorrowStr(), Date.now() + 1_000_000_000);
    const res = await meWith(signToken(USER));
    expect(res.status).toBe(200);
  });

  it("accepts a token issued in the SAME second as the reset (200)", async () => {
    // The rollover stamps resetAt = Date.now() (full ms) whenever the first
    // device opens the new day — any time of day. A user signing in during that
    // same wall-clock second mints a token whose `iat` is floored to whole
    // seconds, so iat*1000 can land up to ~999ms BEHIND the millisecond boundary
    // even though the sign-in actually happened AFTER the reset. That fresh
    // session must NOT be fenced (the old `iat*1000 < boundaryMs` check bounced
    // it straight back to login with no error).
    const iatSec = Math.floor(Date.now() / 1000);
    await writeReset(todayStr(), iatSec * 1000 + 500); // 500ms into the same second
    const res = await meWith(tokenWithIat(USER, iatSec));
    expect(res.status).toBe(200);
  });

  it("still fences a token from a second strictly before the reset (401)", async () => {
    // A token whose entire issuance second precedes the boundary (>= 1s older) is
    // genuinely from before the reset and must remain fenced.
    const iatSec = Math.floor(Date.now() / 1000);
    await writeReset(todayStr(), iatSec * 1000 + 1500); // 1.5s after the token's second
    const res = await meWith(tokenWithIat(USER, iatSec));
    expect(res.status).toBe(401);
  });

  it("fences at the exact one-second threshold boundary (401)", async () => {
    // Locks the off-by-one contract: when the boundary lands exactly on the START
    // of the NEXT second ((iat + 1) * 1000), the token's whole second is before it,
    // so it must be fenced. (Guards against a regression back to a `<` comparison.)
    const iatSec = Math.floor(Date.now() / 1000);
    await writeReset(todayStr(), (iatSec + 1) * 1000);
    const res = await meWith(tokenWithIat(USER, iatSec));
    expect(res.status).toBe(401);
  });

  it("fences out a legacy token (no iat) when the reset is in the future (401)", async () => {
    // Legacy tokens fall back to the process start time, which predates a reset
    // recorded far in the future → they are correctly fenced out.
    await writeReset(todayStr(), Date.now() + 1_000_000_000);
    const res = await meWith(legacyToken(USER));
    expect(res.status).toBe(401);
  });

  it("accepts a legacy token (no iat) when the reset is in the past (200)", async () => {
    // The process-start fallback is newer than a past reset, so a legacy session
    // is not spuriously logged out.
    await writeReset(todayStr(), Date.now() - 60_000);
    const res = await meWith(legacyToken(USER));
    expect(res.status).toBe(200);
  });
});

// Write side of the same fence. The previous block exercises requireAuth READING
// the boundary; this block proves the midnight rollover actually WRITES it. The
// rollover is a client-pushed payload persisted by the sync endpoints, so these
// tests go through the real HTTP PUT path (auth-gated, like production) instead
// of poking the row directly — if a future change stopped persisting
// dayState.resetAt, the read-side tests above would still pass but these fail.

// PUT a day-state payload through the real sync write path the client uses at
// rollover. `date` is either "today" (→ /sync/today) or an explicit YYYY-MM-DD.
async function putSync(
  date: "today" | string,
  payload: unknown,
  token: string,
): Promise<Response> {
  const reqPath = date === "today" ? "/api/sync/today" : `/api/sync/${date}`;
  return fetch(`${baseUrl}${reqPath}`, {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ senderId: "test", payload }),
  });
}

// Read the persisted dayState.resetAt for `date`, or undefined when no row /
// boundary was recorded.
async function readResetAt(date: string): Promise<number | undefined> {
  const [row] = await db.select().from(dailySyncTable).where(eq(dailySyncTable.date, date));
  const data = row?.data as { dayState?: { resetAt?: unknown } } | null | undefined;
  const resetAt = data?.dayState?.resetAt;
  return typeof resetAt === "number" ? resetAt : undefined;
}

describe("daily-reset rollover write", () => {
  it("PUT /sync/today persists a sane (recent, > 0) resetAt on today's row", async () => {
    const before = Date.now();
    const res = await putSync("today", { dayState: { runs: [], resetAt: Date.now() } }, signToken(USER));
    expect(res.status).toBe(200);

    const resetAt = await readResetAt(todayStr());
    expect(typeof resetAt).toBe("number");
    expect(resetAt!).toBeGreaterThan(0);
    // Recent: between the start of this test and now (small slack for clock skew).
    expect(resetAt!).toBeGreaterThanOrEqual(before);
    expect(resetAt!).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("stamps the boundary on today's row only, leaving a future scheduled day untouched", async () => {
    // A future production day is scheduled ahead of time, carrying its own data
    // and its own resetAt. The rollover that advances TODAY's boundary writes to
    // today's date key only; it must not bleed into that future row.
    const token = signToken(USER);
    const futureResetAt = 111_111;
    await putSync(
      tomorrowStr(),
      { dayState: { runs: [{ id: "r1", brand: "B", flavor: "F" }], resetAt: futureResetAt } },
      token,
    );

    const rolloverResetAt = Date.now();
    const res = await putSync("today", { dayState: { runs: [], resetAt: rolloverResetAt } }, token);
    expect(res.status).toBe(200);

    // Today carries the rollover boundary…
    expect(await readResetAt(todayStr())).toBe(rolloverResetAt);
    // …and the future scheduled day is completely unaffected.
    expect(await readResetAt(tomorrowStr())).toBe(futureResetAt);
  });

  it("fences out a session that was valid before the rollover write (write + read tie-in)", async () => {
    const token = signToken(USER);

    // Before any rollover there is no boundary, so the session is accepted.
    expect((await meWith(token)).status).toBe(200);

    // The midnight rollover advances today's boundary past this token's issue
    // time, going through the very same sync write path the client uses. (+1s
    // keeps the boundary strictly ahead of the just-minted token's second-
    // granularity iat, with no dependence on sub-millisecond timing.)
    const res = await putSync("today", { dayState: { runs: [], resetAt: Date.now() + 1000 } }, token);
    expect(res.status).toBe(200);

    // Drop the brief boundary cache so the next request reads the freshly
    // written value rather than the pre-rollover 0.
    clearSessionBoundaryCache();

    // Same token, now rejected: the read side honours the boundary the write
    // side just persisted.
    expect((await meWith(token)).status).toBe(401);
  });
});

// PUT a day-state payload for an explicit date while asserting the CLIENT's local
// "today" via ?today= — exactly how a user behind UTC pushes a scheduled day.
async function putSyncWithToday(
  date: string,
  payload: unknown,
  clientTodayDate: string,
  token: string,
): Promise<Response> {
  return fetch(`${baseUrl}/api/sync/${date}?today=${clientTodayDate}`, {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ senderId: "test", payload }),
  });
}

// Read the persisted dayState.resetBoundaryAt (the fence field) for `date`.
async function readBoundaryAt(date: string): Promise<number | undefined> {
  const [row] = await db.select().from(dailySyncTable).where(eq(dailySyncTable.date, date));
  const data = row?.data as { dayState?: { resetBoundaryAt?: unknown } } | null | undefined;
  const b = data?.dayState?.resetBoundaryAt;
  return typeof b === "number" ? b : undefined;
}

// Regression for the "reset fires ~2 hours early" bug. The server runs in UTC; a
// user behind UTC in their evening is still on their LOCAL today while the server
// has already ticked to the next calendar day. Their scheduled "tomorrow" then
// equals the SERVER's UTC "today". Because writing a future day stamps
// dayState.resetAt = now (the client's future-day override), a fence that read
// resetAt off the UTC-today row would sign the whole shift out hours before their
// real local midnight. The fence must read resetBoundaryAt, set ONLY for a
// genuine same-day write, so this override can't fence anyone.
describe("cross-UTC daily-reset fence (server UTC ahead of the operator's local day)", () => {
  it("does NOT fence when a future scheduled day equals the server's UTC today", async () => {
    const token = signToken(USER);
    // Server's UTC "today" (what getSessionBoundaryMs reads) is the operator's
    // "tomorrow"; the operator's real local day is one behind UTC.
    const serverToday = todayStr();
    const operatorToday = yesterdayStr();

    // The operator, in their evening, pushes their scheduled tomorrow (= server
    // UTC today) with the future-day resetAt=now override, keyed to their own
    // local date.
    const res1 = await putSyncWithToday(
      serverToday,
      { dayState: { runs: [{ id: "r1", brand: "B", flavor: "F" }], resetAt: Date.now() } },
      operatorToday,
      token,
    );
    expect(res1.status).toBe(200);
    clearSessionBoundaryCache();

    // The session must survive — this was a future-day override, not today's reset…
    expect((await meWith(token)).status).toBe(200);
    // …and no fence boundary was recorded on that row.
    expect(await readBoundaryAt(serverToday)).toBeUndefined();
  });

  it("DOES fence when the operator's real local day rolls over (date === client today)", async () => {
    const token = signToken(USER);
    const serverToday = todayStr();

    // Genuine rollover: the operator's local day IS the server's day, so the
    // write records the fence boundary and older sessions are signed out.
    const res1 = await putSyncWithToday(
      serverToday,
      { dayState: { runs: [], resetAt: Date.now() + 1000 } },
      serverToday,
      token,
    );
    expect(res1.status).toBe(200);
    clearSessionBoundaryCache();

    expect((await meWith(token)).status).toBe(401);
    expect(await readBoundaryAt(serverToday)).toBeGreaterThan(0);
  });

  it("strips a client-supplied resetBoundaryAt on a future-day write (server-authoritative)", async () => {
    // The fence is derived server-side; a client must not be able to fence peers
    // by echoing resetBoundaryAt onto a future-day (non-current) row.
    const token = signToken(USER);
    const serverToday = todayStr();
    const operatorToday = yesterdayStr();

    const res1 = await putSyncWithToday(
      serverToday,
      { dayState: { runs: [], resetAt: Date.now(), resetBoundaryAt: Date.now() + 1_000_000 } },
      operatorToday,
      token,
    );
    expect(res1.status).toBe(200);
    clearSessionBoundaryCache();

    expect(await readBoundaryAt(serverToday)).toBeUndefined();
    expect((await meWith(token)).status).toBe(200);
  });

  it("preserves an existing boundary when a later future-day write targets that row", async () => {
    // Once a genuine same-day write recorded the boundary, a subsequent write that
    // treats the same row as a NON-current day (date !== client today) must not
    // erase it — otherwise a stray future-day push could unfence the shift.
    const token = signToken(USER);
    const serverToday = todayStr();
    const tomorrow = tomorrowStr();

    // Genuine same-day write establishes the boundary.
    const genuineReset = Date.now() + 1000;
    const res1 = await putSyncWithToday(
      serverToday,
      { dayState: { runs: [], resetAt: genuineReset } },
      serverToday,
      token,
    );
    expect(res1.status).toBe(200);
    expect(await readBoundaryAt(serverToday)).toBe(genuineReset);

    // A later write treats serverToday as a NON-current day (client is on tomorrow)
    // and omits any boundary; the stored boundary must survive.
    const res2 = await putSyncWithToday(
      serverToday,
      { dayState: { runs: [], resetAt: genuineReset } },
      tomorrow,
      token,
    );
    expect(res2.status).toBe(200);
    expect(await readBoundaryAt(serverToday)).toBe(genuineReset);
  });
});
