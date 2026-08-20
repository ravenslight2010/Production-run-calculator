// Integration tests for the proactive shift-alert endpoint and its settings.
//
// Task #160 covered the CLIENT-side de-dup/cooldown of the proactive banner, but
// the SERVER owns the actual decision: whether to surface a nudge, what KIND, the
// stable de-dup `key` the client relies on, and the cost-cap rate-limit guard.
// These tests exercise that handler end-to-end:
//   - surfaces a behind-plan nudge, a break/changeover nudge, and (the common
//     case) returns null when nothing is timely;
//   - returns a STABLE key for the same underlying condition across calls (so the
//     client's key-based de-dup actually works);
//   - the per-user cost-cap rate limit kicks in and stops hitting the model;
//   - manager-only + auth gating, invalid-body rejection, provider-failure (502)
//     and non-JSON handling, at-risk-stock grounding, and best-effort trigger
//     write-back to facility memory;
//   - the proactive-settings GET/PUT (defaults, clamping, manager-only).
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
// "returns"; `shouldThrow` simulates a provider outage. `calls` lets us assert
// the model is NOT hit when a request is rejected (auth/role/body/rate-limit).
const mock = vi.hoisted(() => ({
  nextContent: "" as string | null,
  shouldThrow: false as boolean,
  calls: 0,
  // The full user prompt the model last received, so tests can assert what the
  // watcher was grounded in (e.g. the "AT-RISK STOCK" block).
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
let facilityKnowledgeTable: DbModule["facilityKnowledgeTable"];
let proactiveAlertSettingsTable: DbModule["proactiveAlertSettingsTable"];
let inventoryItemsTable: DbModule["inventoryItemsTable"];
let inventoryLotsTable: DbModule["inventoryLotsTable"];
let inventorySettingsTable: DbModule["inventorySettingsTable"];

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
  testDbName = `helium_proactive_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  facilityKnowledgeTable = dbMod.facilityKnowledgeTable;
  proactiveAlertSettingsTable = dbMod.proactiveAlertSettingsTable;
  inventoryItemsTable = dbMod.inventoryItemsTable;
  inventoryLotsTable = dbMod.inventoryLotsTable;
  inventorySettingsTable = dbMod.inventorySettingsTable;

  // Dropping the throwaway DB WITH (FORCE) on teardown can terminate a connection
  // still closing just after pool.end() resolved, surfacing as an unhandled pool
  // "error" event. Swallow it (see rate-limit-shared-store memory).
  pool.on("error", () => {});

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
  if (server) {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      // Under full-suite contention, fetch's keep-alive agent (and any SSE
      // streams) leave sockets open, so server.close() never fires its callback
      // and the hook times out. Force-destroy lingering connections so close()
      // can resolve. (closeAllConnections is Node 18.2+; guarded for safety.)
      server.closeAllConnections?.();
    });
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
  clearUserValidityCache();
  mock.nextContent = JSON.stringify({ alert: null });
  mock.shouldThrow = false;
  mock.calls = 0;
  mock.lastUserPrompt = "";
  await db.execute(
    sql`TRUNCATE ${inventoryLotsTable}, ${inventoryItemsTable}, ${inventorySettingsTable}, ${proactiveAlertSettingsTable}, ${facilityKnowledgeTable}, ${userRolesTable}, ${usersTable}, ${rolesTable} RESTART IDENTITY CASCADE`,
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

// The proactive endpoint shares a module-level, per-user in-memory rate-limit
// bucket that is NOT reset between tests. Give each test its own fresh manager so
// a single POST always lands within budget and no test can tip another into 429.
let nextManager = 0;
async function freshManager(): Promise<string> {
  const id = `mgr-${nextManager++}-${Math.floor(Math.random() * 1e6)}`;
  await db.insert(usersTable).values({ id, username: id, passwordHash: "x" });
  await db.insert(userRolesTable).values({ userId: id, role: "manager" });
  clearUserValidityCache();
  return id;
}

// A valid live-day body for a run that is clearly behind plan (actual PPM well
// under planned, lots of cases left), so a behind-plan nudge is plausible.
function liveDayBody(overrides: Record<string, unknown> = {}) {
  return {
    date: "2026-06-21",
    nowMs: Date.UTC(2026, 5, 21, 14, 30),
    runToTime: "16:00",
    todayPpm: 80,
    benchmarkPpm: 120,
    runs: [
      {
        id: "run-1",
        label: "Run 1",
        brand: "Acme",
        flavor: "Cheese",
        dieType: "12in",
        status: "running",
        casesNeeded: 500,
        casesMade: 100,
        casesLeft: 400,
        plannedPpm: 120,
        actualPpm: 70,
        minutesRemaining: 90,
        netElapsedSec: 3600,
        downtimeSec: 600,
        stoppages: [{ reason: "Jam", durationSec: 600, open: false }],
      },
    ],
    scheduledRuns: [],
    historyRuns: [],
    ...overrides,
  };
}

// An idle day: same shape as liveDayBody but every run is still "upcoming" (no
// run started), so isDayActive() is false on the server.
function idleDayBody(overrides: Record<string, unknown> = {}) {
  const live = liveDayBody();
  return {
    ...live,
    runs: (live.runs as Array<Record<string, unknown>>).map((r) => ({
      ...r,
      status: "upcoming",
    })),
    ...overrides,
  };
}

const alertContent = (alert: Record<string, unknown>, note?: string) =>
  JSON.stringify(note ? { alert, note } : { alert });

describe("POST /ai/proactive-alert — decision branches", () => {
  it("surfaces a behind-plan nudge from the model", async () => {
    const mgr = await freshManager();
    mock.nextContent = alertContent({
      key: "behind-plan",
      category: "run",
      impact: "high",
      title: "Falling behind plan",
      detail: "At the current pace Run 1 will miss the 16:00 target. Speed up the line.",
    });

    const res = await req(mgr, "POST", "/api/ai/proactive-alert", liveDayBody());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      alert: { key: string; category: string; impact: string; title: string } | null;
      generatedAt: number;
    };
    expect(body.alert).not.toBeNull();
    expect(body.alert?.key).toBe("behind-plan");
    expect(body.alert?.category).toBe("run");
    expect(body.alert?.impact).toBe("high");
    expect(typeof body.generatedAt).toBe("number");
    expect(mock.calls).toBe(1);
  });

  it("surfaces a break / changeover nudge from the model", async () => {
    const mgr = await freshManager();
    mock.nextContent = alertContent({
      key: "break-window",
      category: "break",
      impact: "medium",
      title: "Take lunch now",
      detail: "A changeover window is opening — a break now won't stall the line.",
    });

    const res = await req(mgr, "POST", "/api/ai/proactive-alert", liveDayBody());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { alert: { key: string; category: string } | null };
    expect(body.alert?.category).toBe("break");
    expect(body.alert?.key).toBe("break-window");
  });

  it("returns no alert (and preserves a note) when nothing is timely", async () => {
    const mgr = await freshManager();
    // The common case: the model decides there is nothing worth interrupting for.
    mock.nextContent = JSON.stringify({ alert: null, note: "All runs on pace." });

    const res = await req(mgr, "POST", "/api/ai/proactive-alert", liveDayBody());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { alert: unknown; note?: string };
    expect(body.alert).toBeNull();
    expect(body.note).toBe("All runs on pace.");
  });

  it("suppresses a low-count alert when recorded plus on-line progress is not low", async () => {
    const mgr = await freshManager();
    mock.nextContent = alertContent({
      key: "low-case-count",
      category: "run",
      impact: "high",
      title: "Case count appears low",
      detail: "The configured speed implies 222 cases.",
      suggested_action: { skidsCompleted: 11, casesOnCurrentSkid: 2 },
    });
    const run = (liveDayBody().runs as Array<Record<string, unknown>>)[0];
    const res = await req(
      mgr,
      "POST",
      "/api/ai/proactive-alert",
      liveDayBody({
        runs: [
          {
            ...run,
            casesMade: 197,
            casesOnLine: 44,
            plannedPpm: 30,
            netElapsedSec: 74 * 60,
            downtimeSec: 0,
            stoppages: [],
            pizzasPerCase: 10,
            casesPerSkid: 20,
          },
        ],
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { alert: unknown };
    expect(body.alert).toBeNull();
    expect(mock.lastUserPrompt).toContain("casesMade=197");
    expect(mock.lastUserPrompt).toContain("casesOnLine=44");
  });

  it("keeps a genuine low-count alert and returns a cased-only correction", async () => {
    const mgr = await freshManager();
    mock.nextContent = alertContent({
      key: "low-case-count",
      category: "run",
      impact: "high",
      title: "Case count appears low",
      detail: "The configured speed implies 222 cases.",
      // Deliberately inflated model math; the server replaces it.
      suggested_action: { skidsCompleted: 11, casesOnCurrentSkid: 2 },
    });
    const run = (liveDayBody().runs as Array<Record<string, unknown>>)[0];
    const res = await req(
      mgr,
      "POST",
      "/api/ai/proactive-alert",
      liveDayBody({
        runs: [
          {
            ...run,
            casesMade: 150,
            casesOnLine: 44,
            plannedPpm: 30,
            netElapsedSec: 74 * 60,
            downtimeSec: 0,
            stoppages: [],
            pizzasPerCase: 10,
            casesPerSkid: 20,
          },
        ],
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      alert: { key: string; suggestedAction?: { skidsCompleted: number; casesOnCurrentSkid: number } };
    };
    expect(body.alert.key).toBe("low-case-count");
    expect(body.alert.suggestedAction).toEqual({
      skidsCompleted: 8,
      casesOnCurrentSkid: 18,
    });
  });

  it("skips the AI call on an idle day when no stock is at risk", async () => {
    const mgr = await freshManager();
    const before = mock.calls;
    mock.nextContent = alertContent({
      key: "behind-plan",
      category: "run",
      impact: "high",
      title: "should never surface",
      detail: "no run is active",
    });

    const res = await req(mgr, "POST", "/api/ai/proactive-alert", idleDayBody());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { alert: unknown };
    expect(body.alert).toBeNull();
    // The model must not be hit at all — this is the cost-control short-circuit.
    expect(mock.calls).toBe(before);
  });

  it("surfaces an expiring-stock nudge on an idle day (before any run begins)", async () => {
    const mgr = await freshManager();
    const [item] = await db
      .insert(inventoryItemsTable)
      .values({ key: "mozz", category: "ingredient", name: "Mozzarella", unit: "lbs" })
      .returning();
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await db.insert(inventoryLotsTable).values({
      itemId: item.id,
      qtyReceived: 100,
      qtyRemaining: 60,
      expirationDate: yesterday,
    });

    mock.nextContent = alertContent({
      key: "stock-expiring",
      category: "efficiency",
      impact: "medium",
      title: "Use expiring mozzarella first",
      detail: "60 lbs of Mozzarella expired yesterday — plan today's runs to consume it first.",
    });

    const res = await req(mgr, "POST", "/api/ai/proactive-alert", idleDayBody());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { alert: { key: string; category: string } | null };
    expect(body.alert?.category).toBe("efficiency");
    expect(body.alert?.key).toBe("stock-expiring");
    // The idle-day prompt must forbid behind-plan/break and ground in the stock.
    expect(mock.lastUserPrompt).toContain("Mozzarella");
  });

  it("surfaces a reorder nudge on an idle day when an item is at/below its reorder point", async () => {
    const mgr = await freshManager();
    const [item] = await db
      .insert(inventoryItemsTable)
      .values({
        key: "pep",
        category: "ingredient",
        name: "Pepperoni",
        unit: "lbs",
        reorderThreshold: 20,
      })
      .returning();
    // On-hand (5) sits below the reorder point (20) — clearly needs reordering.
    await db.insert(inventoryLotsTable).values({
      itemId: item.id,
      qtyReceived: 50,
      qtyRemaining: 5,
      expirationDate: null,
    });

    mock.nextContent = alertContent({
      key: "reorder-now",
      category: "efficiency",
      impact: "medium",
      title: "Reorder pepperoni",
      detail: "Pepperoni is down to 5 lbs, below its reorder point of 20 — place an order now.",
    });

    const res = await req(mgr, "POST", "/api/ai/proactive-alert", idleDayBody());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { alert: { key: string; category: string } | null };
    expect(body.alert?.category).toBe("efficiency");
    expect(body.alert?.key).toBe("reorder-now");
    // The watcher must be grounded in the low-stock list.
    expect(mock.lastUserPrompt).toContain("LOW STOCK");
    expect(mock.lastUserPrompt).toContain("Pepperoni");
  });

  it("feeds low-stock reorder items into the watcher prompt", async () => {
    const mgr = await freshManager();
    const [item] = await db
      .insert(inventoryItemsTable)
      .values({
        key: "pep",
        category: "ingredient",
        name: "Pepperoni",
        unit: "lbs",
        reorderThreshold: 20,
      })
      .returning();
    await db.insert(inventoryLotsTable).values({
      itemId: item.id,
      qtyReceived: 50,
      qtyRemaining: 5,
      expirationDate: null,
    });

    const res = await req(mgr, "POST", "/api/ai/proactive-alert", liveDayBody());
    expect(res.status).toBe(200);
    expect(mock.lastUserPrompt).toContain("LOW STOCK");
    expect(mock.lastUserPrompt).toContain("Pepperoni");
    expect(mock.lastUserPrompt).toContain("reorder point 20");
  });

  it("does not flag an item comfortably above its reorder point", async () => {
    const mgr = await freshManager();
    const [item] = await db
      .insert(inventoryItemsTable)
      .values({
        key: "flour",
        category: "ingredient",
        name: "Flour",
        unit: "lbs",
        reorderThreshold: 20,
      })
      .returning();
    await db.insert(inventoryLotsTable).values({
      itemId: item.id,
      qtyReceived: 100,
      qtyRemaining: 80,
      expirationDate: null,
    });

    const res = await req(mgr, "POST", "/api/ai/proactive-alert", liveDayBody());
    expect(res.status).toBe(200);
    // The low-stock section is present but empty — no item is at/below threshold.
    expect(mock.lastUserPrompt).toMatch(/LOW STOCK[^]*\(none\)/);
    expect(mock.lastUserPrompt).not.toContain("Flour [");
  });

  it("returns a STABLE key for the same condition across repeated calls", async () => {
    const mgr = await freshManager();
    // The model is free to phrase the key loosely; the server slugifies it to a
    // stable de-dup key. The same underlying condition must always slug the same
    // way so the client's key-based de-dup/cooldown actually suppresses repeats.
    mock.nextContent = alertContent({
      key: "Behind Plan!",
      category: "run",
      impact: "high",
      title: "Behind plan",
      detail: "Pick up the pace to hit the target.",
    });

    const first = await req(mgr, "POST", "/api/ai/proactive-alert", liveDayBody());
    const second = await req(mgr, "POST", "/api/ai/proactive-alert", liveDayBody());
    const a = (await first.json()) as { alert: { key: string } | null };
    const b = (await second.json()) as { alert: { key: string } | null };
    expect(a.alert?.key).toBe("behind-plan");
    expect(b.alert?.key).toBe("behind-plan");
    expect(a.alert?.key).toBe(b.alert?.key);
  });

  it("treats a non-JSON model response as no alert", async () => {
    const mgr = await freshManager();
    mock.nextContent = "I think the line looks fine, no JSON here.";
    const res = await req(mgr, "POST", "/api/ai/proactive-alert", liveDayBody());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { alert: unknown };
    expect(body.alert).toBeNull();
  });

  it("returns 502 when the AI provider fails", async () => {
    const mgr = await freshManager();
    mock.shouldThrow = true;
    const res = await req(mgr, "POST", "/api/ai/proactive-alert", liveDayBody());
    expect(res.status).toBe(502);
  });

  it("feeds expired / expiring-soon stock into the watcher prompt", async () => {
    const mgr = await freshManager();
    const [item] = await db
      .insert(inventoryItemsTable)
      .values({ key: "mozz", category: "ingredient", name: "Mozzarella", unit: "lbs" })
      .returning();
    // A lot that expired yesterday (relative to the server's real clock) is
    // unambiguously at-risk regardless of the configured lead time.
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await db.insert(inventoryLotsTable).values({
      itemId: item.id,
      qtyReceived: 100,
      qtyRemaining: 60,
      expirationDate: yesterday,
    });

    const res = await req(mgr, "POST", "/api/ai/proactive-alert", liveDayBody());
    expect(res.status).toBe(200);
    expect(mock.lastUserPrompt).toContain("AT-RISK STOCK");
    expect(mock.lastUserPrompt).toContain("Mozzarella");
  });
});

describe("POST /ai/proactive-alert — auth, role, and body gating", () => {
  it("rejects an operator with 403 and never calls the model", async () => {
    const res = await req(OPERATOR, "POST", "/api/ai/proactive-alert", liveDayBody());
    expect(res.status).toBe(403);
    expect(mock.calls).toBe(0);
  });

  it("requires authentication", async () => {
    const res = await req(null, "POST", "/api/ai/proactive-alert", liveDayBody());
    expect(res.status).toBe(401);
    expect(mock.calls).toBe(0);
  });

  it("rejects an invalid body with 400 and never calls the model", async () => {
    const mgr = await freshManager();
    const res = await req(mgr, "POST", "/api/ai/proactive-alert", { date: "2026-06-21" });
    expect(res.status).toBe(400);
    expect(mock.calls).toBe(0);
  });
});

describe("POST /ai/proactive-alert — cost-cap rate limit", () => {
  it("rate-limits a manager past the per-minute cap and stops hitting the model", async () => {
    const mgr = await freshManager();
    mock.nextContent = JSON.stringify({ alert: null });

    // PROACTIVE_RATE_MAX = 20 requests / minute, per user. Drain the budget.
    let lastOk: Response | null = null;
    for (let i = 0; i < 20; i++) {
      lastOk = await req(mgr, "POST", "/api/ai/proactive-alert", liveDayBody());
      expect(lastOk.status).toBe(200);
    }
    expect(lastOk?.headers.get("RateLimit-Limit")).toBe("20");
    const callsAfterBudget = mock.calls;
    expect(callsAfterBudget).toBe(20);

    // The 21st request in the window is rejected without reaching the model.
    const blocked = await req(mgr, "POST", "/api/ai/proactive-alert", liveDayBody());
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
    expect(mock.calls).toBe(callsAfterBudget);
  });
});

describe("POST /ai/proactive-alert — trigger write-back to facility memory", () => {
  it("records a surfaced alert as a trigger (best-effort)", async () => {
    const mgr = await freshManager();
    mock.nextContent = alertContent({
      key: "behind-plan",
      category: "run",
      impact: "high",
      title: "Behind plan",
      detail: "Speed up to hit the target.",
    });

    const res = await req(mgr, "POST", "/api/ai/proactive-alert", liveDayBody());
    expect(res.status).toBe(200);

    // The write-back is async/best-effort (void), so poll briefly.
    let rows: Array<{ domain: string; key: string }> = [];
    for (let i = 0; i < 20 && rows.length === 0; i++) {
      rows = await db
        .select()
        .from(facilityKnowledgeTable)
        .where(eq(facilityKnowledgeTable.domain, "proactive-alerts"));
      if (rows.length === 0) await new Promise((r) => setTimeout(r, 25));
    }
    expect(rows.length).toBe(1);
    expect(rows[0].key).toBe("trigger:behind-plan");
  });

  it("records nothing when no alert is surfaced", async () => {
    const mgr = await freshManager();
    mock.nextContent = JSON.stringify({ alert: null });
    const res = await req(mgr, "POST", "/api/ai/proactive-alert", liveDayBody());
    expect(res.status).toBe(200);

    // Give any (incorrect) async write a chance to land before asserting absence.
    await new Promise((r) => setTimeout(r, 100));
    const rows = await db
      .select()
      .from(facilityKnowledgeTable)
      .where(eq(facilityKnowledgeTable.domain, "proactive-alerts"));
    expect(rows.length).toBe(0);
  });
});

describe("/ai/proactive-settings", () => {
  it("returns safe defaults on a fresh install (open to any signed-in user)", async () => {
    const res = await req(OPERATOR, "GET", "/api/ai/proactive-settings");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      enabled: boolean;
      pollSeconds: number;
      cooldownSeconds: number;
    };
    expect(body.enabled).toBe(true);
    expect(body.pollSeconds).toBe(240);
    expect(body.cooldownSeconds).toBe(1800);
  });

  it("clamps out-of-bounds values on PUT and persists the clamped result", async () => {
    const res = await req(MANAGER, "PUT", "/api/ai/proactive-settings", {
      enabled: true,
      pollSeconds: 1, // below the 30s minimum
      cooldownSeconds: 999_999, // above the 86_400s maximum
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pollSeconds: number; cooldownSeconds: number };
    expect(body.pollSeconds).toBe(30);
    expect(body.cooldownSeconds).toBe(86_400);

    // The clamped values are persisted, not just echoed.
    const [row] = await db
      .select()
      .from(proactiveAlertSettingsTable)
      .where(eq(proactiveAlertSettingsTable.scope, "live"));
    expect(row.pollSeconds).toBe(30);
    expect(row.cooldownSeconds).toBe(86_400);
  });

  it("rejects a PUT from an operator with 403", async () => {
    const res = await req(OPERATOR, "PUT", "/api/ai/proactive-settings", {
      enabled: false,
      pollSeconds: 240,
      cooldownSeconds: 1800,
    });
    expect(res.status).toBe(403);
  });
});
