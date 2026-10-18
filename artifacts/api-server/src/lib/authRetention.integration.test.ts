import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

type DbModule = typeof import("@workspace/db");
let db: DbModule["db"];
let pool: DbModule["pool"];
let usersTable: DbModule["usersTable"];
let authSessionsTable: DbModule["authSessionsTable"];
let staffInvitationsTable: DbModule["staffInvitationsTable"];
let runAuthRetention: typeof import("./authRetention")["runAuthRetention"];
let sessionRetentionMs: number;
let invitationRetentionMs: number;

let adminPool: pg.Pool;
let testDbName: string;
let originalDatabaseUrl: string | undefined;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set to run integration tests");

  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  adminPool.on("error", () => {});
  testDbName = `helium_auth_retention_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await adminPool.query(`CREATE DATABASE "${testDbName}"`);

  const testUrl = new URL(originalDatabaseUrl);
  testUrl.pathname = `/${testDbName}`;
  const testUrlString = testUrl.toString();
  const push = spawnSync("pnpm", ["--filter", "@workspace/db", "run", "push-force"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: testUrlString },
    encoding: "utf8",
  });
  if (push.status !== 0) {
    throw new Error(`drizzle push failed:\n${push.stdout}\n${push.stderr}`);
  }

  process.env.DATABASE_URL = testUrlString;
  const dbModule = await import("@workspace/db");
  const authSessionsModule = await import("./authSessions");
  const invitationsModule = await import("./invitations");
  const retentionModule = await import("./authRetention");
  db = dbModule.db;
  pool = dbModule.pool;
  usersTable = dbModule.usersTable;
  authSessionsTable = dbModule.authSessionsTable;
  staffInvitationsTable = dbModule.staffInvitationsTable;
  sessionRetentionMs = authSessionsModule.AUTH_SESSION_RETENTION_MS;
  invitationRetentionMs = invitationsModule.STAFF_INVITATION_RETENTION_MS;
  runAuthRetention = retentionModule.runAuthRetention;
}, 60_000);

afterAll(async () => {
  if (pool) await pool.end();
  if (adminPool) {
    if (testDbName) await adminPool.query(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
    await adminPool.end();
  }
  process.env.DATABASE_URL = originalDatabaseUrl;
}, 60_000);

describe("auth retention", () => {
  it("removes only rows beyond their grace periods", async () => {
    const now = Date.UTC(2026, 8, 21, 12);
    const userId = "retention-user";
    await db.insert(usersTable).values({
      id: userId,
      username: "retention-user",
      passwordHash: "not-used",
    });

    const sessionIds = {
      oldExpired: randomUUID(),
      recentExpired: randomUUID(),
      active: randomUUID(),
      revokedButUnexpired: randomUUID(),
    };
    const backlogIds = Array.from(
      { length: sessionRetentionMs > 0 ? 1_001 : 0 },
      () => randomUUID(),
    );
    await db.insert(authSessionsTable).values([
      {
        id: sessionIds.oldExpired,
        userId,
        tokenHash: "session-old-expired",
        expiresAt: new Date(now - sessionRetentionMs - 1),
      },
      {
        id: sessionIds.recentExpired,
        userId,
        tokenHash: "session-recent-expired",
        expiresAt: new Date(now - sessionRetentionMs + 1),
      },
      {
        id: sessionIds.active,
        userId,
        tokenHash: "session-active",
        expiresAt: new Date(now + 60_000),
      },
      {
        id: sessionIds.revokedButUnexpired,
        userId,
        tokenHash: "session-revoked-unexpired",
        expiresAt: new Date(now + 60_000),
        revokedAt: new Date(now - sessionRetentionMs - 1),
      },
      ...backlogIds.map((id, index) => ({
        id,
        userId,
        tokenHash: `session-backlog-${index}`,
        expiresAt: new Date(now - sessionRetentionMs - 1),
      })),
    ]);

    const invitationIds = {
      oldExpired: randomUUID(),
      oldConsumed: randomUUID(),
      oldRevoked: randomUUID(),
      recentExpired: randomUUID(),
      usable: randomUUID(),
    };
    const future = new Date(now + 60_000);
    await db.insert(staffInvitationsTable).values([
      {
        id: invitationIds.oldExpired,
        tokenHash: "invite-old-expired",
        invitedBy: userId,
        expiresAt: new Date(now - invitationRetentionMs - 1),
      },
      {
        id: invitationIds.oldConsumed,
        tokenHash: "invite-old-consumed",
        invitedBy: userId,
        expiresAt: future,
        consumedAt: new Date(now - invitationRetentionMs - 1),
      },
      {
        id: invitationIds.oldRevoked,
        tokenHash: "invite-old-revoked",
        invitedBy: userId,
        expiresAt: future,
        revokedAt: new Date(now - invitationRetentionMs - 1),
      },
      {
        id: invitationIds.recentExpired,
        tokenHash: "invite-recent-expired",
        invitedBy: userId,
        expiresAt: new Date(now - invitationRetentionMs + 1),
      },
      {
        id: invitationIds.usable,
        tokenHash: "invite-usable",
        invitedBy: userId,
        expiresAt: future,
      },
    ]);

    await expect(runAuthRetention(now)).resolves.toEqual({
      sessionsDeleted: 1_003,
      invitationsDeleted: 3,
    });

    const sessions = await db.select({ id: authSessionsTable.id }).from(authSessionsTable);
    expect(sessions.map(({ id }) => id).sort()).toEqual([
      sessionIds.active,
      sessionIds.recentExpired,
    ].sort());

    const invitations = await db.select({ id: staffInvitationsTable.id }).from(staffInvitationsTable);
    expect(invitations.map(({ id }) => id).sort()).toEqual([
      invitationIds.recentExpired,
      invitationIds.usable,
    ].sort());
  });
});