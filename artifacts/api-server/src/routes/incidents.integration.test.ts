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
  // The full user prompt the model last received, so tests can assert what the
  // diagnosis was grounded in (e.g. the "SIMILAR PAST INCIDENTS" block).
  lastUserPrompt: "" as string,
}));

vi.mock("@workspace/integrations-openai-ai-server", () => {
  const AI_MODELS = { full: "gpt-5.4", cheap: "gpt-5-mini" } as const;
  return {
    openai: {
      chat: {
        completions: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          create: async (args: any) => {
            mock.calls += 1;
            const messages = (args?.messages ?? []) as Array<{ role: string; content: string }>;
            mock.lastUserPrompt = messages.find((m) => m.role === "user")?.content ?? "";
            if (mock.shouldThrow) throw new Error("provider blew up");
            return { choices: [{ message: { content: mock.nextContent } }] };
          },
        },
      },
    },
    // Routes resolve their model via pickModel(); the mock must export it too,
    // or the call throws "pickModel is not a function" and every route 502s.
    AI_MODELS,
    pickModel: (kind: keyof typeof AI_MODELS = "full") => AI_MODELS[kind],
  };
});

type DbModule = typeof import("@workspace/db");
let db: DbModule["db"];
let pool: DbModule["pool"];
let usersTable: DbModule["usersTable"];
let userRolesTable: DbModule["userRolesTable"];
let rolesTable: DbModule["rolesTable"];
let seedRoles: () => Promise<void>;
let incidentsTable: DbModule["incidentsTable"];
let facilityKnowledgeTable: DbModule["facilityKnowledgeTable"];

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
  adminPool.on("error", () => {});
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
  rolesTable = dbMod.rolesTable;
  seedRoles = (await import("../lib/roles")).seedRoles;
  incidentsTable = dbMod.incidentsTable;
  facilityKnowledgeTable = dbMod.facilityKnowledgeTable;

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
  mock.nextContent = JSON.stringify({
    diagnosis: "The save didn't go through.",
    workaround: "Try again in a moment.",
  });
  mock.shouldThrow = false;
  mock.calls = 0;
  mock.lastUserPrompt = "";
  await db.execute(
    sql`TRUNCATE ${incidentsTable}, ${facilityKnowledgeTable}, ${userRolesTable}, ${usersTable}, ${rolesTable} RESTART IDENTITY CASCADE`,
  );
  // Seed the role catalog so requireCapability can resolve each user's role to a
  // capability set (a manager with no seeded roles would resolve to zero caps).
  await seedRoles();
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

