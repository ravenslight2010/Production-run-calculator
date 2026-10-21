import { eq, sql } from "drizzle-orm";
import { pool, db, syncOutboxCursorsTable, syncOutboxEventsTable } from "@workspace/db";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { isManualSection, type ManualSection } from "@workspace/sync-contract";
import type { Scope } from "./requestScope";
import { logger } from "./logger";
import {
  boundedDurationMs,
  classifyBackgroundFailure,
  createBackgroundOperationBackoff,
  runBackgroundOperation,
} from "./backgroundOperations";

export type SyncOutboxEvent =
  | {
      kind: "day-state";
      scope: Scope;
      date: string;
      senderId: string;
      canonicalRevision: number;
    }
  | {
      kind: "reset";
      scope: Scope;
      resetEpoch: number;
    }
  | {
      kind: "rollover";
      scope: Scope;
      date: string;
      resetEpoch: number;
    }
  | {
      kind: "manual-section";
      scope: Scope;
      date: string;
      senderId: string;
      event: "acquired" | "released";
      runId: string;
      section: ManualSection;
      ownerId: string;
    }
  | {
      kind: "configuration";
      scope: Scope;
      senderId: string;
      family:
        | "master-data"
        | "profiles"
        | "factory-data"
        | "die-types"
        | "supervisor-pin"
        | "name-links"
        | "merged-away";
    };

export type StoredSyncOutboxEvent = SyncOutboxEvent & {
  cursor: number;
  origin: string;
  createdAt: Date;
};

type SyncOutboxTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const NOTIFY_CHANNEL = "sync_outbox";
const BATCH_SIZE = 100;
const RETENTION_DAYS = 7;
const DRAIN_INTERVAL_MS = 5_000;
const RETENTION_INTERVAL_MS = 60 * 60_000;
export const SYNC_OUTBOX_LAG_WARNING_MS = 30_000;
const SYNC_OUTBOX_LAG_MAX_MS = 7 * 24 * 60 * 60_000;
const SYNC_OUTBOX_LAG_MAX_PENDING_EVENTS = 1_000_000;
const processCursors = new Map<string, number>();
const processOrigin = randomUUID();
type SyncOutboxLagState = {
  pendingEvents: number;
  oldestPendingAt: number;
  lastObservedAt: number;
};
const syncOutboxLagByScope = new Map<string, SyncOutboxLagState>();

export type SyncOutboxLagDiagnostic = {
  status: "ok" | "warning";
  lagging: boolean;
  pendingEvents: number;
  lagMs: number;
  warningThresholdMs: number;
  lastObservedAt?: string;
};

export function clearSyncOutboxProcessCursorsForTests(): void {
  processCursors.clear();
  syncOutboxLagByScope.clear();
}

export function observeSyncOutboxLag(
  scope: string,
  pendingEvents: number,
  oldestPendingAt = Date.now(),
): void {
  const now = Date.now();
  if (pendingEvents <= 0) {
    syncOutboxLagByScope.delete(scope);
    return;
  }
  syncOutboxLagByScope.set(scope, {
    pendingEvents: Math.min(Math.max(0, Math.floor(pendingEvents)), SYNC_OUTBOX_LAG_MAX_PENDING_EVENTS),
    oldestPendingAt: Number.isFinite(oldestPendingAt) ? oldestPendingAt : now,
    lastObservedAt: now,
  });
}

