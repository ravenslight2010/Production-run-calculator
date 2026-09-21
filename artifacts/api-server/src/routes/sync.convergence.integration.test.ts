/**
 * Deterministic multi-client sync soak.
 *
 * This is deliberately separate from the focused invariant suites. It models
 * several browser clients over the real HTTP router while using a disposable
 * database, a logical clock, and an injectable network gate. No live-day rows
 * or production traffic are involved.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec vitest run src/routes/sync.convergence.integration.test.ts
 *
 * A failure prints the counters and divergent paths needed to distinguish a
 * lost update, a reset re-adoption, a date-scope mix-up, or retry storm.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fork, spawnSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { sql } from "drizzle-orm";
import { signToken } from "../lib/auth";

type DbModule = typeof import("@workspace/db");
type SyncPayload = Record<string, unknown>;
type SyncResponse = { ok?: boolean; data?: SyncPayload; stale?: boolean; epoch?: number };
type Metrics = {
  requests: number;
  retries: number;
  conflicts: number;
  convergenceMs: number;
  divergentFields: string[];
};

let db: DbModule["db"];
let pool: DbModule["pool"];
let dailySyncTable: DbModule["dailySyncTable"];
let dataResetTable: DbModule["dataResetTable"];
let syncConflictLogsTable: DbModule["syncConflictLogsTable"];
let usersTable: DbModule["usersTable"];
let userRolesTable: DbModule["userRolesTable"];
let rolesTable: DbModule["rolesTable"];
let seedRoles: () => Promise<void>;
let adminPool: pg.Pool;
let testDbName: string;
let originalDatabaseUrl: string | undefined;
let server: Server;
let baseUrl: string;
let testDatabaseUrl: string;

const OPERATOR = "soak-operator";
const MANAGER = "soak-manager";
const TODAY = "2031-06-15";
const TOMORROW = "2031-06-16";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

beforeAll(async () => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  if (!originalDatabaseUrl) throw new Error("DATABASE_URL must be set to run integration tests");
  adminPool = new pg.Pool({ connectionString: originalDatabaseUrl });
  adminPool.on("error", () => {});
  testDbName = `helium_sync_soak_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await adminPool.query(`CREATE DATABASE "${testDbName}"`);
  const testUrl = new URL(originalDatabaseUrl);
  testUrl.pathname = `/${testDbName}`;
  const testUrlStr = testUrl.toString();
  testDatabaseUrl = testUrlStr;
  const push = spawnSync("pnpm", ["--filter", "@workspace/db", "run", "push-force"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: testUrlStr },
    encoding: "utf8",
  });
  if (push.status !== 0) throw new Error(`drizzle push failed:\n${push.stdout}\n${push.stderr}`);
  process.env.DATABASE_URL = testUrlStr;
  const dbMod = await import("@workspace/db");
  const routerMod = await import("./index");
  db = dbMod.db;
  pool = dbMod.pool;
  dailySyncTable = dbMod.dailySyncTable;
  dataResetTable = dbMod.dataResetTable;
  syncConflictLogsTable = dbMod.syncConflictLogsTable;
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
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (pool) await pool.end();
  if (adminPool) {
    await adminPool.query(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
    await adminPool.end();
  }
  process.env.DATABASE_URL = originalDatabaseUrl;
}, 60_000);

beforeEach(async () => {
  await db.execute(sql`TRUNCATE ${dailySyncTable}, ${dataResetTable}, ${syncConflictLogsTable}, ${userRolesTable}, ${usersTable}, ${rolesTable} RESTART IDENTITY CASCADE`);
  await seedRoles();
  await db.insert(usersTable).values([
    { id: OPERATOR, username: "soak-operator", passwordHash: "x" },
    { id: MANAGER, username: "soak-manager", passwordHash: "x" },
  ]);
  await db.insert(userRolesTable).values([
    { userId: OPERATOR, role: "operator" },
    { userId: MANAGER, role: "manager" },
  ]);
});

function headers(user = OPERATOR): Record<string, string> {
  return { authorization: `Bearer ${signToken(user)}` };
}

async function startIsolatedSyncProcess(): Promise<{ child: ChildProcess; baseUrl: string }> {
  const fixturePath = path.join(repoRoot, "artifacts/api-server/src/test-fixtures/syncProcessServer.mts");
  const child = fork(fixturePath, {
    cwd: repoRoot,
    execPath: path.join(repoRoot, "scripts/node_modules/.bin/tsx"),
    env: {
      ...process.env,
      DATABASE_URL: testDatabaseUrl,
      AUTO_TRACK_HEARTBEAT_MS: "1000",
    },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const port = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("isolated sync process did not start")), 10_000);
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`isolated sync process exited before ready (${code})`)));
    child.on("message", (message) => {
      if (message && typeof message === "object" && (message as { type?: string }).type === "ready") {
        clearTimeout(timeout);
        resolve((message as { port: number }).port);
      }
    });
  });
  return { child, baseUrl: `http://127.0.0.1:${port}` };
}

async function stopIsolatedSyncProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function readDataFrame(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  state: { buffer: string },
  timeoutMs = 5_000,
): Promise<Record<string, unknown>> {
  const read = async (): Promise<Record<string, unknown>> => {
    for (;;) {
      const match = state.buffer.match(/data: (.+)\n\n/);
      if (match) {
        state.buffer = state.buffer.slice(match.index! + match[0].length);
        return JSON.parse(match[1]) as Record<string, unknown>;
      }
      const chunk = await reader.read();
      if (chunk.done) throw new Error("stream closed");
      state.buffer += new TextDecoder().decode(chunk.value);
    }
  };
  return Promise.race([
    read(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out waiting for data frame")), timeoutMs)),
  ]);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function paths(a: unknown, b: unknown, prefix = "$"): string[] {
  if (Object.is(a, b)) return [];
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return [prefix];
    return a.flatMap((v, i) => paths(v, b[i], `${prefix}[${i}]`));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    // These values are anchored to the response that delivered the
    // projection, not to the shared day-state. Comparing them across clients
    // makes a successful convergence pull look divergent by design.
    const responseLocalTimingFields = new Set([
      "serverTime",
      "serverTimeMs",
      "capturedAtServerMs",
      "atMs",
    ]);
    return [...keys].flatMap((key) =>
      responseLocalTimingFields.has(key)
        ? []
        : paths((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${prefix}.${key}`),
    );
  }
  return [prefix];
}

class SimulatedClient {
  readonly id: string;
  readonly metrics: Metrics = { requests: 0, retries: 0, conflicts: 0, convergenceMs: 0, divergentFields: [] };
  private online = true;
  private queued: Array<{ date: string; today: string; payload: SyncPayload; epoch: number }> = [];
  private logicalNow = 10_000;
  private _epoch = 0;
  state: SyncPayload | null = null;

  constructor(id: string) {
    this.id = id;
  }

  get epoch(): number {
    return this._epoch;
  }

  setOnline(value: boolean): void {
    this.online = value;
  }

  edit(mutator: (state: SyncPayload) => void): void {
    if (!this.state) throw new Error(`${this.id} cannot edit before adoption`);
    mutator(this.state);
    const runId = "run-main";
    const stamps = (this.state.runValuesUpdatedAt ?? {}) as Record<string, number>;
    stamps[runId] = ++this.logicalNow;
    this.state.runValuesUpdatedAt = stamps;
  }

  private async request(
    method: "GET" | "PUT",
    url: string,
    body?: unknown,
  ): Promise<Response> {
    if (!this.online) throw new Error(`${this.id} offline`);
    this.metrics.requests++;
    return fetch(`${baseUrl}${url}`, {
      method,
      headers: { ...headers(), ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }

  async pull(today = TODAY): Promise<boolean> {
    try {
      const res = await this.request("GET", `/api/sync/today?today=${today}`);
      if (!res.ok) return false;
      this.state = (await res.json()) as SyncPayload | null;
      return true;
    } catch {
      return false;
    }
  }

  async push(today = TODAY, payload = this.state, epoch = this._epoch): Promise<SyncResponse | null> {
    if (!payload) throw new Error(`${this.id} has no payload`);
    try {
      const res = await this.request("PUT", `/api/sync/today?today=${today}&epoch=${epoch}`, {
        senderId: this.id,
        payload,
      });
      const body = (await res.json()) as SyncResponse;
      if (body.stale) {
        this._epoch = body.epoch ?? this._epoch;
        this.metrics.retries++;
        return body;
      }
      if (body.data) this.state = clone(body.data);
      return body;
    } catch {
      this.queued.push({ date: "today", today, payload: clone(payload), epoch });
      return null;
    }
  }

  async flush(): Promise<void> {
    while (this.queued.length > 0 && this.online) {
      const item = this.queued.shift()!;
      this.metrics.retries++;
      await this.push(item.today, item.payload, item.epoch);
    }
  }

  async adoptReset(): Promise<void> {
    const res = await this.request("GET", "/api/sync/reset-epoch");
    this._epoch = ((await res.json()) as { epoch: number }).epoch;
    await this.pull(TODAY);
  }
}

const fixture = (): SyncPayload => ({
  dayState: {
    resetAt: 0,
    runs: [{
      id: "run-main",
      brand: "Acme",
      flavor: "Pepperoni",
      startedAt: 1_000,
      metaUpdatedAt: 1_000,
    }],
  },
  runValues: {
    "run-main": {
      casesNeeded: 240,
      casesPerSkid: 48,
      skidsCompleted: 1,
      casesOnCurrentSkid: 12,
      doughRecipe: [{ ingredient: "Flour", lbs: 42 }],
    },
  },
  runValuesUpdatedAt: { "run-main": 1_000 },
  packagingProgress: {
    "run-main": {
      skidsCompleted: 1,
      casesOnCurrentSkid: 12,
      correctionGeneration: 0,
      updatedAt: 1_000,
      manualOverrideUntil: 0,
    },
  },
  recipes: {
    dough: { "Acme Standard": { ingredient: "Flour", lbs: 42 } },
    frontline: { "Acme Sauce": { ingredient: "Sauce", lbs: 8 } },
  },
  facility: { line: "Line A", timezone: "America/Chicago" },
});

describe("multi-client sync convergence soak", () => {
  it("documents the cross-process fanout boundary and complete reconnect recovery", async () => {
    const isolated = await startIsolatedSyncProcess();
    try {
      const stream = await fetch(`${isolated.baseUrl}/api/sync/events?today=${TODAY}&clientId=process-b-peer`, {
        headers: headers(),
      });
      expect(stream.status).toBe(200);
      const reader = stream.body!.getReader();
      const readState = { buffer: "" };
      const initial = await readDataFrame(reader, readState);
      expect(initial).toMatchObject({ initial: true, completeness: "complete" });

      const writer = new SimulatedClient("process-a-writer");
      writer.state = fixture();
      const write = await writer.push();
      expect(write?.ok).toBe(true);

      await expect(readDataFrame(reader, readState, 400)).rejects.toThrow("timed out waiting for data frame");
      await reader.cancel();

      const recoveredStream = await fetch(
        `${isolated.baseUrl}/api/sync/events?today=${TODAY}&clientId=process-b-reconnect`,
        { headers: headers() },
      );
      const recoveredReader = recoveredStream.body!.getReader();
      const recovered = await readDataFrame(recoveredReader, { buffer: "" });
      expect(recovered).toMatchObject({
        initial: true,
        completeness: "complete",
        data: { dayState: { runs: [{ id: "run-main" }] } },
      });
      await recoveredReader.cancel();
    } finally {
      await stopIsolatedSyncProcess(isolated.child);
    }
  }, 30_000);

  it("converges edits, offline reconnects, wake recovery, stale writes, and blank protection", async () => {
    const clients = ["A", "B", "C"].map((id) => new SimulatedClient(id));
    const start = Date.now();
    const seed = clients[0];
    seed.state = fixture();
    await seed.push();
    for (const client of clients.slice(1)) await client.pull();

    // Repeated deterministic edits with a sleeping peer. Each wake adopts the
    // canonical response before its queued stale write can be replayed.
    clients[1].setOnline(false);
    for (let i = 0; i < 12; i++) {
      clients[0].edit((state) => {
        const values = state.runValues as Record<string, Record<string, unknown>>;
        values["run-main"].casesOnCurrentSkid = 13 + i;
        if (i === 11) {
          const runs = state.dayState as { runs: Array<Record<string, unknown>> };
          runs.runs[0].endedAt = 20_000;
          runs.runs[0].metaUpdatedAt = 20_000;
        }
      });
      await clients[0].push();
      clients[1].edit((state) => {
        const values = state.runValues as Record<string, Record<string, unknown>>;
        values["run-main"].casesNeeded = 240 + i;
      });
      await clients[1].push(); // queued while offline
    }
    clients[1].setOnline(true);
    expect(await clients[1].pull()).toBe(true);
    await clients[1].flush();
    await clients[2].pull();

    // An old lifecycle and blank value arrive after the latest canonical edit.
    const stale = clone(fixture());
    const stalePut = await clients[2].push(TODAY, {
      ...stale,
      runValues: { "run-main": {} },
      runValuesUpdatedAt: { "run-main": 1_000 },
    });
    expect(stalePut?.data?.runValues).toEqual(clients[0].state?.runValues);
    expect(stalePut?.data?.dayState).toMatchObject({
      runs: [{ id: "run-main", endedAt: 20_000, metaUpdatedAt: 20_000 }],
    });
    expect(await clients[0].pull()).toBe(true);
    expect(await clients[1].pull()).toBe(true);
    expect(await clients[2].pull()).toBe(true);

    const canonical = clients[0].state;
    for (const client of clients) {
      client.metrics.divergentFields = paths(canonical, client.state);
      expect(client.metrics.divergentFields).toEqual([]);
    }
    const conflicts = await db.select().from(syncConflictLogsTable);
    const totalRequests = clients.reduce((n, c) => n + c.metrics.requests, 0);
    const retries = clients.reduce((n, c) => n + c.metrics.retries, 0);
    const report = {
      requests: totalRequests,
      retries,
      conflicts: conflicts.length,
      convergenceMs: Date.now() - start,
      divergentFields: clients.flatMap((c) => c.metrics.divergentFields),
    };
    for (const client of clients) Object.assign(client.metrics, report);
    console.info("[sync convergence soak]", report);
    expect(totalRequests).toBeLessThan(80);
    expect(retries).toBeLessThan(20);
    expect(conflicts.length).toBeGreaterThan(0);
    expect(report.convergenceMs).toBeLessThan(5_000);
  }, 30_000);

  it("keeps client-date rows separate and prevents stale re-adoption after reset", async () => {
    const client = new SimulatedClient("date-client");
    client.state = fixture();
    await client.push(TODAY);
    const future = clone(fixture());
    (future.dayState as Record<string, unknown>).runs = [{ id: "future-run", brand: "Acme", flavor: "Cheese" }];
    const futureRes = await fetch(`${baseUrl}/api/sync/${TOMORROW}?today=${TODAY}`, {
      method: "PUT",
      headers: { ...headers(MANAGER), "content-type": "application/json" },
      body: JSON.stringify({ senderId: client.id, payload: future }),
    });
    expect(futureRes.status).toBe(200);
    const todayBeforeReset = await fetch(`${baseUrl}/api/sync/today?today=${TODAY}`, { headers: headers() }).then((r) => r.json());
    expect((todayBeforeReset as SyncPayload).dayState).toMatchObject({ runs: [{ id: "run-main" }] });
    expect(await fetch(`${baseUrl}/api/sync/${TOMORROW}`, { headers: headers() }).then((r) => r.json())).toMatchObject({
      dayState: { runs: [{ id: "future-run" }] },
    });

    const reset = await fetch(`${baseUrl}/api/sync/reset`, { method: "POST", headers: headers(MANAGER) });
    expect(reset.status).toBe(200);
    const resetBody = (await reset.json()) as { epoch: number };
    expect(resetBody.epoch).toBe(1);

    const stale = await client.push(TODAY, fixture(), 0);
    expect(stale).toMatchObject({ ok: true, stale: true, epoch: 1 });
    expect(await fetch(`${baseUrl}/api/sync/today?today=${TODAY}`, { headers: headers() }).then((r) => r.json())).toMatchObject({
      dayState: { date: TODAY, runs: [] },
      runValues: {},
      runValuesUpdatedAt: {},
    });

    await client.adoptReset();
    expect(client.epoch).toBe(1);
    expect(client.state).toMatchObject({
      dayState: { date: TODAY, runs: [] },
      runValues: {},
      runValuesUpdatedAt: {},
    });
    const accepted = await client.push(TODAY, { dayState: { runs: [] }, runValues: {} }, 1);
    expect(accepted?.stale).not.toBe(true);
    expect(await fetch(`${baseUrl}/api/sync/today?today=${TODAY}`, { headers: headers() }).then((r) => r.json())).toMatchObject({
      dayState: { runs: [] },
    });
  }, 30_000);
});