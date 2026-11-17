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
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { and, asc, eq, sql } from "drizzle-orm";
import { signLegacyTokenForTests } from "../lib/auth";
import { rebaseStaleSyncIntent } from "@workspace/sync-contract/stale-base-recovery";
import { MANUAL_SECTION_FIELDS } from "@workspace/sync-contract";
import {
  stopIsolatedSyncProcess,
  stopIsolatedSyncProcesses,
} from "./syncConvergenceProcess";

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
    stdio: "inherit",
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
        45_000,
      );
      child.once("error", onError);
      child.once("exit", onExit);
      child.on("message", onMessage);
    });
    return { child, baseUrl: `http://127.0.0.1:${port}` };
  } catch (error) {
    try {
      await stopIsolatedSyncProcess(child);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Isolated sync process startup failed and cleanup also failed",
        { cause: error },
      );
    }
    throw error;
  }
}

async function stopSyncOutboxListenerInProcess(child: ChildProcess): Promise<void> {
  const requestId = "stop-sync-outbox-listener";
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error("timed out stopping sync outbox listener")), 5_000);
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      child.off("message", onMessage);
      child.off("exit", onExit);
      if (error) reject(error);
      else resolve();
    };
    const onMessage = (message: unknown) => {
      if (
        message
        && typeof message === "object"
        && (message as { type?: string }).type === "sync-outbox-stopped"
        && (message as { requestId?: string }).requestId === requestId
      ) finish();
    };
    const onExit = (code: number | null) =>
      finish(new Error(`isolated sync process exited while stopping its listener (${code})`));
    child.on("message", onMessage);
    child.once("exit", onExit);
    child.send({ type: "stop-sync-outbox-listener", requestId });
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
    method: "GET" | "PUT" | "POST",
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

  /** Real commands, not simulated snapshot ownership of operational fields. */
  async mutateOperational(lifecycle: "start" | "end" | number): Promise<void> {
    expect(await this.pull()).toBe(true);
    const state = this.state!;
    const run = (state.dayState as { runs: Array<Record<string, unknown>> }).runs[0];
    const identity = {
      id: `soak:${this.id}:${++this.logicalNow}`,
      runId: "run-main",
      observedGeneration: `run-main:${run.metaUpdatedAt ?? run.startedAt ?? 0}`,
      baseRevision: state.canonicalRevision,
      deviceId: this.id,
    };
    let response: Response;
    if (typeof lifecycle === "number") {
      const values = (state.runValues as Record<string, Record<string, unknown>>)["run-main"];
      const baseValues = Object.fromEntries(MANUAL_SECTION_FIELDS.packaging.map((field) => [field, values[field] ?? 0]));
      response = await this.request("POST", `/api/sync/manual-section?today=${TODAY}&epoch=${this._epoch}`, {
        ...identity, date: TODAY, resetEpoch: this._epoch, section: "packaging",
        baseValues, values: { ...baseValues, skidsCompleted: 1, casesOnCurrentSkid: lifecycle },
      });
    } else {
      response = await this.request("POST", `/api/sync/operational-intents?today=${TODAY}&epoch=${this._epoch}`, {
        deviceId: this.id,
        intent: {
          ...identity, version: 1, date: TODAY, resetEpoch: this._epoch,
          effectiveAt: Date.now(), action: "lifecycle", lifecycle,
          ...(lifecycle === "end" ? { inventoryLines: [] } : {}),
        },
      });
    }
    const receipt = await response.json() as SyncResponse & { outcome?: string; code?: string; error?: string };
    expect(response.status, `${receipt.outcome ?? ""}: ${receipt.code ?? receipt.error ?? ""}`).toBe(200);
    expect(receipt.outcome).toBe("accepted");
    expect(receipt.data).toBeDefined();
    this.state = clone(receipt.data!);
    this.canonicalState = clone(receipt.data!);
    this.snapshotId = receipt.snapshotId!;
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
          { snapshotId: this.snapshotId, serverTime: body.serverTime ?? this.logicalNow, enforceOperationalAuthority: true },
        );
        expect(recovery.reviewRequiredChanges).toBe(0);
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
    }],
  },
  runValues: {
    "run-main": {
      casesNeeded: 240,
      pizzasPerCase: 12,
      casesPerSkid: 48,
      doughRecipe: [{ ingredient: "Flour", lbs: 42 }],
    },
  },
  runValuesUpdatedAt: { "run-main": 1_000 },
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
  }, 90_000);

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
  }, 120_000);

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
    let primaryFailure: unknown;
    let hasPrimaryFailure = false;
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
      // Real elapsed time over two independent API processes and PostgreSQL's
      // durable outbox. Unlike the logical-clock soak this measures delivery.
      const deliverySamples: Array<{ ackMs: number; peerMs: number; bytes: number; serverTiming: string }> = [];
      let baseline = await initialWrite.json() as { data: SyncPayload; snapshotId: string };
      for (let sample = 0; sample < 10; sample++) {
        const payload = clone(baseline.data);
        const values = payload.runValues as Record<string, Record<string, unknown>>;
        values["run-main"]!.casesNeeded = 241 + sample;
        const body = JSON.stringify({
          senderId: `latency-${sample}`,
          payload: { ...payload, syncVersion: 1, completeness: "complete", baseSnapshotId: baseline.snapshotId },
          snapshotId: baseline.snapshotId,
        });
        const startedAt = performance.now();
        const response = await fetch(`${processA.baseUrl}/api/sync/today?today=${TODAY}&epoch=0`, {
          method: "PUT", headers: { ...headers(), "content-type": "application/json" }, body,
        });
        expect(response.status).toBe(200);
        baseline = await response.json() as typeof baseline;
        const ackMs = performance.now() - startedAt;
        expect((baseline.data.runValues as typeof values)["run-main"]!.casesNeeded).toBe(241 + sample);
        const frame = await readMatchingFrame(todayPeer.reader, todayPeer.state,
          (frame) => frame.senderId === `latency-${sample}`);
        // Reconstruct the maintained peer delta before checking adoption.
        const peerData = frame.data as SyncPayload;
        expect((peerData.runValues as typeof values)["run-main"]!.casesNeeded).toBe(241 + sample);
        deliverySamples.push({
          ackMs: Math.round(ackMs), peerMs: Math.round(performance.now() - startedAt),
          bytes: Buffer.byteLength(body), serverTiming: response.headers.get("Server-Timing") ?? "",
        });
      }
      console.info(`sync-latency ${JSON.stringify({ environment: "isolated-two-process", network: "loopback-unthrottled", samples: deliverySamples })}`);
      const latencyDirectory = path.join(repoRoot, "artifacts/run-calculator/generated-artifacts/sync-latency");
      await mkdir(latencyDirectory, { recursive: true });
      await writeFile(path.join(latencyDirectory, "two-process.json"), JSON.stringify({
        environment: "isolated-two-process", network: "loopback-unthrottled",
        capturedAt: new Date().toISOString(), samples: deliverySamples,
      }, null, 2));
      expect(Math.max(...deliverySamples.map((sample) => sample.ackMs))).toBeLessThan(2000);
      expect(Math.max(...deliverySamples.map((sample) => sample.peerMs))).toBeLessThan(2000);
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
      // then remove that retained event as if retention pruned its history.
      // Listener catch-up must detect the cursor gap and reconcile canonically.
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
      const [gapCursor] = await db.select({ cursor: syncOutboxCursorsTable.cursor })
        .from(syncOutboxCursorsTable)
        .where(eq(syncOutboxCursorsTable.scope, "live"));
      await db.delete(syncOutboxEventsTable).where(and(
        eq(syncOutboxEventsTable.scope, "live"),
        eq(syncOutboxEventsTable.cursor, gapCursor!.cursor),
      ));
      await waitForSyncOutboxListeners(2, 10_000, (pids) => !pids.includes(processBPid!));
      const recoveredDayState = await readMatchingFrame(
        todayPeer.reader,
        todayPeer.state,
        (frame) => frame.canonicalReconcile === true && frame.date === TODAY,
        8_000,
      );
      expect(recoveredDayState.canonicalReconcile).toBe(true);
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

      // The peer listener is optional for core API readiness. Explicitly stop
      // it while leaving process B serving, then verify readiness remains a
      // truthful core-service result rather than claiming peer-fanout health.
      await stopSyncOutboxListenerInProcess(processB.child);
      await waitForSyncOutboxListeners(1);
      const readinessResponse = await fetch(`${processB.baseUrl}/api/readyz`);
      expect(readinessResponse.status).toBe(200);
      expect(await readinessResponse.json()).toMatchObject({
        status: "ok",
        checks: { database: "ok", auditProtection: "ok" },
      });

      console.info("[sync peer fanout evidence]", JSON.stringify({
        apiProcesses: 2,
        isolatedDisposableDatabase: true,
        dayStateCrossProcess: true,
        dateAndScopeIsolation: true,
        duplicateNotificationIdempotence: true,
        listenerRecoveryAfterBackendTermination: true,
        prunedOutboxGapCanonicalReconciliation: true,
        missedNotificationPollingRecovery: true,
        resetAndRolloverCrossProcess: true,
        masterDataCrossProcess: true,
        canonicalReconnectRecovery: true,
        coreReadinessUnaffectedByStoppedOptionalListener: true,
      }));
    } catch (error) {
      primaryFailure = error;
      hasPrimaryFailure = true;
      throw error;
    } finally {
      await Promise.all(streams.map((stream) => stream.close().catch(() => {})));
      const cleanupFailures: unknown[] = [];
      try {
        await stopIsolatedSyncProcesses([processB?.child, processA.child]);
      } catch (error) {
        cleanupFailures.push(error);
      }
      try {
        await waitForSyncOutboxListeners(0, 5_000);
      } catch (error) {
        cleanupFailures.push(error);
      }
      if (cleanupFailures.length > 0) {
        if (hasPrimaryFailure) {
          throw new AggregateError(
            [primaryFailure, ...cleanupFailures],
            "Sync convergence test failed and isolated-process cleanup also failed",
            { cause: primaryFailure },
          );
        }
        throw cleanupFailures.length === 1
          ? cleanupFailures[0]
          : new AggregateError(
            cleanupFailures,
            "Isolated-process cleanup encountered multiple failures",
            { cause: cleanupFailures[0] },
          );
      }
    }
  }, 30_000);

  it("retries a transient outbox delivery failure without advancing its cursor", async () => {
    const syncOutbox = await import("../lib/syncOutbox");
    const { getBackgroundOperationDiagnostics } = await import("../lib/backgroundOperations");
    const previousTestFlag = process.env.SYNC_OUTBOX_LISTENER_TEST_ENABLED;
    syncOutbox.clearSyncOutboxProcessCursorsForTests();
    await syncOutbox.registerSyncOutboxScope("live");

    let attempts = 0;
    const delivered: number[] = [];
    process.env.SYNC_OUTBOX_LISTENER_TEST_ENABLED = "1";
    const stop = syncOutbox.startSyncOutboxListener(async (event) => {
      attempts += 1;
      if (attempts === 1) {
        throw Object.assign(new Error("transient outbox connection failure"), { code: "08006" });
      }
      delivered.push(event.cursor);
    }, async () => {});

    try {
      await waitForSyncOutboxListeners(1);
      await syncOutbox.recordSyncOutboxEvent({
        kind: "configuration",
        scope: "live",
        senderId: "outbox-recovery-test",
        family: "master-data",
      });
      const deadline = Date.now() + 10_000;
      while (attempts < 2 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      expect(attempts).toBe(2);
      expect(delivered).toEqual([1]);
      expect((await getBackgroundOperationDiagnostics())["sync-outbox-drain"]).toMatchObject({
        status: "ok",
        recentFailureCount: 0,
      });
    } finally {
      stop();
      await waitForSyncOutboxListeners(0);
      syncOutbox.clearSyncOutboxProcessCursorsForTests();
      if (previousTestFlag === undefined) delete process.env.SYNC_OUTBOX_LISTENER_TEST_ENABLED;
      else process.env.SYNC_OUTBOX_LISTENER_TEST_ENABLED = previousTestFlag;
    }
  }, 20_000);

  it("warns on old pending delivery and clears the warning after a slow consumer catches up", async () => {
    const syncOutbox = await import("../lib/syncOutbox");
    syncOutbox.clearSyncOutboxProcessCursorsForTests();
    await syncOutbox.registerSyncOutboxScope("live");
    const cursor = await syncOutbox.recordSyncOutboxEvent({
      kind: "configuration",
      scope: "live",
      senderId: "outbox-lag-test",
      family: "master-data",
    });
    await db.update(syncOutboxEventsTable)
      .set({
        createdAt: new Date(Date.now() - syncOutbox.SYNC_OUTBOX_LAG_WARNING_MS - 1),
      })
      .where(and(
        eq(syncOutboxEventsTable.scope, "live"),
        eq(syncOutboxEventsTable.cursor, cursor),
      ));

    let releaseHandler!: () => void;
    const handlerGate = new Promise<void>((resolve) => { releaseHandler = resolve; });
    let markHandlerStarted!: () => void;
    const handlerStarted = new Promise<void>((resolve) => { markHandlerStarted = resolve; });
    const delivered: number[] = [];
    const previousTestFlag = process.env.SYNC_OUTBOX_LISTENER_TEST_ENABLED;
    process.env.SYNC_OUTBOX_LISTENER_TEST_ENABLED = "1";
    const stop = syncOutbox.startSyncOutboxListener(async (event) => {
      markHandlerStarted();
      await handlerGate;
      delivered.push(event.cursor);
    }, async () => {});

    try {
      await waitForSyncOutboxListeners(1);
      const handlerDeadline = Date.now() + 10_000;
      let handlerStartupTimeout: NodeJS.Timeout | undefined;
      const started = await Promise.race([
        handlerStarted.then(() => true),
        new Promise<boolean>((resolve) => {
          handlerStartupTimeout = setTimeout(() => resolve(false), 10_000);
        }),
      ]);
      if (handlerStartupTimeout) clearTimeout(handlerStartupTimeout);
      expect(started, `outbox handler did not start before ${handlerDeadline}`).toBe(true);

      const lag = syncOutbox.getSyncOutboxLagDiagnostics();
      expect(lag).toMatchObject({
        status: "warning",
        lagging: true,
        pendingEvents: 1,
        warningThresholdMs: syncOutbox.SYNC_OUTBOX_LAG_WARNING_MS,
      });
      expect(JSON.stringify(lag)).not.toContain("live");
      expect(JSON.stringify(lag)).not.toContain("master-data");

      releaseHandler();
      const recoveryDeadline = Date.now() + 10_000;
      while (syncOutbox.getSyncOutboxLagDiagnostics().lagging && Date.now() < recoveryDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(delivered).toEqual([cursor]);
      expect(syncOutbox.getSyncOutboxLagDiagnostics()).toMatchObject({
        status: "ok",
        lagging: false,
        pendingEvents: 0,
        lagMs: 0,
      });
    } finally {
      releaseHandler();
      stop();
      await waitForSyncOutboxListeners(0);
      syncOutbox.clearSyncOutboxProcessCursorsForTests();
      if (previousTestFlag === undefined) delete process.env.SYNC_OUTBOX_LISTENER_TEST_ENABLED;
      else process.env.SYNC_OUTBOX_LISTENER_TEST_ENABLED = previousTestFlag;
    }
  }, 20_000);

  it("clears pending delivery diagnostics when the listener stops", async () => {
    const syncOutbox = await import("../lib/syncOutbox");
    syncOutbox.clearSyncOutboxProcessCursorsForTests();
    await syncOutbox.registerSyncOutboxScope("live");
    await syncOutbox.registerSyncOutboxScope("sandbox");

    const payloadSentinel = "outbox-stop-private-payload";
    const liveCursor = await syncOutbox.recordSyncOutboxEvent({
      kind: "configuration",
      scope: "live",
      senderId: payloadSentinel,
      family: "master-data",
    });
    await syncOutbox.recordSyncOutboxEvent({
      kind: "configuration",
      scope: "sandbox",
      senderId: payloadSentinel,
      family: "master-data",
    });
    await db.update(syncOutboxEventsTable)
      .set({ createdAt: new Date(Date.now() - syncOutbox.SYNC_OUTBOX_LAG_WARNING_MS - 1) })
      .where(and(
        eq(syncOutboxEventsTable.scope, "live"),
        eq(syncOutboxEventsTable.cursor, liveCursor),
      ));

    let releaseHandler!: () => void;
    const handlerGate = new Promise<void>((resolve) => { releaseHandler = resolve; });
    let markHandlerStarted!: () => void;
    const handlerStarted = new Promise<void>((resolve) => { markHandlerStarted = resolve; });
    let markHandlerFinished!: () => void;
    const handlerFinished = new Promise<void>((resolve) => { markHandlerFinished = resolve; });
    const previousTestFlag = process.env.SYNC_OUTBOX_LISTENER_TEST_ENABLED;
    process.env.SYNC_OUTBOX_LISTENER_TEST_ENABLED = "1";
    const stop = syncOutbox.startSyncOutboxListener(async () => {
      markHandlerStarted();
      await handlerGate;
      markHandlerFinished();
    }, async () => {});

    try {
      await waitForSyncOutboxListeners(1);
      await handlerStarted;

      // The live delivery is blocked in its handler. Seed a second scope's
      // process-local sample before stopping the listener.
      syncOutbox.observeSyncOutboxLag(
        "sandbox",
        1,
        Date.now() - syncOutbox.SYNC_OUTBOX_LAG_WARNING_MS - 1,
      );
      const pending = syncOutbox.getSyncOutboxLagDiagnostics();
      expect(pending).toMatchObject({
        status: "warning",
        lagging: true,
        pendingEvents: 2,
        warningThresholdMs: syncOutbox.SYNC_OUTBOX_LAG_WARNING_MS,
      });
      expect(JSON.stringify(pending)).not.toContain("live");
      expect(JSON.stringify(pending)).not.toContain("sandbox");
      expect(JSON.stringify(pending)).not.toContain("master-data");
      expect(JSON.stringify(pending)).not.toContain(payloadSentinel);

      stop();
      expect(syncOutbox.getSyncOutboxLagDiagnostics()).toMatchObject({
        status: "ok",
        lagging: false,
        pendingEvents: 0,
        lagMs: 0,
      });
      const stoppedDiagnostics = JSON.stringify(syncOutbox.getSyncOutboxLagDiagnostics());
      expect(stoppedDiagnostics).not.toContain("live");
      expect(stoppedDiagnostics).not.toContain("sandbox");
      expect(stoppedDiagnostics).not.toContain("master-data");
      expect(stoppedDiagnostics).not.toContain(payloadSentinel);

      releaseHandler();
      await handlerFinished;
      expect(syncOutbox.getSyncOutboxLagDiagnostics()).toMatchObject({
        status: "ok",
        lagging: false,
        pendingEvents: 0,
        lagMs: 0,
      });
    } finally {
      releaseHandler();
      stop();
      await waitForSyncOutboxListeners(0);
      syncOutbox.clearSyncOutboxProcessCursorsForTests();
      if (previousTestFlag === undefined) delete process.env.SYNC_OUTBOX_LISTENER_TEST_ENABLED;
      else process.env.SYNC_OUTBOX_LISTENER_TEST_ENABLED = previousTestFlag;
    }
  }, 20_000);

  it("keeps the aggregate delivery warning while another registered scope remains delayed", async () => {
    const syncOutbox = await import("../lib/syncOutbox");
    syncOutbox.clearSyncOutboxProcessCursorsForTests();
    await syncOutbox.registerSyncOutboxScope("live");
    await syncOutbox.registerSyncOutboxScope("sandbox");

    try {
      const payloadSentinel = "outbox-lag-private-payload";
      await syncOutbox.recordSyncOutboxEvent({
        kind: "configuration",
        scope: "live",
        senderId: payloadSentinel,
        family: "master-data",
      });
      await syncOutbox.recordSyncOutboxEvent({
        kind: "configuration",
        scope: "sandbox",
        senderId: payloadSentinel,
        family: "master-data",
      });

      const oldestPendingAt = Date.now() - syncOutbox.SYNC_OUTBOX_LAG_WARNING_MS - 1;
      syncOutbox.observeSyncOutboxLag("live", 4, oldestPendingAt);
      syncOutbox.observeSyncOutboxLag("sandbox", 1, oldestPendingAt);

      expect(syncOutbox.getSyncOutboxLagDiagnostics()).toMatchObject({
        status: "warning",
        lagging: true,
        pendingEvents: 5,
        warningThresholdMs: syncOutbox.SYNC_OUTBOX_LAG_WARNING_MS,
      });

      // The sandbox consumer catches up, but the live consumer is still behind.
      syncOutbox.observeSyncOutboxLag("sandbox", 0);
      const lag = syncOutbox.getSyncOutboxLagDiagnostics();
      expect(lag).toMatchObject({
        status: "warning",
        lagging: true,
        pendingEvents: 4,
        warningThresholdMs: syncOutbox.SYNC_OUTBOX_LAG_WARNING_MS,
      });
      expect(JSON.stringify(lag)).not.toContain("live");
      expect(JSON.stringify(lag)).not.toContain("sandbox");
      expect(JSON.stringify(lag)).not.toContain("master-data");
      expect(JSON.stringify(lag)).not.toContain(payloadSentinel);

      syncOutbox.observeSyncOutboxLag("live", 0);
      expect(syncOutbox.getSyncOutboxLagDiagnostics()).toMatchObject({
        status: "ok",
        lagging: false,
        pendingEvents: 0,
        lagMs: 0,
      });
    } finally {
      syncOutbox.clearSyncOutboxProcessCursorsForTests();
    }
  });

  it("converges edits, offline reconnects, wake recovery, stale writes, and blank protection", async () => {
    const clients = ["A", "B", "C"].map((id) => new SimulatedClient(id));
    const start = Date.now();
    const seed = clients[0];
    await seed.pull();
    seed.state = fixture();
    await seed.push();
    await seed.mutateOperational("start");
    await seed.mutateOperational(12);
    for (const client of clients.slice(1)) await client.pull();

    // Repeated deterministic edits with a sleeping peer. Each wake adopts the
    // canonical response before its queued stale write can be replayed.
    clients[1].setOnline(false);
    for (let i = 0; i < 12; i++) {
      await clients[0].mutateOperational(13 + i);
      if (i === 11) await clients[0].mutateOperational("end");
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
    const endedRun = (clients[0].state!.dayState as { runs: Array<Record<string, unknown>> }).runs[0];
    expect(endedRun.endedAt).toEqual(expect.any(Number));
    expect(stalePut?.data?.dayState).toMatchObject({
      runs: [{ id: "run-main", endedAt: endedRun.endedAt, metaUpdatedAt: endedRun.metaUpdatedAt }],
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
