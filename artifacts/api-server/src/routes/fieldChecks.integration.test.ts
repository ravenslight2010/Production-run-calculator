// Integration coverage for facility-scoped field evidence from two authenticated
// clients. The test uses a disposable database and imports the router only after
// DATABASE_URL points at it.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express, { type Express } from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { sql } from "drizzle-orm";
import { signToken } from "../lib/auth";

type DbModule = typeof import("@workspace/db");
let db: DbModule["db"];
let pool: DbModule["pool"];
let usersTable: DbModule["usersTable"];
let userRolesTable: DbModule["userRolesTable"];
let rolesTable: DbModule["rolesTable"];
let fieldCheckObservationsTable: DbModule["fieldCheckObservationsTable"];
let fieldCheckIssuesTable: DbModule["fieldCheckIssuesTable"];
let dailySyncTable: DbModule["dailySyncTable"];
let seedRoles: () => Promise<void>;

let adminPool: pg.Pool;
let testDbName: string;
let originalDatabaseUrl: string | undefined;
let server: Server;
let baseUrl: string;

const PHONE_USER = "field-phone-user";
const TABLET_USER = "field-tablet-user";
const MANAGER = "field-manager";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set to run integration tests");

  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  adminPool.on("error", () => {});
  testDbName = `helium_field_checks_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  const router = (await import("./index")).default;
  db = dbModule.db;
  pool = dbModule.pool;
  usersTable = dbModule.usersTable;
  userRolesTable = dbModule.userRolesTable;
  rolesTable = dbModule.rolesTable;
  fieldCheckObservationsTable = dbModule.fieldCheckObservationsTable;
  fieldCheckIssuesTable = dbModule.fieldCheckIssuesTable;
  dailySyncTable = dbModule.dailySyncTable;
  seedRoles = (await import("../lib/roles")).seedRoles;

  const app: Express = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = {
      info() {},
      warn() {},
      error() {},
      debug() {},
    } as unknown as typeof req.log;
    next();
  });
  app.use("/api", router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (pool) await pool.end();
  if (adminPool) {
    if (testDbName) {
      await adminPool.query(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
    }
    await adminPool.end();
  }
  process.env.DATABASE_URL = originalDatabaseUrl;
}, 60_000);

beforeEach(async () => {
  await db.execute(sql`
    TRUNCATE
      ${fieldCheckObservationsTable},
      ${fieldCheckIssuesTable},
      ${dailySyncTable},
      ${userRolesTable},
      ${usersTable},
      ${rolesTable}
    RESTART IDENTITY CASCADE
  `);
  await seedRoles();
  await db.insert(usersTable).values([
    { id: PHONE_USER, username: PHONE_USER, passwordHash: "x" },
    { id: TABLET_USER, username: TABLET_USER, passwordHash: "x" },
    { id: MANAGER, username: MANAGER, passwordHash: "x" },
  ]);
  await db.insert(userRolesTable).values([
    { userId: PHONE_USER, role: "operator" },
    { userId: TABLET_USER, role: "operator" },
    { userId: MANAGER, role: "manager" },
  ]);
});

async function request(
  userId: string,
  method: string,
  pathname: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${signToken(userId)}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function observation(
  observationId: string,
  outcome: "success" | "failure",
  deviceCategory: "mobile-chrome" | "tablet-browser",
) {
  return {
    observationId,
    checkName: "cross-device-convergence",
    checkVersion: "1",
    outcome,
    observedAt: new Date().toISOString(),
    appBuild: "two-device-integration",
    deviceCategory,
    metrics: { latencyMs: outcome === "failure" ? 321 : 123 },
  };
}

describe("field-check evidence from two authenticated clients", () => {
  it("deduplicates a shared failure and preserves bounded context after recovery", async () => {
    const failure = observation("phone-tablet-shared-failure", "failure", "mobile-chrome");
    const first = await request(PHONE_USER, "POST", "/api/field-checks/observations", {
      observations: [failure],
    });
    const replay = await request(TABLET_USER, "POST", "/api/field-checks/observations", {
      observations: [failure],
    });
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({ accepted: 1, duplicate: 0 });
    expect(replay.status).toBe(202);
    expect(await replay.json()).toEqual({ accepted: 0, duplicate: 1 });

    const failedReportResponse = await request(MANAGER, "GET", "/api/field-checks");
    expect(failedReportResponse.status).toBe(200);
    const failedReport = await failedReportResponse.json() as {
      checks: Array<{
        name: string;
        failureCount: number;
        actionable: boolean;
        recentFailures: Array<{ appBuild: string; deviceCategory: string }>;
      }>;
    };
    expect(
      failedReport.checks.find((check) => check.name === "cross-device-convergence"),
    ).toMatchObject({
      failureCount: 1,
      actionable: true,
      recentFailures: [{
        appBuild: "two-device-integration",
        deviceCategory: "mobile-chrome",
      }],
    });

    const recovery = await request(
      TABLET_USER,
      "POST",
      "/api/field-checks/observations",
      { observations: [observation("tablet-later-recovery", "success", "tablet-browser")] },
    );
    expect(recovery.status).toBe(202);

    const recoveredReportResponse = await request(MANAGER, "GET", "/api/field-checks");
    const recoveredReport = await recoveredReportResponse.json() as {
      checks: Array<{
        name: string;
        status: string;
        failureCount: number;
        actionable: boolean;
        issueStatus: string | null;
        recentFailures: unknown[];
        lastSuccessfulAt: string | null;
      }>;
    };
    expect(
      recoveredReport.checks.find((check) => check.name === "cross-device-convergence"),
    ).toMatchObject({
      status: "healthy",
      failureCount: 1,
      actionable: false,
      issueStatus: "recovered",
      recentFailures: [expect.any(Object)],
      lastSuccessfulAt: expect.any(String),
    });

    const runRows = await db.select().from(dailySyncTable);

    const observedAt = new Date().toISOString();
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      checkName: "touch-accuracy",
      checkVersion: "2026-09",
      outcome: "success",
      appBuild: "hardware-protocol",
      deviceCategory: "android-phone",
      metrics: {},
    });
  });
});

    const observations = await db.select().from(fieldCheckObservationsTable);

    const staffResponse = await request(
      PHONE_USER,
      "POST",
      "/api/field-checks/hardware-confirmations",
      {
        ...managerConfirmation,
        checkName: "keyboard-clearance",
      },
    );

    const managerResponse = await request(
      MANAGER,
      "POST",
      "/api/field-checks/hardware-confirmations",
      managerConfirmation,
    );

    const managerConfirmation = {
      checkName: "touch-accuracy",
      checkVersion: "2026-09",
      outcome: "success",
      observedAt,
      deviceCategory: "android-phone",
    } as const;

    const passiveResponse = await request(
      PHONE_USER,
      "POST",
      "/api/field-checks/observations",
      {
        observations: [{
          observationId: "passive-hardware-claim",
          ...managerConfirmation,
          appBuild: "passive-browser-test",
          metrics: {},
        }],
      },
    );
