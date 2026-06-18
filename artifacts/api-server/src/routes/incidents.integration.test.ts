// Integration tests for the incident reporting + AI diagnosis flow.
//
// Anyone signed in can report an issue (or auto-submit a crash) and gets back a
// plain-language diagnosis + workaround; the incident is persisted with that
// diagnosis. Managers get a review list, an unreviewed count (for the nav
// badge), and can mark incidents reviewed. These tests guard:
//   - reporting is open to any role and persists the incident + diagnosis;
//   - the diagnosis is recorded even when the AI provider fails (fallback text);
//   - empty submissions are rejected;
//   - the manager-only endpoints (list/get/review/count) reject operators;
//   - the unreviewed count drives down as incidents are reviewed.
//
// They run the real router against a disposable Postgres database (created from
// the dev DATABASE_URL's server, schema pushed via drizzle-kit, dropped on
// teardown). The OpenAI client is mocked so no paid request is made.
//
// @workspace/db binds its pool to process.env.DATABASE_URL at import time, so we
// create the throwaway DB and repoint DATABASE_URL BEFORE importing the router —
// hence the dynamic imports inside beforeAll.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, sql } from "drizzle-orm";
import express, { type Express } from "express";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import pg from "pg";
import { signToken } from "../lib/auth";

// Controllable mock of the OpenAI chat client. `nextContent` is what the model
// "returns"; `shouldThrow` simulates a provider outage.
const mock = vi.hoisted(() => ({
  nextContent: "" as string | null,
  shouldThrow: false as boolean,
  calls: 0,
}));

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: {
    chat: {
      completions: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        create: async (_args: any) => {
          mock.calls += 1;
          if (mock.shouldThrow) throw new Error("provider blew up");
          return { choices: [{ message: { content: mock.nextContent } }] };
        },
      },
    },
  },
}));

type DbModule = typeof import("@workspace/db");
let db: DbModule["db"];
let pool: DbModule["pool"];
let usersTable: DbModule["usersTable"];
let userRolesTable: DbModule["userRolesTable"];
let incidentsTable: DbModule["incidentsTable"];

let clearUserValidityCache: () => void;

let adminPool: pg.Pool;
let testDbName: string;
let originalDatabaseUrl: string | undefined;
let server: Server;
let baseUrl: string;