describe("incident resolve — manager only", () => {
  // Seed directly through the DB (rather than the rate-limited POST /incidents)
  // so these tests don't share the per-user report budget with the rest of the
  // file and can't be tipped into a 429 by test ordering.
  async function seedIncident(): Promise<string> {
    const id = `inc_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    await db.insert(incidentsTable).values({
      id,
      source: "user_report",
      reporterId: OPERATOR,
      reporterName: "operator",
      reporterRole: "operator",
      screen: "Run",
      appPlatform: "web",
      context: { description: "The Save button does nothing when I tap it." },
      diagnosis: "The save didn't go through.",
      workaround: "Try again in a moment.",
    });
    return id;
  }

  it("resolves a still-new incident directly and drops the unreviewed count", async () => {
    const id = await seedIncident();

    const before = await req(MANAGER, "GET", "/api/incidents/unreviewed-count");
    expect(((await before.json()) as { count: number }).count).toBe(1);

    const res = await req(MANAGER, "POST", `/api/incidents/${id}/resolve`);
    expect(res.status).toBe(200);
    const resolved = (await res.json()) as {
      status: string;
      reviewedAt: string | null;
      resolvedAt: string | null;
    };
    expect(resolved.status).toBe("resolved");
    // Resolving implies reviewed, so both stamps are set.
    expect(resolved.resolvedAt).toBeTruthy();
    expect(resolved.reviewedAt).toBeTruthy();

    const after = await req(MANAGER, "GET", "/api/incidents/unreviewed-count");
    expect(((await after.json()) as { count: number }).count).toBe(0);
  });

  it("preserves the original reviewedAt when resolving an already-reviewed incident", async () => {
    const id = await seedIncident();
    const reviewRes = await req(MANAGER, "POST", `/api/incidents/${id}/review`);
    const reviewed = (await reviewRes.json()) as { reviewedAt: string };

    const res = await req(MANAGER, "POST", `/api/incidents/${id}/resolve`);
    const resolved = (await res.json()) as {
      status: string;
      reviewedAt: string;
      resolvedAt: string;
    };
    expect(resolved.status).toBe("resolved");
    expect(resolved.reviewedAt).toBe(reviewed.reviewedAt);
    expect(resolved.resolvedAt).toBeTruthy();
  });

  it("does not downgrade a resolved incident when marked reviewed", async () => {
    const id = await seedIncident();
    await req(MANAGER, "POST", `/api/incidents/${id}/resolve`);

    const res = await req(MANAGER, "POST", `/api/incidents/${id}/review`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("resolved");
  });

  it("rejects operators and 404s an unknown id", async () => {
    const id = await seedIncident();
    const forbidden = await req(OPERATOR, "POST", `/api/incidents/${id}/resolve`);
    expect(forbidden.status).toBe(403);

    const missing = await req(MANAGER, "POST", "/api/incidents/does-not-exist/resolve");
    expect(missing.status).toBe(404);
  });
});

describe("history-aware diagnosis — grounding + write-back", () => {
  // The per-user report rate limit (in-memory, keyed by userId) is NOT reset
  // between tests, and the earlier describe blocks burn through OPERATOR's
  // budget. Give each test here its own fresh reporter so its single POST always
  // lands within budget.
  let nextReporter = 0;
  async function freshReporter(): Promise<string> {
    const id = `hist-reporter-${nextReporter++}`;
    await db.insert(usersTable).values({ id, username: id, passwordHash: "x" });
    await db.insert(userRolesTable).values({ userId: id, role: "operator" });
    clearUserValidityCache();
    return id;
  }

  it("records a brand-new incident into facility memory with no recurrence", async () => {
    const reporter = await freshReporter();
    const res = await req(reporter, "POST", "/api/incidents", userReport());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recurrence: unknown };
    // First sighting: nothing to recur against.
    expect(body.recurrence).toBeNull();
    // No SIMILAR PAST INCIDENTS block when memory is empty.
    expect(mock.lastUserPrompt).not.toContain("SIMILAR PAST INCIDENTS");

    // The diagnosed incident is contributed back into the shared pool under the
    // incidents domain (write-back is best-effort/async, so poll briefly).
    let rows: Array<{ domain: string; fact: string }> = [];
    for (let i = 0; i < 20 && rows.length === 0; i++) {
      rows = await db.select().from(facilityKnowledgeTable);
      if (rows.length === 0) await new Promise((r) => setTimeout(r, 25));
    }
    expect(rows.length).toBe(1);
    expect(rows[0].domain).toBe("incidents");
    expect(rows[0].fact).toContain("Seen 1x");
    expect(rows[0].fact).toContain("What helped last time");
  });

  it("grounds the prompt in a similar past incident and surfaces recurrence", async () => {
    // Seed a prior incident memory whose signature matches the new report
    // (same platform/screen + overlapping tokens: "save"/"button").
    // Exact signature for the report below (tokens de-duped+sorted, stopwords
    // like "does" dropped) so this is an EXACT match and the stored "Seen 2x"
    // count drives the recurrence signal.
    await db.insert(facilityKnowledgeTable).values({
      domain: "incidents",
      key: "web|run|button-nothing-save-tap",
      fact: 'Seen 2x on "Run" (web). Problem: Save button does nothing. What helped last time: Reload the page and re-enter the value.',
      source: "incident-diagnosis",
    });

    const reporter = await freshReporter();
    const res = await req(reporter, "POST", "/api/incidents", userReport());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      recurrence: { count: number; lastWorkaround: string | null } | null;
    };

    // The model prompt was grounded in the matching past incident.
    expect(mock.lastUserPrompt).toContain("SIMILAR PAST INCIDENTS");
    expect(mock.lastUserPrompt).toContain("Reload the page and re-enter the value");

    // The reporter gets a "seen before" signal echoing the prior workaround.
    expect(body.recurrence).not.toBeNull();
    expect(body.recurrence?.count).toBeGreaterThanOrEqual(2);
    expect(body.recurrence?.lastWorkaround).toContain("Reload the page");
  });

  it("excludes the incidents domain from the general facility-memory block", async () => {
    // A general operational fact AND a prior incident both live in the pool. The
    // incident must appear only in the focused history block, never the general
    // one, so it isn't double-counted against the prompt budget.
    await db.insert(facilityKnowledgeTable).values([
      {
        domain: "operations",
        key: "line-1-speed",
        fact: "Line 1 runs slower on Mondays.",
        source: "test",
      },
      {
        domain: "incidents",
        key: "web|run|button-does-nothing-save-tap",
        // Distinctive marker so the assertion below can't accidentally match the
        // reporter's own description text earlier in the prompt.
        fact: 'Seen 1x on "Run" (web). Problem: ZZZ-PRIOR-INCIDENT-MARKER. What helped last time: Reload the page.',
        source: "incident-diagnosis",
      },
    ]);

    const reporter = await freshReporter();
    const res = await req(reporter, "POST", "/api/incidents", userReport());
    expect(res.status).toBe(200);
    await res.json();

    const prompt = mock.lastUserPrompt;
    // General operational fact is grounded in.
    expect(prompt).toContain("Line 1 runs slower on Mondays.");
    // The incident is surfaced only under the focused history heading.
    expect(prompt).toContain("SIMILAR PAST INCIDENTS");
    const historyIdx = prompt.indexOf("SIMILAR PAST INCIDENTS");
    const incidentIdx = prompt.indexOf("ZZZ-PRIOR-INCIDENT-MARKER");
    expect(incidentIdx).toBeGreaterThan(historyIdx);
  });

  it("still records the incident when the report has no precedent (fail-safe baseline)", async () => {
    const reporter = await freshReporter();
    // A deliberately unique signal so no other test's (async, best-effort)
    // write-back can leak a matching memory row into this one.
    const res = await req(reporter, "POST", "/api/incidents", {
      source: "user_report",
      screen: "Reports",
      appPlatform: "web",
      description: "The quarterly throughput export froze halfway through downloading.",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { incidentId: string; recurrence: unknown };
    expect(body.incidentId).toBeTruthy();
    // No prior similar incident in memory, so no recurrence is surfaced and the
    // prompt carried no history block — but the incident is still recorded.
    expect(body.recurrence).toBeNull();
    expect(mock.lastUserPrompt).not.toContain("SIMILAR PAST INCIDENTS");
  });
});
