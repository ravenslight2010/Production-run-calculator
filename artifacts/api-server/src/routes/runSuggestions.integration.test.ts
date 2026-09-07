// Integration tests for the Run Insights suggestion lifecycle:
// observe (any authed user) → pending; manager dismiss → similar re-observe is
// suppressed but worsened drift reopens; manager accept → follow-up note can
// be written exactly once by any authed device; write-gating on the manager
// routes. The AI narration provider is mocked to FAIL so we also prove the
// deterministic fallback narrative path (AI failure must never block storage).
//
// Harness copied from productionRules.integration.test.ts: real router against
// a disposable Postgres DB; @workspace/db binds its pool at import time so all
// db-touching imports are dynamic inside beforeAll (see
// .agents/memory/integration-test-db-binding.md).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { sql } from "drizzle-orm";
import express, { type Express } from "express";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import pg from "pg";
import { signToken } from "../lib/auth";

// Mock the AI provider: narration always throws → deterministic fallback.
// Must export pickModel/AI_MODELS too or routes importing them 502 (see
// .agents/memory/ai-model-routing-and-streaming.md).
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: {
    chat: {
      completions: {
        create: vi.fn(async () => {
          throw new Error("mock AI down");
        }),
      },
    },
  },
  pickModel: () => "mock-model",
  AI_MODELS: { full: "mock-model", cheap: "mock-model" },
}));

type DbModule = typeof import("@workspace/db");
let db: DbModule["db"];
let pool: DbModule["pool"];
let runSuggestionsTable: DbModule["runSuggestionsTable"];
let usersTable: DbModule["usersTable"];
let userRolesTable: DbModule["userRolesTable"];
let rolesTable: DbModule["rolesTable"];
let seedRoles: () => Promise<void>;
let clearUserValidityCache: () => void;

let adminPool: pg.Pool;
let testDbName: string;
let originalDatabaseUrl: string | undefined;
let server: Server;
let baseUrl: string;