const MANAGER = "manager-1";
const OPERATOR = "operator-1";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set to run integration tests");

  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  testDbName = `helium_incidents_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  clearUserValidityCache = userValidityMod.clearUserValidityCache;
  db = dbMod.db;
  pool = dbMod.pool;
  usersTable = dbMod.usersTable;
  userRolesTable = dbMod.userRolesTable;
  incidentsTable = dbMod.incidentsTable;

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
});

beforeEach(async () => {
  clearUserValidityCache();
  mock.nextContent = JSON.stringify({
    diagnosis: "The save didn't go through.",
    workaround: "Try again in a moment.",
  });
  mock.shouldThrow = false;
  mock.calls = 0;
  await db.execute(
    sql`TRUNCATE ${incidentsTable}, ${userRolesTable}, ${usersTable} RESTART IDENTITY CASCADE`,
  );
  await db.insert(usersTable).values([
    { id: MANAGER, username: "manager", passwordHash: "x" },
    { id: OPERATOR, username: "operator", passwordHash: "x" },
  ]);
  await db.insert(userRolesTable).values([
    { userId: MANAGER, role: "manager" },
    { userId: OPERATOR, role: "operator" },
  ]);
});

async function req(
  userId: string | null,
  method: string,
  pathname: string,
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (userId) headers["authorization"] = `Bearer ${signToken(userId)}`;
  return fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const userReport = (overrides: Record<string, unknown> = {}) => ({
  source: "user_report",
  screen: "Run",
  appPlatform: "web",
  description: "The Save button does nothing when I tap it.",
  ...overrides,
});

describe("POST /incidents — reporting + diagnosis", () => {
  it("lets an operator report an issue, persists it, and returns the diagnosis", async () => {
    const res = await req(OPERATOR, "POST", "/api/incidents", userReport());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      incidentId: string;
      diagnosis: string;
      workaround: string;
    };
    expect(body.incidentId).toBeTruthy();
    expect(body.diagnosis).toBe("The save didn't go through.");
    expect(body.workaround).toBe("Try again in a moment.");

    const [row] = await db
      .select()
      .from(incidentsTable)
      .where(eq(incidentsTable.id, body.incidentId));
    expect(row.source).toBe("user_report");
    expect(row.reporterId).toBe(OPERATOR);
    expect(row.reporterName).toBe("operator");
    expect(row.reporterRole).toBe("operator");
    expect(row.status).toBe("new");
    expect(row.diagnosis).toBe("The save didn't go through.");
    expect((row.context as { description?: string }).description).toContain("Save button");
  });

  it("persists an auto-captured crash with the error context", async () => {
    const res = await req(OPERATOR, "POST", "/api/incidents", {
      source: "auto_crash",
      screen: "/mobile/inventory",
      appPlatform: "mobile",
      appVersion: "1.4.2",
      errorMessage: "TypeError: cannot read property 'map' of undefined",
      errorStack: "at InventoryScreen (inventory.tsx:42)",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { incidentId: string };
    const [row] = await db
      .select()
      .from(incidentsTable)
      .where(eq(incidentsTable.id, body.incidentId));
    expect(row.source).toBe("auto_crash");
    expect(row.appVersion).toBe("1.4.2");
    const ctx = row.context as { errorMessage?: string; errorStack?: string };
    expect(ctx.errorMessage).toContain("TypeError");
    expect(ctx.errorStack).toContain("InventoryScreen");
  });

  it("records the incident with fallback text when the AI provider fails", async () => {
    mock.shouldThrow = true;
    const res = await req(OPERATOR, "POST", "/api/incidents", userReport());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { incidentId: string; diagnosis: string; workaround: string };
    expect(body.diagnosis).toBeTruthy();
    expect(body.workaround).toBeTruthy();
    const [row] = await db
      .select()
      .from(incidentsTable)
      .where(eq(incidentsTable.id, body.incidentId));
    // The incident is still recorded, with the same fallback text the user saw.
    expect(row.diagnosis).toBe(body.diagnosis);
    expect(row.workaround).toBe(body.workaround);
  });

  it("rejects an empty submission with 400 and never calls the model", async () => {
    const res = await req(OPERATOR, "POST", "/api/incidents", {
      source: "user_report",
      screen: "Run",
      appPlatform: "web",
    });
    expect(res.status).toBe(400);
    expect(mock.calls).toBe(0);
  });

  it("requires authentication", async () => {
    const res = await req(null, "POST", "/api/incidents", userReport());
    expect(res.status).toBe(401);
  });
});

describe("incident review — manager only", () => {
  async function seedIncident(userId: string): Promise<string> {
    const res = await req(userId, "POST", "/api/incidents", userReport());
    const body = (await res.json()) as { incidentId: string };
    return body.incidentId;
  }

  it("lists incidents newest first for a manager and rejects operators", async () => {
    await seedIncident(OPERATOR);
    await seedIncident(MANAGER);

    const forbidden = await req(OPERATOR, "GET", "/api/incidents");
    expect(forbidden.status).toBe(403);

    const res = await req(MANAGER, "GET", "/api/incidents");
    expect(res.status).toBe(200);
    const list = (await res.json()) as Array<{ id: string; createdAt: string }>;
    expect(list.length).toBe(2);
    expect(Date.parse(list[0].createdAt)).toBeGreaterThanOrEqual(Date.parse(list[1].createdAt));
  });

  it("counts unreviewed incidents and drops the count after review", async () => {
    const id = await seedIncident(OPERATOR);
    await seedIncident(OPERATOR);

    const before = await req(MANAGER, "GET", "/api/incidents/unreviewed-count");
    expect(((await before.json()) as { count: number }).count).toBe(2);

    // Operators can't see the count.
    const forbidden = await req(OPERATOR, "GET", "/api/incidents/unreviewed-count");
    expect(forbidden.status).toBe(403);

    const review = await req(MANAGER, "POST", `/api/incidents/${id}/review`);
    expect(review.status).toBe(200);
    const reviewed = (await review.json()) as { status: string; reviewedAt: string | null };
    expect(reviewed.status).toBe("reviewed");
    expect(reviewed.reviewedAt).toBeTruthy();

    const after = await req(MANAGER, "GET", "/api/incidents/unreviewed-count");
    expect(((await after.json()) as { count: number }).count).toBe(1);
  });

  it("returns 404 for an unknown incident id", async () => {
    const get = await req(MANAGER, "GET", "/api/incidents/does-not-exist");
    expect(get.status).toBe(404);
    const review = await req(MANAGER, "POST", "/api/incidents/does-not-exist/review");
    expect(review.status).toBe(404);
  });

  it("fetches a single incident by id for a manager", async () => {
    const id = await seedIncident(OPERATOR);
    const res = await req(MANAGER, "GET", `/api/incidents/${id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; context: { description?: string } };
    expect(body.id).toBe(id);
    expect(body.context.description).toContain("Save button");
  });
});
