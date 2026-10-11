/**
 * Deterministic multi-client sync soak.
 *
 * This is deliberately separate from the focused invariant suites. It models
 * several browser clients over the real HTTP router while using a disposable
 * database, a logical clock, and an injectable network gate. No live-day rows
 * or production traffic are involved.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:sync-convergence:isolated
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
import { and, asc, eq, sql } from "drizzle-orm";
import { signLegacyTokenForTests } from "../lib/auth";
import { rebaseStaleSyncIntent } from "@workspace/sync-contract/stale-base-recovery";

type DbModule = typeof import("@workspace/db");
type SyncPayload = Record<string, unknown>;
type SyncResponse = {
  ok?: boolean;
  data?: SyncPayload;
  stale?: boolean;
  epoch?: number;
  snapshotId?: string;
  partialFallback?: boolean;
  serverTime?: number;
};
type Metrics = {
  requests: number;
  retries: number;
  recoveredWrites: number;
  replayedIntentCount: number;
  conflicts: number;
  convergenceMs: number;
  divergentFields: string[];
};
type QueuedSyncWrite = {
  date: string;
  today: string;
  payload: SyncPayload;
  baseSnapshot: SyncPayload;
  epoch: number;
  baseSnapshotId: string;
};

let db: DbModule["db"];
let pool: DbModule["pool"];
let dailySyncTable: DbModule["dailySyncTable"];
let dataResetTable: DbModule["dataResetTable"];
let syncConflictLogsTable: DbModule["syncConflictLogsTable"];
let syncOutboxCursorsTable: DbModule["syncOutboxCursorsTable"];
let syncOutboxEventsTable: DbModule["syncOutboxEventsTable"];
let usersTable: DbModule["usersTable"];
let userRolesTable: DbModule["userRolesTable"];
let rolesTable: DbModule["rolesTable"];
let seedRoles: () => Promise<void>;
let originalDatabaseUrl: string | undefined;
let server: Server;
let baseUrl: string;
let testDatabaseUrl: string;

const OPERATOR = "soak-operator";
const MANAGER = "soak-manager";
const SANDBOX_MANAGER = "soak-sandbox-manager";
const TODAY = "2031-06-15";
const TOMORROW = "2031-06-16";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const CROSS_PROCESS_SILENCE_WINDOW_MS = 1_000;
const CANONICAL_BREAKS = [
  { slot: 1, enabled: true, mode: "at-time", atTime: "08:15", durationMin: 30 },
  { slot: 2, enabled: false, mode: "after-run", durationMin: 30 },
  { slot: 3, enabled: true, mode: "after-run", runId: "run-main", durationMin: 30 },
];

function requireIsolatedSyncDatabase(environment = process.env): string {
  if (
    environment.NODE_ENV !== "test"
    || environment.SYNC_CONVERGENCE_DISPOSABLE_DB !== "1"
    || environment.E2E_TEST_DB !== "1"
    || environment.E2E_APPROVED_DESTRUCTIVE_MODE !== "1"
    || environment.REPLIT_DEPLOYMENT === "1"
    || /^(production|prod)$/iu.test(environment.APP_ENV ?? "")
  ) {
    throw new Error(
      "Sync convergence integration tests require the isolated disposable test runner.",
    );
  }

  const rawUrl = environment.DATABASE_URL?.trim();
  if (!rawUrl) {
    throw new Error("The isolated sync convergence database URL is missing.");
  }

  let databaseUrl: URL;
  try {
    databaseUrl = new URL(rawUrl);
  } catch {
    throw new Error("The isolated sync convergence database URL is invalid.");
  }

  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, ""));
  if (
    !["postgres:", "postgresql:"].includes(databaseUrl.protocol)
    || databaseUrl.hostname !== "127.0.0.1"
    || databaseUrl.username !== "postgres"
    || databaseUrl.password !== ""
    || databaseUrl.search !== ""
    || databaseUrl.hash !== ""
    || !/^sync_convergence_test_[a-z0-9_]+$/u.test(databaseName)
  ) {
    throw new Error(
      "Sync convergence integration tests require their named loopback disposable database.",
    );
  }

  return databaseUrl.toString();
}

beforeAll(async () => {
  const setupStartedAt = Date.now();
  originalDatabaseUrl = process.env.DATABASE_URL;
  testDatabaseUrl = requireIsolatedSyncDatabase();
  const push = spawnSync("pnpm", ["--filter", "@workspace/db", "run", "push-force"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: testDatabaseUrl },
    encoding: "utf8",
    timeout: 120_000,
  });
  if (push.error || push.status !== 0) {
    const status = push.error?.name
      ?? (push.status === null ? push.signal ?? "unknown status" : `exit ${push.status}`);
    throw new Error(`isolated sync convergence schema setup failed (${status}); output omitted`);
  }
  console.info(
    `[sync convergence setup] schema push complete elapsedMs=${Date.now() - setupStartedAt}`,
  );
  process.env.DATABASE_URL = testDatabaseUrl;
  const dbMod = await import("@workspace/db");
  const [syncRouterMod, authMod, startupGateMod, cacheControlMod] =
    await Promise.all([
      import("./sync"),
      import("../middlewares/requireAuth"),
      import("../lib/startupGate"),
      import("../lib/cacheControl"),
    ]);
  console.info(
    `[sync convergence setup] route modules loaded elapsedMs=${Date.now() - setupStartedAt}`,
  );
  db = dbMod.db;
  pool = dbMod.pool;
  dailySyncTable = dbMod.dailySyncTable;
  dataResetTable = dbMod.dataResetTable;
  syncConflictLogsTable = dbMod.syncConflictLogsTable;
  syncOutboxCursorsTable = dbMod.syncOutboxCursorsTable;
  syncOutboxEventsTable = dbMod.syncOutboxEventsTable;
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
  // This soak only exercises /sync. Keep the production cross-cutting
  // middleware while avoiding imports for every unrelated API route.
  app.use("/api", cacheControlMod.noStoreMiddleware);
  app.use("/api", startupGateMod.startupGate);
  app.use("/api", authMod.requireAuth);
  app.use("/api", syncRouterMod.default);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  console.info(
    `[sync convergence setup] loopback server ready elapsedMs=${Date.now() - setupStartedAt}`,
  );
}, 240_000);

afterAll(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (pool) await pool.end();
  process.env.DATABASE_URL = originalDatabaseUrl;
}, 60_000);

beforeEach(async () => {
  await db.execute(sql`TRUNCATE ${dailySyncTable}, ${dataResetTable}, ${syncConflictLogsTable}, ${syncOutboxEventsTable}, ${syncOutboxCursorsTable}, ${userRolesTable}, ${usersTable}, ${rolesTable} RESTART IDENTITY CASCADE`);
  await seedRoles();
  await db.insert(usersTable).values([
    { id: OPERATOR, username: "soak-operator", passwordHash: "x" },
    { id: MANAGER, username: "soak-manager", passwordHash: "x" },
    { id: SANDBOX_MANAGER, username: "soak-sandbox-manager", passwordHash: "x", sandbox: true },
  ]);
  await db.insert(userRolesTable).values([
    { userId: OPERATOR, role: "operator" },
    { userId: MANAGER, role: "manager" },
    { userId: SANDBOX_MANAGER, role: "manager" },
  ]);
});

function headers(user = OPERATOR): Record<string, string> {
  return { authorization: `Bearer ${signLegacyTokenForTests(user)}` };
}

async function startIsolatedSyncProcess(): Promise<{ child: ChildProcess; baseUrl: string }> {
  const fixturePath = path.join(repoRoot, "artifacts/api-server/src/test-fixtures/syncProcessServer.mts");
  const child = fork(fixturePath, {
    cwd: repoRoot,
    execPath: path.join(repoRoot, "scripts/node_modules/.bin/tsx"),
    env: {
      ...process.env,
      DATABASE_URL: testDatabaseUrl,
      SYNC_OUTBOX_LISTENER_TEST_ENABLED: "1",
      // Keep auxiliary heartbeat and calculation frames out of event assertions.
      AUTO_TRACK_HEARTBEAT_MS: "5000",
      LIVE_CALC_TICK_MS: "60000",
    },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  try {
    const port = await new Promise<number>((resolve, reject) => {
      let settled = false;
      const finish = (error: Error | undefined, readyPort?: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        child.off("error", onError);
        child.off("exit", onExit);
        child.off("message", onMessage);
        if (error) reject(error);
        else resolve(readyPort!);
      };
      const onError = (error: Error) => finish(error);
      const onExit = (code: number | null) =>
        finish(new Error(`isolated sync process exited before ready (${code})`));
      const onMessage = (message: unknown) => {
        if (message && typeof message === "object" && (message as { type?: string }).type === "ready") {
          finish(undefined, (message as { port: number }).port);
        }
      };
      const timeout = setTimeout(
        () => finish(new Error("isolated sync process did not start")),
        20_000,
      );
      child.once("error", onError);
      child.once("exit", onExit);
      child.on("message", onMessage);
    });
    return { child, baseUrl: `http://127.0.0.1:${port}` };
  } catch (error) {
    await stopIsolatedSyncProcess(child);
    throw error;
  }
}

async function stopIsolatedSyncProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timeout);
      child.off("exit", finish);
      resolve();
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish();
    }, 5_000);
    child.once("exit", finish);
  });
}

type FrameReadState = {
  buffer: string;
  pendingChunk?: ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>;
};

async function readDataFrame(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  state: FrameReadState,
  timeoutMs = 5_000,
): Promise<Record<string, unknown>> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    const timedOut = new Promise<never>((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error("timed out waiting for data frame")),
        timeoutMs,
      );
    });
    for (;;) {
      const match = state.buffer.match(/data: (.+)\n\n/);
      if (match) {
        state.buffer = state.buffer.slice(match.index! + match[0].length);
        return JSON.parse(match[1]) as Record<string, unknown>;
      }
      const pendingChunk = state.pendingChunk ?? reader.read();
      state.pendingChunk = pendingChunk;
      const chunk = await Promise.race([pendingChunk, timedOut]);
      if (state.pendingChunk === pendingChunk) state.pendingChunk = undefined;
      if (chunk.done) throw new Error("stream closed");
      state.buffer += new TextDecoder().decode(chunk.value);
    }
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function isSyncOutboxFrame(frame: Record<string, unknown>): boolean {
  return frame.reset === true
    || frame.rollover === true
    || (frame.type === "master-data" && frame.configurationInvalidated === true)
    || (
      frame.scope === "live"
      && typeof frame.date === "string"
      && frame.data !== null
      && typeof frame.data === "object"
    );
}

async function readMatchingFrame(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  state: FrameReadState,
  predicate: (frame: Record<string, unknown>) => boolean,
  timeoutMs = 5_000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("timed out waiting for matching data frame");
    let frame: Record<string, unknown>;
    try {
      frame = await readDataFrame(reader, state, remaining);
    } catch (error) {
      if (error instanceof Error && error.message === "timed out waiting for data frame") {
        throw new Error("timed out waiting for matching data frame");
      }
      throw error;
    }
    if (predicate(frame)) return frame;
  }
}

async function expectNoSyncOutboxFrame(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  state: FrameReadState,
  timeoutMs: number,
): Promise<void> {
  try {
    const frame = await readMatchingFrame(reader, state, isSyncOutboxFrame, timeoutMs);
    throw new Error(`unexpected sync outbox frame: ${JSON.stringify(frame)}`);
  } catch (error) {
    if (error instanceof Error && error.message === "timed out waiting for matching data frame") {
      return;
    }
    throw error;
  }
}

type OpenSyncStream = {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  state: FrameReadState;
  initial: Record<string, unknown>;
  close: () => Promise<void>;
};

async function openSyncStream(
  baseUrl: string,
  today: string,
  clientId: string,
  user = OPERATOR,
): Promise<OpenSyncStream> {
  const response = await fetch(
    `${baseUrl}/api/sync/events?today=${today}&clientId=${clientId}`,
    { headers: headers(user) },
  );
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  const state: FrameReadState = { buffer: "" };
  const initial = await readDataFrame(reader, state);
  expect(initial).toMatchObject({
    initial: true,
    completeness: "complete",
  });
  return { reader, state, initial, close: () => reader.cancel() };
}

let rolloverRequestSequence = 0;
async function runRolloverInProcess(
  child: ChildProcess,
  options: { nowMs: number; timeZone: string },
): Promise<{ rolled: boolean; epoch: number; toDate: string }> {
  const requestId = `rollover-${++rolloverRequestSequence}`;
  type ResponseMessage = {
    type?: string;
    requestId?: string;
    ok?: boolean;
    result?: { rolled?: boolean; epoch?: number; toDate?: string };
  };
  const result = await new Promise<ResponseMessage>((resolve, reject) => {
    const finish = (error?: Error, response?: ResponseMessage) => {
      clearTimeout(timeout);
      child.off("error", onError);
      child.off("exit", onExit);
      child.off("message", onMessage);
      if (error) reject(error);
      else resolve(response!);
    };
    const timeout = setTimeout(
      () => finish(new Error("rollover fixture operation timed out")),
      10_000,
    );
    const onError = (error: Error) => finish(error);
    const onExit = (code: number | null) =>
      finish(new Error(`isolated sync process exited during rollover (${code})`));
    const onMessage = (message: unknown) => {
      if (
        message
        && typeof message === "object"
        && (message as ResponseMessage).type === "operation-result"
        && (message as ResponseMessage).requestId === requestId
      ) {
        finish(undefined, message as ResponseMessage);
      }
    };
    child.on("error", onError);
    child.on("exit", onExit);
    child.on("message", onMessage);
    child.send({ type: "run-daily-rollover", requestId, options });
  });
  if (!result.ok || !result.result) throw new Error("isolated rollover operation failed");
  return {
    rolled: result.result.rolled === true,
    epoch: Number(result.result.epoch),
    toDate: String(result.result.toDate),
  };
}

async function syncOutboxListenerPids(): Promise<number[]> {
  const result = await pool.query<{ pid: number }>(
    `SELECT pid
     FROM pg_stat_activity
     WHERE datname = current_database()
       AND state = 'idle'
       AND query LIKE 'LISTEN sync_outbox%'
     ORDER BY pid`,
  );
  return result.rows.map(({ pid }) => Number(pid));
}

async function waitForSyncOutboxListeners(
  count: number,
  timeoutMs = 10_000,
  predicate: (pids: number[]) => boolean = () => true,
): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pids = await syncOutboxListenerPids();
    if (pids.length === count && predicate(pids)) return pids;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("sync outbox listener count did not converge");
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
  readonly metrics: Metrics = {
    requests: 0,
    retries: 0,
    recoveredWrites: 0,
    replayedIntentCount: 0,
    conflicts: 0,
    convergenceMs: 0,
    divergentFields: [],
  };
  private online = true;
  private queued: QueuedSyncWrite[] = [];
  private lastQueued: QueuedSyncWrite | null = null;
  private logicalNow = 10_000;
  private _epoch = 0;
  private snapshotId = "";
  private canonicalState: SyncPayload | null = null;
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
      this.canonicalState = this.state ? clone(this.state) : null;
      this.snapshotId = res.headers.get("x-sync-snapshot") ?? "";
      return true;
    } catch {
      return false;
    }
  }

  async push(
    today = TODAY,
    payload = this.state,
    epoch = this._epoch,
    baseSnapshotId = this.snapshotId,
    baseSnapshot = this.canonicalState,
    allowRecovery = true,
  ): Promise<SyncResponse | null> {
    if (!payload) throw new Error(`${this.id} has no payload`);
    try {
      const res = await this.request("PUT", `/api/sync/today?today=${today}&epoch=${epoch}`, {
        senderId: this.id,
        payload: {
          ...payload,
          syncVersion: 1,
          completeness: "complete",
          baseSnapshotId,
        },
      });
      const body = (await res.json()) as SyncResponse;
      if (body.stale) {
        this._epoch = body.epoch ?? this._epoch;
        this.metrics.retries++;
        return body;
      }
      if (body.partialFallback && body.data) {
        this.state = clone(body.data);
        this.canonicalState = clone(body.data);
        this.snapshotId = body.snapshotId ?? "";
        if (!allowRecovery || !baseSnapshot || !this.snapshotId) return body;
        const recovery = rebaseStaleSyncIntent(
          baseSnapshot,
          payload,
          body.data,
          { snapshotId: this.snapshotId, serverTime: body.serverTime ?? this.logicalNow },
        );
        if (recovery.reappliedChanges === 0) return body;
        this.metrics.retries++;
        this.metrics.recoveredWrites++;
        this.metrics.replayedIntentCount += 1;
        this.state = clone(recovery.payload as unknown as SyncPayload);
        const recovered = await this.push(
          today,
          recovery.payload as unknown as SyncPayload,
          epoch,
          this.snapshotId,
          body.data,
          false,
        );
        if (recovered?.partialFallback) {
          this.metrics.conflicts++;
        }
        return recovered;
      }
      if (body.data) this.state = clone(body.data);
      if (body.data) this.canonicalState = clone(body.data);
      if (typeof body.snapshotId === "string") this.snapshotId = body.snapshotId;
      return body;
    } catch {
      const queued = {
        date: "today",
        today,
        payload: clone(payload),
        baseSnapshot: clone(baseSnapshot ?? payload),
        epoch,
        baseSnapshotId,
      };
      this.lastQueued = clone(queued);
      const sameBase = this.queued.findIndex((item) =>
        item.today === today
        && item.epoch === epoch
        && item.baseSnapshotId === baseSnapshotId,
      );
      if (sameBase >= 0) this.queued[sameBase] = queued;
      else this.queued.push(queued);
      return null;
    }
  }

  async flush(): Promise<void> {
    while (this.queued.length > 0 && this.online) {
      const item = this.queued.shift()!;
      this.metrics.retries++;
      await this.push(
        item.today,
        item.payload,
        item.epoch,
        item.baseSnapshotId,
        item.baseSnapshot,
      );
    }
  }

  reload(): SimulatedClient {
    const next = new SimulatedClient(this.id);
    const persisted = JSON.parse(JSON.stringify({
      queued: this.queued,
      lastQueued: this.lastQueued,
      state: this.state,
      canonicalState: this.canonicalState,
      snapshotId: this.snapshotId,
      epoch: this._epoch,
      logicalNow: this.logicalNow,
    })) as {
      queued: QueuedSyncWrite[];
      lastQueued: QueuedSyncWrite | null;
      state: SyncPayload | null;
      canonicalState: SyncPayload | null;
      snapshotId: string;
      epoch: number;
      logicalNow: number;
    };
    next.queued = persisted.queued;
    next.lastQueued = persisted.lastQueued;
    next.state = persisted.state;
    next.canonicalState = persisted.canonicalState;
    next.snapshotId = persisted.snapshotId;
    next._epoch = persisted.epoch;
    next.logicalNow = persisted.logicalNow;
    next.online = this.online;
    return next;
  }

  queuedForDuplicateDelivery(): {
    today: string;
    payload: SyncPayload;
    epoch: number;
    baseSnapshotId: string;
    baseSnapshot: SyncPayload;
  } | null {
    return this.lastQueued ? clone(this.lastQueued) : null;
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
    breaks: clone(CANONICAL_BREAKS),
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
      pizzasPerCase: 12,
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
  it("commits sync state and its durable outbox cursor in the same transaction", async () => {
    const writer = new SimulatedClient("outbox-writer");
    expect(await writer.pull()).toBe(true);
    writer.state = fixture();
    expect((await writer.push())?.ok).toBe(true);

    const [day] = await db.select().from(dailySyncTable)
      .where(and(eq(dailySyncTable.scope, "live"), eq(dailySyncTable.date, TODAY)));
    const events = await db.select().from(syncOutboxEventsTable)
      .where(eq(syncOutboxEventsTable.scope, "live"))
      .orderBy(asc(syncOutboxEventsTable.cursor));
    const [cursor] = await db.select().from(syncOutboxCursorsTable)
      .where(eq(syncOutboxCursorsTable.scope, "live"));
    expect(day?.data).toMatchObject({
      dayState: { runs: [{ id: "run-main" }] },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      cursor: 1,
      kind: "day-state",
      date: TODAY,
      senderId: "outbox-writer",
    });
    expect(cursor?.cursor).toBe(events[0]!.cursor);
  }, 30_000);

  it("keeps per-scope cursors ordered and rolls them back with failed writes", async () => {
    await expect(db.transaction(async (tx) => {
      await tx.insert(dailySyncTable).values({
        scope: "live",
        date: TODAY,
        data: fixture() as any,
      });
      await (await import("../lib/syncOutbox")).appendSyncOutboxEvent(tx, {
        kind: "day-state",
        scope: "live",
        date: TODAY,
        senderId: "rolled-back",
        canonicalRevision: 1,
      });
      throw new Error("intentional test rollback");
    })).rejects.toThrow("intentional test rollback");
    expect(await db.select().from(syncOutboxCursorsTable)).toHaveLength(0);
    expect(await db.select().from(syncOutboxEventsTable)).toHaveLength(0);
    expect(await db.select().from(dailySyncTable)).toHaveLength(0);

    const { appendSyncOutboxEvent } = await import("../lib/syncOutbox");
    const cursors = await Promise.all(["first", "second"].map((senderId) =>
      db.transaction((tx) => appendSyncOutboxEvent(tx, {
        kind: "configuration",
        scope: "live",
        senderId,
        family: "master-data",
      })),
    ));
    expect([...cursors].sort((a, b) => a - b)).toEqual([1, 2]);
    const events = await db.select().from(syncOutboxEventsTable)
      .where(eq(syncOutboxEventsTable.scope, "live"))
      .orderBy(asc(syncOutboxEventsTable.cursor));
    expect(events.map((event) => event.cursor)).toEqual([1, 2]);
  }, 30_000);

  it("keeps the canonical break plan when reconnect replays a stale queued snapshot", async () => {
    const client = new SimulatedClient("break-offline");
    expect(await client.pull()).toBe(true);
    client.state = fixture();
    await client.push();

    const staleBreaks = [
      { slot: 1, enabled: true, mode: "at-time", atTime: "06:00", durationMin: 5 },
      { slot: 2, enabled: true, mode: "after-run", runId: "run-main", durationMin: 90 },
    ];
    client.setOnline(false);
    client.edit((state) => {
      (state.dayState as Record<string, unknown>).breaks = staleBreaks;
    });
    await client.push();

    const reloaded = client.reload();
    reloaded.setOnline(true);
    expect(await reloaded.pull()).toBe(true);
    const queued = reloaded.queuedForDuplicateDelivery();
    expect(queued).not.toBeNull();
    await reloaded.flush();
    expect((reloaded.state?.dayState as Record<string, unknown>).breaks).toEqual(CANONICAL_BREAKS);

    expect(await reloaded.pull()).toBe(true);
    const recoveredBreaks = (reloaded.state?.dayState as Record<string, unknown>).breaks;
    expect(recoveredBreaks).toEqual(CANONICAL_BREAKS);
    expect(recoveredBreaks).toHaveLength(3);
    expect((recoveredBreaks as Array<{ durationMin: number }>).every((slot) => slot.durationMin === 30)).toBe(true);

    const requestsBeforeDuplicate = reloaded.metrics.requests;
    const duplicate = await reloaded.push(
      queued!.today,
      queued!.payload,
      queued!.epoch,
      queued!.baseSnapshotId,
      queued!.baseSnapshot,
    );
    expect(duplicate?.partialFallback).toBe(true);
    expect(reloaded.metrics.requests).toBe(requestsBeforeDuplicate + 1);
    expect((reloaded.state?.dayState as Record<string, unknown>).breaks).toEqual(CANONICAL_BREAKS);
  }, 30_000);

  it("rebases interleaved offline edits after reload and does not replay a queued intent twice", async () => {
    const writer = new SimulatedClient("interleaved-writer");
    const offline = new SimulatedClient("interleaved-offline");
    expect(await writer.pull()).toBe(true);
    writer.state = fixture();
    expect((await writer.push())?.ok).toBe(true);
    expect(await offline.pull()).toBe(true);

    offline.setOnline(false);
    offline.edit((state) => {
      const values = state.runValues as Record<string, Record<string, unknown>>;
      values["run-main"].casesNeeded = 777;
      values["run-main"].pizzasPerCase = 14;
    });
    expect(await offline.push()).toBeNull();
    const reloaded = offline.reload();
    const queued = reloaded.queuedForDuplicateDelivery();
    expect(queued).not.toBeNull();

    writer.edit((state) => {
      const values = state.runValues as Record<string, Record<string, unknown>>;
      values["run-main"].casesNeeded = 999;
    });
    expect((await writer.push())?.ok).toBe(true);

    reloaded.setOnline(true);
    expect(await reloaded.pull()).toBe(true);
    await reloaded.flush();
    expect(reloaded.metrics.recoveredWrites).toBe(1);
    expect(reloaded.metrics.replayedIntentCount).toBe(1);
    expect(reloaded.state?.runValues).toMatchObject({
      "run-main": {
        casesNeeded: 999,
        pizzasPerCase: 14,
      },
    });

    const requestsBeforeDuplicate = reloaded.metrics.requests;
    const duplicate = await reloaded.push(
      queued!.today,
      queued!.payload,
      queued!.epoch,
      queued!.baseSnapshotId,
      queued!.baseSnapshot,
    );
    expect(duplicate?.partialFallback).toBe(true);
    expect(reloaded.metrics.requests).toBe(requestsBeforeDuplicate + 1);
    expect(reloaded.metrics.replayedIntentCount).toBe(1);
    expect(await reloaded.pull()).toBe(true);
    expect(reloaded.state?.runValues).toMatchObject({
      "run-main": {
        casesNeeded: 999,
        pizzasPerCase: 14,
      },
    });
  }, 30_000);

  it("delivers scoped outbox events between API processes and recovers lost notifications", async () => {
    const processA = await startIsolatedSyncProcess();
    let processB: Awaited<ReturnType<typeof startIsolatedSyncProcess>> | undefined;
    const streams: OpenSyncStream[] = [];
    try {
      await waitForSyncOutboxListeners(1);
      const processAPids = await syncOutboxListenerPids();
      processB = await startIsolatedSyncProcess();
      const bothPids = await waitForSyncOutboxListeners(2);
      const processBPid = bothPids.find((pid) => !processAPids.includes(pid));
      expect(processBPid).toBeTypeOf("number");

      const todayPeer = await openSyncStream(processB.baseUrl, TODAY, "process-b-today-peer");
      const tomorrowPeer = await openSyncStream(processB.baseUrl, TOMORROW, "process-b-tomorrow-peer");
      const sandboxPeer = await openSyncStream(
        processB.baseUrl,
        TODAY,
        "process-b-sandbox-peer",
        SANDBOX_MANAGER,
      );
      streams.push(todayPeer, tomorrowPeer, sandboxPeer);

      const initialWrite = await fetch(
        `${processA.baseUrl}/api/sync/today?today=${TODAY}&epoch=0`,
        {
          method: "PUT",
          headers: { ...headers(), "content-type": "application/json" },
          body: JSON.stringify({ senderId: "process-a-writer", payload: fixture() }),
        },
      );
      expect(initialWrite.status).toBe(200);
      const dayStateEvent = await readMatchingFrame(
        todayPeer.reader,
        todayPeer.state,
        (frame) => frame.senderId === "process-a-writer" && frame.date === TODAY,
      );
      expect(dayStateEvent).toMatchObject({
        senderId: "process-a-writer",
        data: {
          dayState: { runs: [{ id: "run-main", brand: "Acme", flavor: "Pepperoni" }] },
          runValues: { "run-main": { casesNeeded: 240 } },
        },
      });
      await expectNoSyncOutboxFrame(tomorrowPeer.reader, tomorrowPeer.state, CROSS_PROCESS_SILENCE_WINDOW_MS);
      await expectNoSyncOutboxFrame(sandboxPeer.reader, sandboxPeer.state, CROSS_PROCESS_SILENCE_WINDOW_MS);

      const [dayCursor] = await db.select({ cursor: syncOutboxCursorsTable.cursor })
        .from(syncOutboxCursorsTable)
        .where(eq(syncOutboxCursorsTable.scope, "live"));
      await pool.query("SELECT pg_notify('sync_outbox', $1)", [
        JSON.stringify({ scope: "live", cursor: dayCursor!.cursor }),
      ]);
      await pool.query("SELECT pg_notify('sync_outbox', $1)", [
        JSON.stringify({ scope: "live", cursor: dayCursor!.cursor }),
      ]);
      await expectNoSyncOutboxFrame(todayPeer.reader, todayPeer.state, 350);

      // Kill process B's dedicated LISTEN connection, commit a real API write,
      // then prove the recovered listener brings the peer to canonical state.
      const killed = await pool.query<{ terminated: boolean }>(
        "SELECT pg_terminate_backend($1) AS terminated",
        [processBPid],
      );
      expect(killed.rows[0]?.terminated).toBe(true);
      await waitForSyncOutboxListeners(1);
      const updated = clone(fixture());
      (updated.runValues as Record<string, Record<string, unknown>>)["run-main"]!.casesNeeded = 321;
      (updated.runValuesUpdatedAt as Record<string, number>)["run-main"] = Date.now() + 10_000;
      const disconnectedWrite = await fetch(
        `${processA.baseUrl}/api/sync/today?today=${TODAY}&epoch=0`,
        {
          method: "PUT",
          headers: { ...headers(), "content-type": "application/json" },
          body: JSON.stringify({ senderId: "process-a-recovery-writer", payload: updated }),
        },
      );
      expect(disconnectedWrite.status).toBe(200);
      const disconnectedResult = await disconnectedWrite.json() as {
        data?: { runValues?: Record<string, { casesNeeded?: number }> };
      };
      expect(disconnectedResult.data?.runValues?.["run-main"]?.casesNeeded).toBe(321);
      await waitForSyncOutboxListeners(2, 10_000, (pids) => !pids.includes(processBPid!));
      const recoveredDayState = await readMatchingFrame(
        todayPeer.reader,
        todayPeer.state,
        (frame) => (
          frame.senderId === "process-a-recovery-writer"
          || frame.canonicalReconcile === true
        ) && frame.date === TODAY,
        8_000,
      );
      expect(
        recoveredDayState.senderId === "process-a-recovery-writer"
        || recoveredDayState.canonicalReconcile === true,
      ).toBe(true);
      expect(
        (recoveredDayState.data as { runValues?: Record<string, { casesNeeded?: number }> })
          ?.runValues?.["run-main"]?.casesNeeded,
      ).toBe(321);

      // A durable event with no NOTIFY at all must still be delivered by the
      // periodic cursor drain; it carries only bounded invalidation metadata.
      let missedCursor = 0;
      await db.transaction(async (tx) => {
        await tx.insert(syncOutboxCursorsTable).values({ scope: "live", cursor: 0 })
          .onConflictDoNothing();
        const [current] = await tx.select().from(syncOutboxCursorsTable)
          .where(eq(syncOutboxCursorsTable.scope, "live")).for("update");
        missedCursor = current!.cursor + 1;
        await tx.update(syncOutboxCursorsTable)
          .set({ cursor: missedCursor, updatedAt: new Date() })
          .where(eq(syncOutboxCursorsTable.scope, "live"));
        await tx.insert(syncOutboxEventsTable).values({
          scope: "live",
          cursor: missedCursor,
          kind: "configuration",
          date: null,
          senderId: "missed-notification-writer",
          payload: { family: "profiles", origin: "no-notify-test" },
        });
      });
      const polledMissedNotification = await readMatchingFrame(
        todayPeer.reader,
        todayPeer.state,
        (frame) => (
          frame.type === "master-data"
          && frame.family === "profiles"
          && frame.senderId === "missed-notification-writer"
        ),
        8_000,
      );
      expect(polledMissedNotification).toMatchObject({
        type: "master-data",
        configurationInvalidated: true,
        family: "profiles",
        senderId: "missed-notification-writer",
      });

      const resetResponse = await fetch(`${processA.baseUrl}/api/sync/reset`, {
        method: "POST",
        headers: headers(MANAGER),
      });
      expect(resetResponse.status).toBe(200);
      const resetResult = await resetResponse.json() as { epoch: number };
      expect(resetResult.epoch).toBe(1);
      expect(await readMatchingFrame(
        todayPeer.reader,
        todayPeer.state,
        (frame) => frame.reset === true && frame.resetEpoch === 1,
      )).toMatchObject({
        reset: true,
        resetEpoch: 1,
      });
      expect(await readMatchingFrame(
        tomorrowPeer.reader,
        tomorrowPeer.state,
        (frame) => frame.reset === true && frame.resetEpoch === 1,
      )).toMatchObject({
        reset: true,
        resetEpoch: 1,
      });
      await expectNoSyncOutboxFrame(sandboxPeer.reader, sandboxPeer.state, 350);

      const blankDay = (date: string) => ({
        dayState: { date, runs: [] },
        runValues: {},
      });
      await db.insert(dailySyncTable).values([
        { scope: "live", date: "2031-06-14", data: blankDay("2031-06-14") as any },
        { scope: "live", date: TODAY, data: blankDay(TODAY) as any },
      ]);
      const rollover = await runRolloverInProcess(processA.child, {
        nowMs: Date.UTC(2031, 5, 15, 18),
        timeZone: "UTC",
      });
      expect(rollover).toMatchObject({ rolled: true, epoch: 2, toDate: TODAY });
      expect(await readMatchingFrame(
        todayPeer.reader,
        todayPeer.state,
        (frame) => frame.rollover === true && frame.resetEpoch === 2,
      )).toMatchObject({
        rollover: true,
        resetEpoch: 2,
      });
      expect(await readMatchingFrame(
        todayPeer.reader,
        todayPeer.state,
        (frame) => frame.scope === "live" && frame.date === TODAY && typeof frame.data === "object",
      )).toMatchObject({
        data: { dayState: { date: TODAY, runs: [] } },
      });
      expect(await readMatchingFrame(
        tomorrowPeer.reader,
        tomorrowPeer.state,
        (frame) => frame.rollover === true && frame.resetEpoch === 2,
      )).toMatchObject({
        rollover: true,
        resetEpoch: 2,
      });
      await expectNoSyncOutboxFrame(tomorrowPeer.reader, tomorrowPeer.state, 350);
      await expectNoSyncOutboxFrame(sandboxPeer.reader, sandboxPeer.state, 350);

      const masterDataResponse = await fetch(`${processA.baseUrl}/api/dough-recipes`, {
        method: "POST",
        headers: {
          ...headers(MANAGER),
          "content-type": "application/json",
          "x-client-id": "process-a-recipe-writer",
        },
        body: JSON.stringify({
          items: [{
            id: "fanout-dough-recipe",
            name: "Fanout Test Dough",
            components: [{ ingredient: "Flour", lbs: 10 }],
            enabled: true,
          }],
        }),
      });
      expect(masterDataResponse.status).toBe(200);
      expect(await readMatchingFrame(
        todayPeer.reader,
        todayPeer.state,
        (frame) => frame.family === "master-data" && frame.senderId === "process-a-recipe-writer",
      )).toMatchObject({
        type: "master-data",
        configurationInvalidated: true,
        family: "master-data",
        senderId: "process-a-recipe-writer",
      });
      expect(await readMatchingFrame(
        tomorrowPeer.reader,
        tomorrowPeer.state,
        (frame) => frame.family === "master-data" && frame.senderId === "process-a-recipe-writer",
      )).toMatchObject({
        type: "master-data",
        configurationInvalidated: true,
        family: "master-data",
        senderId: "process-a-recipe-writer",
      });
      await expectNoSyncOutboxFrame(sandboxPeer.reader, sandboxPeer.state, 350);

      // A fresh stream on process B must begin from current canonical state;
      // this is reconnect recovery, distinct from event delivery.
      const reconnectPeer = await openSyncStream(
        processB.baseUrl,
        TODAY,
        "process-b-canonical-reconnect",
      );
      streams.push(reconnectPeer);
      const canonicalReconnect = reconnectPeer.initial;
      expect(canonicalReconnect).toMatchObject({
        initial: true,
        completeness: "complete",
        data: {
          dayState: { date: TODAY, rolloverEpoch: 2, runs: [] },
          runValues: {},
        },
      });

      console.info("[sync peer fanout evidence]", JSON.stringify({
        apiProcesses: 2,
        isolatedDisposableDatabase: true,
        dayStateCrossProcess: true,
        dateAndScopeIsolation: true,
        duplicateNotificationIdempotence: true,
        listenerRecoveryAfterBackendTermination: true,
        missedNotificationPollingRecovery: true,
        resetAndRolloverCrossProcess: true,
        masterDataCrossProcess: true,
        canonicalReconnectRecovery: true,
      }));
    } finally {
      await Promise.all(streams.map((stream) => stream.close().catch(() => {})));
      if (processB) await stopIsolatedSyncProcess(processB.child);
      await stopIsolatedSyncProcess(processA.child);
    }
  }, 30_000);

  it("converges edits, offline reconnects, wake recovery, stale writes, and blank protection", async () => {
    const clients = ["A", "B", "C"].map((id) => new SimulatedClient(id));
    const start = Date.now();
    const seed = clients[0];
    await seed.pull();
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
        const progress = (state.packagingProgress as Record<string, Record<string, unknown>>)["run-main"];
        progress.casesOnCurrentSkid = 13 + i;
        progress.updatedAt = 10_001 + i;
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
    expect(stalePut?.data?.runValues).toMatchObject({
      "run-main": {
        casesNeeded: 251,
        casesOnCurrentSkid: 24,
        skidsCompleted: 1,
      },
    });
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
    await client.pull();
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
