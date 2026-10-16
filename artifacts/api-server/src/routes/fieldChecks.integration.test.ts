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
import { eq, sql } from "drizzle-orm";
import { signLegacyTokenForTests } from "../lib/auth";
import type { FieldChecksReport } from "../lib/fieldChecks";
let FIELD_CHECK_RETENTION_DAYS: number;

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
const SUPERVISOR = "field-supervisor";
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
  // Import only after selecting the disposable DB: fieldChecks imports the DB pool.
  ({ FIELD_CHECK_RETENTION_DAYS } = await import("../lib/fieldChecks"));
  const dbModule = await import("@workspace/db");
  // This suite's historical disposable schema can predate additive lifecycle
  // columns when drizzle's push cache is reused. Keep the fixture explicitly
  // compatible with the nullable persisted revoke watermark.
  await dbModule.db.execute(sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS session_revoked_at TIMESTAMPTZ
  `);
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
    { id: SUPERVISOR, username: SUPERVISOR, passwordHash: "x" },
  ]);
  await db.insert(userRolesTable).values([
    { userId: PHONE_USER, role: "operator" },
    { userId: TABLET_USER, role: "operator" },
    { userId: MANAGER, role: "manager" },
    { userId: SUPERVISOR, role: "supervisor" },
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
      authorization: `Bearer ${signLegacyTokenForTests(userId)}`,
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

function syncAcknowledgmentObservation(
  observationId: string,
  outcome: "success" | "failure",
) {
  return {
    observationId,
    checkName: "sync-acknowledgment",
    checkVersion: "1",
    outcome,
    observedAt: new Date().toISOString(),
    appBuild: "sync-recovery-integration",
    deviceCategory: "mobile-chrome",
    metrics: { latencyMs: outcome === "failure" ? 321 : 123 },
  };
}

describe("field-check evidence from two authenticated clients", () => {
  it("retains v3 allowlisted causes and sources through deduplication and recovery", async () => {
    const inputs = [
      ...[1, 2, 3].map((failureCode) => ({
        checkName: "sync-acknowledgment", metrics: { failureCode },
      })),
      ...[1, 2, 3, 4].map((sourceCode) => ({
        checkName: "performance", metrics: { sourceCode, durationMs: 20_000 + sourceCode },
      })),
    ].map((input, index) => ({
      ...input, observationId: `v3-diagnostic-fixture-${index}`,
      checkVersion: "3", outcome: "failure", observedAt: new Date(Date.now() - 1000).toISOString(),
      appBuild: "local", deviceCategory: "mobile-chrome",
    }));
    const first = await request(PHONE_USER, "POST", "/api/field-checks/observations", { observations: inputs });
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({ accepted: 7, duplicate: 0 });
    const replay = await request(TABLET_USER, "POST", "/api/field-checks/observations", { observations: inputs });
    expect(await replay.json()).toEqual({ accepted: 0, duplicate: 7 });
    for (const metrics of [{ failureCode: 99 }, { failureCode: 1, runId: 123 }]) {
      const invalid = await request(PHONE_USER, "POST", "/api/field-checks/observations", {
        observations: [{ ...inputs[0], observationId: "v3-invalid-diagnostic", metrics }],
      });
      expect(invalid.status).toBe(400);
    }
    const report = await (await request(MANAGER, "GET", "/api/field-checks")).json() as FieldChecksReport;
    const sync = report.checks.find((check: { name: string }) => check.name === "sync-acknowledgment");
    const perf = report.checks.find((check: { name: string }) => check.name === "performance");
    if (!sync || !perf) throw new Error("Expected both diagnostic checks in the fixture report");
    expect(sync).toMatchObject({ failureCount: 3, actionable: true, status: "needs-review" });
    expect(sync.recentFailures.map((failure: { metrics: unknown }) => failure.metrics))
      .toEqual(expect.arrayContaining([{ failureCode: 1 }, { failureCode: 2 }, { failureCode: 3 }]));
    expect(perf.recentFailures.map((failure: { metrics: unknown }) => failure.metrics))
      .toEqual(expect.arrayContaining(inputs.slice(3).map((input) => input.metrics)));
    await request(PHONE_USER, "POST", "/api/field-checks/observations", {
      observations: [{
        ...inputs[0], observationId: "v3-sync-recovered", outcome: "success",
        metrics: {}, observedAt: new Date().toISOString(),
      }],
    });
    const recovered = await (await request(MANAGER, "GET", "/api/field-checks")).json() as FieldChecksReport;
    expect(recovered.checks.find((check: { name: string }) => check.name === "sync-acknowledgment"))
      .toMatchObject({ status: "healthy", actionable: false, failureCount: 3, recentFailures: expect.arrayContaining(sync.recentFailures) });
  });
  it("persists bounded workflow outcomes and exposes only their duration summary", async () => {
    const observation = {
      observationId: "browser-spec-import:spec-import-review-commit:1:success",
      checkName: "spec-import-review-commit",
      checkVersion: "1",
      outcome: "success",
      observedAt: new Date().toISOString(),
      appBuild: "workflow-evidence-integration",
      deviceCategory: "desktop-chrome",
      metrics: { durationMs: 8_321 },
    };
    const accepted = await request(PHONE_USER, "POST", "/api/field-checks/observations", {
      observations: [observation],
    });
    expect(accepted.status).toBe(202);
    expect(await accepted.json()).toEqual({ accepted: 1, duplicate: 0 });

    const invalid = await request(PHONE_USER, "POST", "/api/field-checks/observations", {
      observations: [{
        ...observation,
        observationId: "browser-spec-import:spec-import-review-commit:2:success",
        metrics: { durationMs: 8_321, recipeCount: 4 },
      }],
    });
    expect(invalid.status).toBe(400);

    const reportResponse = await request(MANAGER, "GET", "/api/field-checks");
    expect(reportResponse.status).toBe(200);
    const report = await reportResponse.json() as {
      checks: Array<{
        name: string;
        lastSuccessfulMetrics: Record<string, number> | null;
      }>;
    };
    expect(report.checks.find((check) => check.name === "spec-import-review-commit")?.lastSuccessfulMetrics)
      .toEqual({ durationMs: 8_321 });
    expect((await db.select().from(dailySyncTable))).toEqual([]);
  });

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
    expect(runRows).toEqual([]);
  });

  it("clears an expired legacy sync failure after current acknowledgment evidence", async () => {
    const legacyFailure = syncAcknowledgmentObservation(
      "legacy-sync-ack-failure",
      "failure",
    );
    const failureResponse = await request(PHONE_USER, "POST", "/api/field-checks/observations", {
      observations: [legacyFailure],
    });
    expect(failureResponse.status).toBe(202);

    await db.update(fieldCheckObservationsTable)
      .set({
        receivedAt: new Date(
          Date.now() - (FIELD_CHECK_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000,
        ),
      })
      .where(eq(fieldCheckObservationsTable.observationId, legacyFailure.observationId));

    const recoveryResponse = await request(
      TABLET_USER,
      "POST",
      "/api/field-checks/observations",
      {
        observations: [
          syncAcknowledgmentObservation("current-sync-ack-recovery", "success"),
        ],
      },
    );
    expect(recoveryResponse.status).toBe(202);

    const reportResponse = await request(MANAGER, "GET", "/api/field-checks");
    expect(reportResponse.status).toBe(200);
    const report = await reportResponse.json() as {
      actionableCount: number;
      overallStatus: string;
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
    expect(report.actionableCount).toBe(0);
    expect(report.overallStatus).not.toBe("needs-review");
    expect(report.checks.find((check) => check.name === "sync-acknowledgment")).toMatchObject({
      status: "healthy",
      failureCount: 1,
      actionable: false,
      issueStatus: "recovered",
      recentFailures: [],
      lastSuccessfulAt: expect.any(String),
    });
  });
});

describe("filtered field evidence", () => {
  it("derives counts, rows and recovery from the full retained scoped population", async () => {
    const now = Date.now();
    const rows = [
      ...Array.from({ length: 7 }, (_, i) => ({
        ...observation(`selected-${i}`, "failure", "mobile-chrome"),
        appBuild: "local", observedAt: new Date(now - 60_000 - i * 1000).toISOString(),
      })),
      ...Array.from({ length: 6 }, (_, i) => ({
        ...observation(`other-build-${i}`, "failure", "tablet-browser"),
        appBuild: "build-b", observedAt: new Date(now - 30_000 - i * 1000).toISOString(),
      })),
      { ...observation("other-build-success", "success", "mobile-chrome"), appBuild: "build-b",
        observedAt: new Date(now - 1000).toISOString() },
      { ...observation("same-build-other-browser-success", "success", "tablet-browser"),
        appBuild: "local", observedAt: new Date(now - 2000).toISOString() },
    ];
    expect((await request(PHONE_USER, "POST", "/api/field-checks/observations", { observations: rows })).status).toBe(202);
    await db.insert(fieldCheckObservationsTable).values([
      { scope: "sandbox", observationId: "sandbox-only", checkName: "cross-device-convergence",
        checkVersion: "1", outcome: "failure", appBuild: "local", deviceCategory: "mobile-chrome",
        observedAt: new Date(now), receivedAt: new Date(now), metrics: {} },
      { scope: "live", observationId: "expired-only", checkName: "cross-device-convergence",
        checkVersion: "1", outcome: "failure", appBuild: "local", deviceCategory: "mobile-chrome",
        observedAt: new Date(now - 100_000), receivedAt: new Date(now - 31 * 86400_000), metrics: {} },
    ]);
    const observationsBefore = await db.select().from(fieldCheckObservationsTable);
    const issuesBefore = await db.select().from(fieldCheckIssuesTable);
    const report = async (query = "") => {
      const response = await request(MANAGER, "GET", `/api/field-checks${query}`);
      expect(response.status).toBe(200);
      return await response.json() as FieldChecksReport;
    };
    const unfiltered = await report();
    expect(unfiltered.population.countBasis).toBe("lifetime-issues");
    expect(unfiltered.checks.find((c) => c.name === "cross-device-convergence"))
      .toMatchObject({ failureCount: 13, actionable: false, issueStatus: "recovered" });
    const selected = await report("?appBuild=local&deviceCategory=mobile-chrome");
    expect(selected.population).toEqual({
      appBuild: "local", deviceCategory: "mobile-chrome", countBasis: "retained-observations", retentionDays: 30,
    });
    expect(selected.checks.find((c) => c.name === "cross-device-convergence"))
      .toMatchObject({ failureCount: 7, incompleteCount: 0, actionable: true, issueStatus: "open",
        lastSuccessfulAt: null, recentFailures: expect.any(Array) });
    expect(selected.checks.find((c) => c.name === "cross-device-convergence")?.recentFailures).toHaveLength(5);
    const buildOnly = await report("?appBuild=local");
    expect(buildOnly.checks.find((c) => c.name === "cross-device-convergence"))
      .toMatchObject({ failureCount: 7, actionable: false, issueStatus: "recovered" });
    const browserOnly = await report("?deviceCategory=mobile-chrome");
    expect(browserOnly.checks.find((c) => c.name === "cross-device-convergence"))
      .toMatchObject({ failureCount: 7, actionable: false, issueStatus: "recovered" });
    for (const query of ["?appBuild=missing", "?appBuild=LOCAL", "?appBuild=local&deviceCategory=mobile-safari"]) {
      const empty = await report(query);
      expect(empty.actionableCount).toBe(0);
      expect(empty.checks.every((c) => c.failureCount === 0 && c.incompleteCount === 0 &&
        c.lastSuccessfulAt === null && c.issueStatus === null && c.recentFailures.length === 0)).toBe(true);
    }
    expect(await db.select().from(fieldCheckObservationsTable)).toEqual(observationsBefore);
    expect(await db.select().from(fieldCheckIssuesTable)).toEqual(issuesBefore);
    expect(await db.select().from(dailySyncTable)).toEqual([]);
    // An older success arriving last must not recover newer failures.
    expect((await request(PHONE_USER, "POST", "/api/field-checks/observations", {
      observations: [{ ...rows[0], observationId: "late-old-success", outcome: "success",
        observedAt: new Date(now - 120_000).toISOString() }],
    })).status).toBe(202);
    expect((await report("?appBuild=local&deviceCategory=mobile-chrome")).checks.find((c) => c.name === "cross-device-convergence"))
      .toMatchObject({ actionable: true, issueStatus: "open" });
    expect((await request(PHONE_USER, "POST", "/api/field-checks/observations", {
      observations: [{ ...rows[0], observationId: "selected-recovery", outcome: "success",
        observedAt: new Date().toISOString() }],
    })).status).toBe(202);
    expect((await report("?appBuild=local&deviceCategory=mobile-chrome")).checks.find((c) => c.name === "cross-device-convergence"))
      .toMatchObject({ failureCount: 7, actionable: false, issueStatus: "recovered" });
  });

  it("rejects malformed filters and preserves review authorization", async () => {
    for (const query of [
      "?appBuild=", `?appBuild=${"a".repeat(101)}`, "?appBuild=a&appBuild=b",
      "?deviceCategory=unknown", "?deviceCategory=mobile-chrome&deviceCategory=mobile-safari",
      "?appBuild%5Bx%5D=a", "?scope=sandbox", "?appBuild=%20local%20",
    ]) expect((await request(MANAGER, "GET", `/api/field-checks${query}`)).status).toBe(400);
    expect((await request(PHONE_USER, "GET", "/api/field-checks?appBuild=local")).status).toBe(403);
    expect((await fetch(`${baseUrl}/api/field-checks?appBuild=local`)).status).toBe(401);
  });

  it("uses matching incomplete counts for escalation and later recovery", async () => {
    const inputs = Array.from({ length: 3 }, (_, i) => ({
      ...observation(`incomplete-${i}`, "failure", "mobile-chrome"),
      outcome: "incomplete", appBuild: "selected", observedAt: new Date(Date.now() - 10_000 - i * 1000).toISOString(),
    }));
    expect((await request(PHONE_USER, "POST", "/api/field-checks/observations", { observations: inputs })).status).toBe(202);
    const response = await request(MANAGER, "GET", "/api/field-checks?appBuild=selected");
    const report = await response.json() as FieldChecksReport;
    expect(report.checks.find((c) => c.name === "cross-device-convergence"))
      .toMatchObject({ failureCount: 0, incompleteCount: 3, actionable: true, issueStatus: "open" });
  });
});

describe("manager-only hardware confirmations", () => {
  it("records an iPhone confirmation and reports the expanded catalog", async () => {
    const response = await request(
      MANAGER,
      "POST",
      "/api/field-checks/hardware-confirmations",
      {
        checkName: "safe-area-clearance",
        checkVersion: "2026-09",
        outcome: "success",
        observedAt: new Date().toISOString(),
        deviceCategory: "iphone",
      },
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ accepted: 1, duplicate: 0 });

    const reportResponse = await request(MANAGER, "GET", "/api/field-checks");
    expect(reportResponse.status).toBe(200);
    const report = await reportResponse.json() as {
      scope: string;
      checks: Array<{ name: string; observedBy: string; status: string; recentFailures: unknown[] }>;
    };
    expect(report.scope).toBe("current facility");
    expect(report.checks.find((check) => check.name === "safe-area-clearance")).toMatchObject({
      observedBy: "hardware",
      status: "healthy",
      recentFailures: [],
    });
    expect(report.checks.find((check) => check.name === "offline-queue-replay")).toMatchObject({
      observedBy: "browser",
      status: "collecting",
    });
  });

  it("rejects browser categories for guided confirmations", async () => {
    const response = await request(
      MANAGER,
      "POST",
      "/api/field-checks/hardware-confirmations",
      {
        checkName: "orientation-layout",
        checkVersion: "2026-09",
        outcome: "success",
        observedAt: new Date().toISOString(),
        deviceCategory: "mobile-safari",
      },
    );
    expect(response.status).toBe(400);
  });

  it("rejects the seeded supervisor without recording an observation", async () => {
    const response = await request(
      SUPERVISOR,
      "POST",
      "/api/field-checks/hardware-confirmations",
      {
        checkName: "touch-accuracy",
        checkVersion: "2026-09",
        outcome: "success",
        observedAt: new Date().toISOString(),
        deviceCategory: "android-phone",
      },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Manager role required" });

    const observations = await db.select().from(fieldCheckObservationsTable);
    expect(observations).toEqual([]);
  });
});