export function getSyncOutboxLagDiagnostics(now = Date.now()): SyncOutboxLagDiagnostic {
  if (syncOutboxLagByScope.size === 0) {
    return {
      status: "ok",
      lagging: false,
      pendingEvents: 0,
      lagMs: 0,
      warningThresholdMs: SYNC_OUTBOX_LAG_WARNING_MS,
    };
  }
  let pendingEvents = 0;
  let oldestPendingAt = now;
  let lastObservedAt = 0;
  for (const state of syncOutboxLagByScope.values()) {
    pendingEvents = Math.min(
      SYNC_OUTBOX_LAG_MAX_PENDING_EVENTS,
      pendingEvents + state.pendingEvents,
    );
    oldestPendingAt = Math.min(oldestPendingAt, state.oldestPendingAt);
    lastObservedAt = Math.max(lastObservedAt, state.lastObservedAt);
  }
  const lagMs = Math.min(
    SYNC_OUTBOX_LAG_MAX_MS,
    Math.max(0, now - oldestPendingAt),
  );
  return {
    status: lagMs >= SYNC_OUTBOX_LAG_WARNING_MS ? "warning" : "ok",
    lagging: true,
    pendingEvents,
    lagMs,
    warningThresholdMs: SYNC_OUTBOX_LAG_WARNING_MS,
    lastObservedAt: new Date(lastObservedAt).toISOString(),
  };
}

export function isLocalSyncOutboxEvent(event: StoredSyncOutboxEvent): boolean {
  return event.origin === processOrigin;
}

function assertBoundedEvent(event: SyncOutboxEvent): void {
  if (!event.scope || event.scope.length > 160) throw new Error("Invalid sync outbox scope");
  if (event.kind === "day-state" || event.kind === "rollover") {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(event.date)) throw new Error("Invalid sync outbox date");
  }
  if ("senderId" in event && event.senderId.length > 160) {
    throw new Error("Invalid sync outbox sender");
  }
  if (event.kind === "manual-section"
    && (event.runId.length > 160 || event.ownerId.length > 160 || event.section.length > 32)) {
    throw new Error("Invalid manual-section outbox event");
  }
  if (event.kind === "configuration" && event.family.length > 32) {
    throw new Error("Invalid configuration outbox event");
  }
  const payloadBytes = Buffer.byteLength(JSON.stringify(event));
  if (payloadBytes > 2_048) throw new Error("Sync outbox event exceeds the payload limit");
}

/**
 * Add one bounded wake-up record inside the same transaction as its canonical
 * write. The per-scope row lock prevents cursor allocation from getting ahead
 * of commit order. PostgreSQL delivers NOTIFY only after this transaction
 * commits, and listeners still use the table as their source of truth.
 */
export async function appendSyncOutboxEvent(
  tx: SyncOutboxTransaction,
  event: SyncOutboxEvent,
  origin = processOrigin,
): Promise<number> {
  assertBoundedEvent(event);
  await tx.insert(syncOutboxCursorsTable)
    .values({ scope: event.scope, cursor: 0 })
    .onConflictDoNothing();
  const [current] = await tx.select().from(syncOutboxCursorsTable)
    .where(eq(syncOutboxCursorsTable.scope, event.scope))
    .for("update");
  if (!current) throw new Error("Sync outbox cursor row was not created");
  const cursor = current.cursor + 1;
  await tx.update(syncOutboxCursorsTable)
    .set({ cursor, updatedAt: new Date() })
    .where(eq(syncOutboxCursorsTable.scope, event.scope));
  const { kind, scope, ...payload } = event;
  await tx.insert(syncOutboxEventsTable).values({
    scope,
    cursor,
    kind,
    date: "date" in event ? event.date : null,
    senderId: "senderId" in event ? event.senderId : "",
    payload: { ...payload, origin } as Record<string, unknown>,
  });
  const wake = JSON.stringify({ scope, cursor });
  await tx.execute(sql`SELECT pg_notify(${NOTIFY_CHANNEL}, ${wake})`);
  return cursor;
}

export async function recordSyncOutboxEvent(event: SyncOutboxEvent): Promise<number> {
  return db.transaction((tx) => appendSyncOutboxEvent(tx, event));
}

/** Register the live stream's scope before its canonical baseline is read. */
export async function registerSyncOutboxScope(scope: Scope): Promise<void> {
  if (processCursors.has(scope)) return;
  const [row] = await db.select({ cursor: syncOutboxCursorsTable.cursor })
    .from(syncOutboxCursorsTable)
    .where(eq(syncOutboxCursorsTable.scope, scope));
  processCursors.set(scope, row?.cursor ?? 0);
}