const MANAGER = "manager-1";
const STAFF = "staff-1";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set to run integration tests");

  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  adminPool.on("error", () => {});
  testDbName = `helium_runsuggest_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
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
  runSuggestionsTable = dbMod.runSuggestionsTable;
  usersTable = dbMod.usersTable;
  userRolesTable = dbMod.userRolesTable;
  rolesTable = dbMod.rolesTable;
  seedRoles = (await import("../lib/roles")).seedRoles;

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
  clearUserValidityCache();
  await db.execute(
    sql`TRUNCATE ${runSuggestionsTable}, ${userRolesTable}, ${usersTable}, ${rolesTable} RESTART IDENTITY CASCADE`,
  );
  await seedRoles();
  await db.insert(usersTable).values([
    { id: MANAGER, username: "manager", passwordHash: "x" },
    { id: STAFF, username: "staff", passwordHash: "x" },
  ]);
  await db.insert(userRolesTable).values([
    { userId: MANAGER, role: "manager" },
    { userId: STAFF, role: "staff" },
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

const OBSERVATION = {
  type: "speed-target",
  brand: "Bobo's",
  flavor: "Plain",
  dieType: '7"',
  observedValue: 4.5,
  configuredValue: 5,
  recommendedValue: 4.5,
  unit: "cycles/min",
  runCount: 2,
  statsLine: "The last 2 Bobo's Plain runs averaged 10% below the configured speed target.",
};

type ApiSuggestion = {
  id: string;
  status: string;
  statsLine: string;
  narrative: string;
  followUpNote: string;
  observedValue: number;
};

async function list(userId: string): Promise<ApiSuggestion[]> {
  const res = await req(userId, "GET", "/api/run-suggestions");
  expect(res.status).toBe(200);
  return ((await res.json()) as { suggestions: ApiSuggestion[] }).suggestions;
}

describe("run suggestions lifecycle", () => {
  it("staff observe creates a pending suggestion with deterministic stats", async () => {
    const res = await req(STAFF, "POST", "/api/run-suggestions/observe", OBSERVATION);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; suggestion?: ApiSuggestion };
    expect(body.ok).toBe(true);
    expect(body.suggestion?.status).toBe("pending");
    // New observations keep the compatibility narrative field empty; the
    // deterministic stats line is the user-facing explanation.
    expect(body.suggestion?.statsLine).toBe(OBSERVATION.statsLine);
    expect(body.suggestion?.narrative).toBe("");
    const all = await list(STAFF);
    expect(all).toHaveLength(1);
  });

  it("re-observing the same pattern upserts in place (no duplicate rows)", async () => {
    await req(STAFF, "POST", "/api/run-suggestions/observe", OBSERVATION);
    await req(STAFF, "POST", "/api/run-suggestions/observe", {
      ...OBSERVATION,
      observedValue: 4.4,
      runCount: 3,
    });
    const all = await list(STAFF);
    expect(all).toHaveLength(1);
    expect(all[0].observedValue).toBe(4.4);
  });

  it("staff cannot accept/dismiss; manager can dismiss; dismissed patterns stay quiet until drift worsens", async () => {
    await req(STAFF, "POST", "/api/run-suggestions/observe", OBSERVATION);
    const [sug] = await list(STAFF);

    const staffPatch = await req(STAFF, "POST", "/api/run-suggestions/update", {
      id: sug.id,
      status: "dismissed",
    });
    expect(staffPatch.status).toBe(403);

    const dismiss = await req(MANAGER, "POST", "/api/run-suggestions/update", {
      id: sug.id,
      status: "dismissed",
    });
    expect(dismiss.status).toBe(200);
    expect((await list(MANAGER))[0].status).toBe("dismissed");

    // Similar drift again → suppressed, still dismissed.
    const again = await req(STAFF, "POST", "/api/run-suggestions/observe", {
      ...OBSERVATION,
      observedValue: 4.52,
    });
    expect(((await again.json()) as { suppressed?: boolean }).suppressed).toBe(true);
    expect((await list(MANAGER))[0].status).toBe("dismissed");

    // Meaningfully worse drift → reopens as pending.
    await req(STAFF, "POST", "/api/run-suggestions/observe", {
      ...OBSERVATION,
      observedValue: 4.2,
      recommendedValue: 4.2,
    });
    expect((await list(MANAGER))[0].status).toBe("pending");
  });

  it("accept + one-shot follow-up note + manager clear", async () => {
    await req(STAFF, "POST", "/api/run-suggestions/observe", OBSERVATION);
    const [sug] = await list(STAFF);

    const accept = await req(MANAGER, "POST", "/api/run-suggestions/update", {
      id: sug.id,
      status: "accepted",
    });
    expect(accept.status).toBe(200);
    expect((await list(MANAGER))[0].status).toBe("accepted");

    // Staff device reports follow-up accuracy; only the FIRST note lands.
    await req(STAFF, "POST", "/api/run-suggestions/follow-up", {
      id: sug.id,
      note: "Speed target update seems accurate — last run came in within 2%.",
    });
    await req(STAFF, "POST", "/api/run-suggestions/follow-up", {
      id: sug.id,
      note: "second note must not overwrite",
    });
    let [row] = await list(MANAGER);
    expect(row.followUpNote).toContain("seems accurate");

    // Manager clears the note.
    await req(MANAGER, "POST", "/api/run-suggestions/update", {
      id: sug.id,
      clearFollowUp: true,
    });
    [row] = await list(MANAGER);
    expect(row.followUpNote).toBe("");
    expect(row.status).toBe("accepted");
  });

  it("rejects unauthenticated and malformed observes", async () => {
    expect((await req(null, "POST", "/api/run-suggestions/observe", OBSERVATION)).status).toBe(401);
    expect(
      (await req(STAFF, "POST", "/api/run-suggestions/observe", { type: "speed-target" })).status,
    ).toBe(400);
    expect(
      (
        await req(STAFF, "POST", "/api/run-suggestions/observe", {
          ...OBSERVATION,
          configuredValue: 0,
        })
      ).status,
    ).toBe(400);
  });
});