function parseEvent(row: {
  scope: string;
  cursor: number;
  kind: string;
  date: string | null;
  sender_id: string;
  payload: unknown;
  created_at: Date;
}): StoredSyncOutboxEvent | null {
  const payload = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
    ? row.payload as Record<string, unknown>
    : {};
  const origin = typeof payload.origin === "string" ? payload.origin : "";
  const common = { scope: row.scope as Scope, cursor: Number(row.cursor), origin, createdAt: row.created_at };
  if (!Number.isSafeInteger(common.cursor) || common.cursor <= 0) return null;
  if (row.kind === "day-state" && row.date
    && typeof payload.canonicalRevision === "number"
    && Number.isSafeInteger(payload.canonicalRevision)
    && payload.canonicalRevision >= 0) {
    return {
      ...common, kind: "day-state", date: row.date,
      senderId: row.sender_id, canonicalRevision: payload.canonicalRevision,
    };
  }
  if (row.kind === "reset" && typeof payload.resetEpoch === "number"
    && Number.isSafeInteger(payload.resetEpoch) && payload.resetEpoch >= 0) {
    return { ...common, kind: "reset", resetEpoch: payload.resetEpoch };
  }
  if (row.kind === "rollover" && row.date && typeof payload.resetEpoch === "number"
    && Number.isSafeInteger(payload.resetEpoch) && payload.resetEpoch >= 0) {
    return { ...common, kind: "rollover", date: row.date, resetEpoch: payload.resetEpoch };
  }
  if (row.kind === "manual-section"
    && row.date
    && (payload.event === "acquired" || payload.event === "released")
    && typeof payload.runId === "string"
    && payload.runId.length <= 160
    && typeof payload.section === "string"
    && isManualSection(payload.section)
    && typeof payload.ownerId === "string") {
    return {
      ...common,
      kind: "manual-section",
      date: row.date,
      senderId: row.sender_id,
      event: payload.event,
      runId: payload.runId,
      section: payload.section,
      ownerId: payload.ownerId,
    };
  }
  const configurationFamilies = [
    "master-data",
    "profiles",
    "factory-data",
    "die-types",
    "supervisor-pin",
    "name-links",
    "merged-away",
  ] as const;
  if (row.kind === "configuration"
    && configurationFamilies.includes(payload.family as (typeof configurationFamilies)[number])) {
    return {
      ...common,
      kind: "configuration",
      senderId: row.sender_id,
      family: payload.family as (typeof configurationFamilies)[number],
    };
  }
  return null;
}

type EventHandler = (event: StoredSyncOutboxEvent) => Promise<void>;
type GapHandler = (scope: Scope, latestCursor: number) => Promise<void>;

/**
 * One listener connection per API process. LISTEN is only a wake-up path:
 * polling and reconnect catch-up always read ordered durable rows.
 */
export function startSyncOutboxListener(
  handleEvent: EventHandler,
  handleGap: GapHandler,
): () => void {
  let stopped = false;
  let listener: PoolClient | undefined;
  let notificationHandler: ((message: { channel?: string }) => void) | undefined;
  let errorHandler: ((error: Error) => void) | undefined;
  let retryTimer: NodeJS.Timeout | undefined;
  let drainTimer: NodeJS.Timeout | undefined;
  let retentionTimer: NodeJS.Timeout | undefined;
  let draining = false;
  let drainRequested = false;
  let retryDelayMs = 500;
  const drainBackoff = createBackgroundOperationBackoff({ jitter: true });
  const cursors = processCursors;
  const observeListenerLag = (
    scope: string,
    pendingEvents: number,
    oldestPendingAt?: number,
  ) => {
    if (stopped) return;
    observeSyncOutboxLag(scope, pendingEvents, oldestPendingAt);
  };

  const scheduleDrain = () => {
    if (stopped) return;
    drainRequested = true;
    if (draining || drainTimer) return;
    const delay = Math.max(0, (drainBackoff.nextRetryAt() ?? Date.now()) - Date.now());
    drainTimer = setTimeout(() => {
      drainTimer = undefined;
      void drainAll();
    }, delay);
    drainTimer.unref();
  };

  async function drainScope(scope: string): Promise<void> {
    let cursor = cursors.get(scope) ?? 0;
    for (;;) {
      const stateResult = await pool.query<{ cursor: string | number }>(
        "SELECT cursor FROM sync_outbox_cursors WHERE scope = $1",
        [scope],
      );
      const latest = Number(stateResult.rows[0]?.cursor ?? 0);
      if (!Number.isSafeInteger(latest) || latest < cursor) {
        throw new Error("Invalid sync outbox cursor state");
      }
      if (latest === cursor) {
        observeListenerLag(scope, 0);
        return;
      }

      const result = await pool.query<{
        scope: string;
        cursor: string | number;
        kind: string;
        date: string | null;
        sender_id: string;
        payload: unknown;
        created_at: Date;
      }>(
        `SELECT scope, cursor, kind, date, sender_id, payload, created_at
         FROM sync_outbox_events
         WHERE scope = $1 AND cursor > $2
         ORDER BY cursor ASC
         LIMIT $3`,
        [scope, cursor, BATCH_SIZE],
      );
      const rows = result.rows;
      const firstCursor = Number(rows[0]?.cursor);
      if (rows.length === 0 || firstCursor !== cursor + 1) {
        // Retention passed this process's cursor. Reconcile canonical state
        // before moving forward; never silently jump over a missing interval.
        observeListenerLag(scope, latest - cursor);
        await handleGap(scope as Scope, latest);
        cursors.set(scope, latest);
        observeListenerLag(scope, 0);
        return;
      }

      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex]!;
        const eventCursor = Number(row.cursor);
        if (eventCursor !== cursor + 1) {
          observeListenerLag(scope, latest - cursor, new Date(row.created_at).getTime());
          await handleGap(scope as Scope, latest);
          cursors.set(scope, latest);
          observeListenerLag(scope, 0);
          return;
        }
        observeListenerLag(scope, latest - cursor, new Date(row.created_at).getTime());
        const event = parseEvent({ ...row, cursor: eventCursor });
        if (event) {
          await handleEvent(event);
        } else {
          // A malformed historical row is not allowed to block all later
          // events. Reconcile first, then advance past the unusable row.
          await handleGap(scope as Scope, latest);
        }
        cursor = eventCursor;
        cursors.set(scope, cursor);
      }
      if (cursor >= latest) {
        observeListenerLag(scope, 0);
        return;
      }
    }
  }

  async function drainAll(): Promise<void> {
    if (stopped || draining) return;
    drainRequested = false;
    draining = true;
    const startedAt = performance.now();
    let failureStage: "scope-list" | "cursor-seed" | "scope-drain" = "scope-list";
    try {
      await runBackgroundOperation("sync-outbox-drain", async () => {
        failureStage = "scope-list";
        const result = await pool.query<{ scope: string }>(
          "SELECT scope FROM sync_outbox_cursors ORDER BY scope ASC",
        );
        for (const { scope } of result.rows) {
          if (stopped) return;
          if (!cursors.has(scope)) {
            // A process starts with no connected SSE clients. Seed the cursor for
            // pre-existing scopes; new scopes first encountered later start at 0.
            failureStage = "cursor-seed";
            const current = await pool.query<{ cursor: string | number }>(
              "SELECT cursor FROM sync_outbox_cursors WHERE scope = $1",
              [scope],
            );
            cursors.set(scope, Number(current.rows[0]?.cursor ?? 0));
            continue;
          }
          failureStage = "scope-drain";
          await drainScope(scope);
        }
      });
      drainBackoff.recordSuccess();
    } catch (error) {
      drainBackoff.recordFailure();
      drainRequested = true;
      logger.warn({
        event: "sync_outbox_drain",
        outcome: "retry",
        failureReason: syncOutboxFailureReason(error),
        failureStage,
        durationMs: boundedDurationMs(performance.now() - startedAt),
      }, "Sync outbox drain failed; cursor retained for retry");
    } finally {
      draining = false;
      // A NOTIFY arriving during an active pass must survive that pass.
      // Failed delivery likewise schedules its own bounded backoff retry.
      if (drainRequested) scheduleDrain();
    }
  }

  const disconnect = (client: PoolClient, error?: Error) => {
    if (listener !== client) return;
    listener = undefined;
    if (notificationHandler) client.removeListener("notification", notificationHandler);
    if (errorHandler) client.removeListener("error", errorHandler);
    notificationHandler = undefined;
    errorHandler = undefined;
    try { client.release(error); } catch {}
    if (!stopped) scheduleReconnect();
  };

  const scheduleReconnect = () => {
    if (stopped || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      void connect();
    }, retryDelayMs);
    retryTimer.unref();
    retryDelayMs = Math.min(retryDelayMs * 2, 30_000);
  };

  async function connect(): Promise<void> {
    if (stopped || listener) return;
    let client: PoolClient | undefined;
    try {
      client = await pool.connect();
      if (stopped) {
        client.release();
        return;
      }
      listener = client;
      notificationHandler = (message) => {
        if (message.channel !== NOTIFY_CHANNEL) return;
        // Payload is a bounded wake-up hint, never event data.
        scheduleDrain();
      };
      errorHandler = (error) => disconnect(client!, error);
      client.on("notification", notificationHandler);
      client.on("error", errorHandler);
      await client.query(`LISTEN ${NOTIFY_CHANNEL}`);
      retryDelayMs = 500;
      const knownScopes = await pool.query<{ scope: string; cursor: string | number }>(
        "SELECT scope, cursor FROM sync_outbox_cursors ORDER BY scope ASC",
      );
      for (const row of knownScopes.rows) {
        if (!cursors.has(row.scope)) cursors.set(row.scope, Number(row.cursor));
      }
      await drainAll();
      logger.info({ event: "sync_outbox_listener", outcome: "connected" }, "Sync outbox listener connected");
    } catch {
      if (client) {
        if (listener === client) listener = undefined;
        try { client.release(true); } catch {}
      }
      if (!stopped) {
        logger.warn({ event: "sync_outbox_listener", outcome: "retry" }, "Sync outbox listener disconnected; durable catch-up will retry");
        scheduleReconnect();
      }
    }
  }

  if (process.env.NODE_ENV !== "test" || process.env.SYNC_OUTBOX_LISTENER_TEST_ENABLED === "1") {
    void connect();
    const poll = setInterval(scheduleDrain, DRAIN_INTERVAL_MS);
    poll.unref();
    retentionTimer = setInterval(() => {
      void pool.query(
        `DELETE FROM sync_outbox_events
         WHERE created_at < NOW() - ($1::text || ' days')::interval`,
        [String(RETENTION_DAYS)],
      ).catch(() => {
        logger.warn({ event: "sync_outbox_retention", outcome: "degraded" }, "Sync outbox retention cleanup failed");
      });
    }, RETENTION_INTERVAL_MS);
    retentionTimer.unref();
  }

  return () => {
    stopped = true;
    syncOutboxLagByScope.clear();
    if (retryTimer) clearTimeout(retryTimer);
    if (drainTimer) clearTimeout(drainTimer);
    if (retentionTimer) clearInterval(retentionTimer);
    if (listener) {
      const client = listener;
      listener = undefined;
      if (notificationHandler) client.removeListener("notification", notificationHandler);
      if (errorHandler) client.removeListener("error", errorHandler);
      notificationHandler = undefined;
      errorHandler = undefined;
      void client.query(`UNLISTEN ${NOTIFY_CHANNEL}`)
        .then(() => client.release())
        .catch((error: Error) => client.release(error));
    }
    listener = undefined;
  };
}

/** Fixed cardinality only: never expose messages, SQL, or arbitrary codes. */
export function syncOutboxFailureReason(error: unknown): string {
  const reason = classifyBackgroundFailure(error, { assumeDatabase: true });
  return reason === "unexpected" ? "delivery-failed" : reason;
}
