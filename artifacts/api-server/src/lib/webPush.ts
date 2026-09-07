import { createHash, randomUUID } from "node:crypto";
import webpush from "web-push";
import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import {
  db, usersTable, webPushDeliveriesTable, webPushSubscriptionsTable, webPushAlertArmsTable,
  dailySyncTable, scheduledAlertRecordsTable,
} from "@workspace/db";
import { computeServerCalc } from "@workspace/live-calc";
import { logger } from "./logger";
import type { Scope } from "./requestScope";
import { getUserCapabilities } from "./roles";
import { computeAutoTrackElapsedMs } from "@workspace/live-calc";
import { enqueueServerJob, registerServerJob } from "./serverJobs";

export const WEB_PUSH_KINDS = ["fifteenMin", "batchDue", "warehouseStaging", "runComplete", "freezerEmpty"] as const;
export type WebPushKind = (typeof WEB_PUSH_KINDS)[number];
const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_ENDPOINT = 2048;
const SCHEDULED_EVALUATION_ACTOR = "system:scheduled-alert-scheduler";
const DEFAULT_ALERT_INTERVAL_MS = 60_000;

export function vapidPublicKey(): string | null {
  const key = process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  return key && key.length <= 512 ? key : null;
}

function configuredSender(): boolean {
  const publicKey = vapidPublicKey();
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  try {
    // Never log VAPID material. A contact is required by the web-push protocol.
    webpush.setVapidDetails(process.env.WEB_PUSH_VAPID_SUBJECT || "mailto:operations@example.invalid", publicKey, privateKey);
    return true;
  } catch {
    logger.error({ event: "web_push_configuration", outcome: "invalid" }, "Web push configuration is invalid");
    return false;
  }
}

export function validSubscription(input: unknown): input is { endpoint: string; keys: { p256dh: string; auth: string }; expirationTime?: number | null } {
  if (!input || typeof input !== "object") return false;
  const s = input as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown }; expirationTime?: unknown };
  return typeof s.endpoint === "string" && s.endpoint.startsWith("https://") && s.endpoint.length <= MAX_ENDPOINT
    && typeof s.keys?.p256dh === "string" && s.keys.p256dh.length > 15 && s.keys.p256dh.length <= 512
    && typeof s.keys?.auth === "string" && s.keys.auth.length > 7 && s.keys.auth.length <= 256
    && (s.expirationTime == null || (typeof s.expirationTime === "number" && Number.isFinite(s.expirationTime)));
}

type Candidate = {
  id: string;
  kind: WebPushKind;
  /** Deterministic milestone time; devices opted in later never get stale work. */
  dueAt?: number;
  /** Crossing-based alert kinds require a durable pre-threshold arm. */
  armKey?: string;
};
type SyncData = { dayState?: { runs?: Array<Record<string, unknown>>; currentIndex?: number }; runValues?: Record<string, Record<string, unknown>>; packagingProgress?: Record<string, { skidsCompleted: number; casesOnCurrentSkid: number }> };
const number = (v: unknown): number => typeof v === "number" && Number.isFinite(v) ? v : 0;
function runKey(runId: string, generation = 0): string {
  // Starting the same scheduled id after a reset is a new run generation.
  return createHash("sha256").update(`${runId}:${generation}`).digest("hex").slice(0, 24);
}

// This operates only on the server's canonical daily_sync blob. A paused run
// cannot emit timing alerts; reset/new run ids yield new stable alert ids.
export function alertCandidates(data: unknown, date: string, nowMs = Date.now()): Candidate[] {
  const p = data as SyncData;
  const run = p?.dayState?.runs?.[p.dayState.currentIndex ?? 0];
  if (!run || typeof run.id !== "string") return [];
  const id = run.id;
  const v = p.runValues?.[id];
  if (!v) return [];
  const started = number(run.startedAt), paused = number(run.pausedAt), ended = number(run.endedAt);
  // Do not put client-controlled run ids (which can contain operational
  // labels) in the push payload. The digest is stable but fixed-size.
  const prefix = `${date}:${runKey(id, started || number(run.metaUpdatedAt))}`;
  const out: Candidate[] = [];
  if (ended > 0) return out;
  if (!started || paused) return out;
  let result: ReturnType<typeof computeServerCalc>;
  try { result = computeServerCalc(p as Parameters<typeof computeServerCalc>[0], [], nowMs); } catch { return out; }
  if (!result?.calc || result.runId !== id || result.calc.ppm <= 0) return out;
  const calc = result.calc;
  if (calc.adjustedTimeSec > 0 && calc.adjustedTimeSec <= 900) out.push({ id: `${prefix}:fifteen-min`, kind: "fifteenMin" });
  if (calc.adjustedTimeSec <= 0 && nowMs - started >= 60_000) out.push({ id: `${prefix}:run-complete`, kind: "runComplete" });
  if (!calc.pressDone && calc.timePerBatchSec > 0) {
    // Shared auto-track timing excludes pauses/closed stoppages and therefore
    // keeps a batch boundary from becoming due while the line is stopped.
    const elapsed = computeAutoTrackElapsedMs({ startedAt: started, pausedAt: paused || undefined, nowMs, stoppages: Array.isArray(run.stoppages) ? run.stoppages as never : undefined });
    const batch = Math.floor(elapsed / 1000 / calc.timePerBatchSec);
    if (batch >= 1) out.push({ id: `${prefix}:batch:${batch}`, kind: "batchDue" });
  }
  const skid = number(v.casesPerSkid), needed = number(v.casesNeeded);
  if (skid > 0 && needed > 0 && calc.pressCasesLeft > 0) {
    if (calc.pressCasesLeft <= 2 * skid) out.push({ id: `${prefix}:warehouse:frontline`, kind: "warehouseStaging" });
    if (calc.pressCasesLeft <= skid) out.push({ id: `${prefix}:warehouse:packaging`, kind: "warehouseStaging" });
  }
  return out;
}

export function freezerCandidates(data: unknown, date: string, nowMs: number): Candidate[] {
  const p = data as SyncData;
  const runs = p?.dayState?.runs ?? [];
  const result: Candidate[] = [];
  for (const run of runs) {
    if (typeof run.id !== "string" || !number(run.endedAt)) continue;
    const freezerMs = number(p.runValues?.[run.id]?.freezerTime) * 60_000;
    if (freezerMs > 0 && nowMs >= number(run.endedAt) + freezerMs) {
      const key = runKey(run.id, number(run.startedAt) || number(run.endedAt));
      result.push({
        id: `${date}:${key}:freezer-empty`,
        kind: "freezerEmpty",
        dueAt: number(run.endedAt) + freezerMs,
        armKey: key,
      });
    }
  }
  return result;
}

export function pendingFreezerArms(data: unknown, nowMs: number): string[] {
  const p = data as SyncData;
  const result: string[] = [];
  for (const run of p?.dayState?.runs ?? []) {
    if (typeof run.id !== "string" || !number(run.endedAt)) continue;
    const freezerMs = number(p.runValues?.[run.id]?.freezerTime) * 60_000;
    if (freezerMs > 0 && nowMs < number(run.endedAt) + freezerMs) {
      result.push(runKey(run.id, number(run.startedAt) || number(run.endedAt)));
    }
  }
  return result;
}

function fifteenArm(data: unknown, nowMs: number): string | null {
  const p = data as SyncData;
  const run = p?.dayState?.runs?.[p.dayState.currentIndex ?? 0];
  if (!run || typeof run.id !== "string" || !number(run.startedAt) || number(run.pausedAt) || number(run.endedAt)) return null;
  try {
    const calc = computeServerCalc(p as Parameters<typeof computeServerCalc>[0], [], nowMs)?.calc;
    return calc && calc.ppm > 0 && calc.adjustedTimeSec > 900 ? runKey(run.id, number(run.startedAt) || number(run.metaUpdatedAt)) : null;
  } catch { return null; }
}

type DeliveryStatus = "no-subscriptions" | "vapid-unconfigured" | "delivered" | "failed";
const DEFERRED_DELIVERY_CLAIM_MS = 90_000;

async function deliver(scope: Scope, candidate: Candidate, nowMs: number, signal?: AbortSignal): Promise<DeliveryStatus> {
  const rows = await db.select({
    id: webPushSubscriptionsTable.id, userId: webPushSubscriptionsTable.userId, endpoint: webPushSubscriptionsTable.endpoint, p256dh: webPushSubscriptionsTable.p256dh,
    auth: webPushSubscriptionsTable.auth, contentEncoding: webPushSubscriptionsTable.contentEncoding,
    createdAt: webPushSubscriptionsTable.createdAt,
    notificationPrefs: usersTable.notificationPrefs,
  }).from(webPushSubscriptionsTable)
    .innerJoin(usersTable, eq(usersTable.id, webPushSubscriptionsTable.userId))
    .where(and(
      eq(webPushSubscriptionsTable.scope, scope),
      eq(webPushSubscriptionsTable.enabled, true),
      // Enforce declared endpoint expiry before claiming or attempting delivery;
      // cleanup below is retention housekeeping, not the authorization boundary.
      or(
        isNull(webPushSubscriptionsTable.expiresAt),
        gt(webPushSubscriptionsTable.expiresAt, new Date(nowMs)),
      ),
    ));
  if (!rows.length) return "no-subscriptions";
  const sendable = configuredSender();
  let claimed = 0;
  let delivered = 0;
  let failed = 0;
  const capabilities = new Map<string, boolean>();
  for (const s of rows) {
    if (signal?.aborted) throw new Error("Scheduled alert evaluation cancelled");
    if (candidate.dueAt && s.createdAt.getTime() > candidate.dueAt) continue;
    // A missing preference means enabled, matching /me/notification-prefs.
    if (s.notificationPrefs?.[candidate.kind] === false) continue;
    // Warehouse staging is an inventory/warehouse responsibility. Other
    // generic production timing alerts intentionally remain available to every
    // opted-in authenticated production role.
    if (candidate.kind === "warehouseStaging") {
      let allowed = capabilities.get(s.userId);
      if (allowed === undefined) {
        allowed = (await getUserCapabilities(s.userId)).includes("manage-inventory");
        capabilities.set(s.userId, allowed);
      }
      if (!allowed) continue;
    }
    const [claim] = await db.insert(webPushDeliveriesTable).values({
      id: randomUUID(), scope, alertId: candidate.id, alertKind: candidate.kind, subscriptionId: s.id,
      expiresAt: new Date(Date.now() + RETENTION_MS),
    }).onConflictDoNothing().returning({ id: webPushDeliveriesTable.id });
    if (!claim) continue;
    claimed++;
    if (!sendable) {
      await db.update(webPushDeliveriesTable).set({ status: "skipped", lastErrorCode: "vapid_not_configured", attempts: 1 })
        .where(eq(webPushDeliveriesTable.id, claim.id));
      continue;
    }
    try {
      // Intentionally generic: no recipe, customer, run label, or inventory data.
      const payload = JSON.stringify({ id: candidate.id.slice(0, 96), kind: candidate.kind, title: "Production alert", body: "A production timing alert needs attention." });
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 300, urgency: "high" });
      await db.update(webPushDeliveriesTable).set({ status: "delivered", attempts: 1, deliveredAt: new Date() }).where(eq(webPushDeliveriesTable.id, claim.id));
      delivered++;
    } catch (error) {
      const statusCode = typeof error === "object" && error ? Number((error as { statusCode?: unknown }).statusCode) : 0;
      await db.update(webPushDeliveriesTable).set({ status: "failed", attempts: 1, lastErrorCode: statusCode ? `http_${statusCode}` : "send_failed" }).where(eq(webPushDeliveriesTable.id, claim.id));
      failed++;
      if (statusCode === 404 || statusCode === 410) await db.update(webPushSubscriptionsTable).set({ enabled: false, updatedAt: new Date() }).where(eq(webPushSubscriptionsTable.id, s.id));
      logger.warn({ event: "web_push_delivery", outcome: "failed", safeCounts: { statusCode, alertKind: candidate.kind.length } }, "Web push delivery failed");
    }
  }
  if (!claimed) return "no-subscriptions";
  if (!sendable) return "vapid-unconfigured";
  return delivered ? "delivered" : failed ? "failed" : "no-subscriptions";
}

export function deferredCandidate(record: {
  alertId: string; alertKind: string; dueAt: Date | null;
}): Candidate | null {
  if (!(WEB_PUSH_KINDS as readonly string[]).includes(record.alertKind)) return null;
  return {
    id: record.alertId,
    kind: record.alertKind as WebPushKind,
    dueAt: record.dueAt?.getTime(),
  };
}

/**
 * Deferred logical records are claimed separately from their original insert.
 * A short expiry on the claim makes a process crash recoverable; delivery's
 * own insert-winner table remains the final per-device duplicate fence.
 */
async function deliverDeferredAlerts(scope: Scope, date: string, nowMs: number, signal?: AbortSignal): Promise<void> {
  const records = await db.select({
    id: scheduledAlertRecordsTable.id,
    alertId: scheduledAlertRecordsTable.alertId,
    alertKind: scheduledAlertRecordsTable.alertKind,
    dueAt: scheduledAlertRecordsTable.dueAt,
  }).from(scheduledAlertRecordsTable).where(and(
    eq(scheduledAlertRecordsTable.scope, scope),
    eq(scheduledAlertRecordsTable.date, date),
    or(
      eq(scheduledAlertRecordsTable.status, "deferred"),
      and(
        eq(scheduledAlertRecordsTable.status, "delivering"),
        lt(scheduledAlertRecordsTable.evaluatedAt, new Date(nowMs - DEFERRED_DELIVERY_CLAIM_MS)),
      ),
    ),
  ));
  for (const record of records) {
    if (signal?.aborted) throw new Error("Scheduled alert evaluation cancelled");
    const candidate = deferredCandidate(record);
    if (!candidate) continue;
    const [claim] = await db.update(scheduledAlertRecordsTable).set({
      status: "delivering",
      evaluatedAt: new Date(nowMs),
    }).where(and(
      eq(scheduledAlertRecordsTable.id, record.id),
      eq(scheduledAlertRecordsTable.scope, scope),
      or(
        eq(scheduledAlertRecordsTable.status, "deferred"),
        and(
          eq(scheduledAlertRecordsTable.status, "delivering"),
          lt(scheduledAlertRecordsTable.evaluatedAt, new Date(nowMs - DEFERRED_DELIVERY_CLAIM_MS)),
        ),
      ),
    )).returning({ id: scheduledAlertRecordsTable.id });
    if (!claim) continue;
    const status = await deliver(scope, candidate, nowMs, signal);
    await db.update(scheduledAlertRecordsTable)
      .set({ status, ...(status === "delivered" ? { deliveredAt: new Date(nowMs) } : {}) })
      .where(eq(scheduledAlertRecordsTable.id, record.id));
  }
}

export async function runWebPushAlerts(
  nowMs = Date.now(),
  target?: { scope: Scope; date: string; signal?: AbortSignal },
): Promise<{ examined: number; candidates: number }> {
  const query = db.select().from(dailySyncTable);
  const rows = target
    ? await query.where(and(eq(dailySyncTable.scope, target.scope), eq(dailySyncTable.date, target.date)))
    : await query;
  let candidates = 0;
  for (const row of rows) {
    if (target?.signal?.aborted) throw new Error("Scheduled alert evaluation cancelled");
    // A quiet-time record is durable evidence, not a terminal suppression.
    // Once eligible, exactly one evaluator transitions it to delivering.
    if (!quietHours(nowMs)) await deliverDeferredAlerts(row.scope as Scope, row.date, nowMs, target?.signal);
    const arm = fifteenArm(row.data, nowMs);
    if (arm) await db.insert(webPushAlertArmsTable).values({
      scope: row.scope, runKey: arm, alertKind: "fifteenMin", expiresAt: new Date(nowMs + RETENTION_MS),
    }).onConflictDoNothing();
    for (const freezerArm of pendingFreezerArms(row.data, nowMs)) {
      await db.insert(webPushAlertArmsTable).values({
        scope: row.scope,
        runKey: freezerArm,
        alertKind: "freezerEmpty",
        expiresAt: new Date(nowMs + RETENTION_MS),
      }).onConflictDoNothing();
    }
    const found = [...alertCandidates(row.data, row.date, nowMs), ...freezerCandidates(row.data, row.date, nowMs)];
    // A low countdown is actionable only after a previous canonical observation
    // armed it. The arm is durable across worker/API instances and restarts.
    const filtered: Candidate[] = [];
    for (const candidate of found) {
      if (candidate.kind === "freezerEmpty") {
        if (!candidate.armKey) continue;
        const [armed] = await db.select({ runKey: webPushAlertArmsTable.runKey })
          .from(webPushAlertArmsTable)
          .where(and(
            eq(webPushAlertArmsTable.scope, row.scope),
            eq(webPushAlertArmsTable.runKey, candidate.armKey),
            eq(webPushAlertArmsTable.alertKind, "freezerEmpty"),
          ));
        if (armed) filtered.push(candidate);
        continue;
      }
      if (candidate.kind !== "fifteenMin") { filtered.push(candidate); continue; }
      const run = (row.data as SyncData).dayState?.runs?.[(row.data as SyncData).dayState?.currentIndex ?? 0];
      if (!run || typeof run.id !== "string") continue;
      const [armed] = await db.select({ runKey: webPushAlertArmsTable.runKey }).from(webPushAlertArmsTable)
        .where(and(eq(webPushAlertArmsTable.scope, row.scope), eq(webPushAlertArmsTable.runKey, runKey(run.id, number(run.startedAt) || number(run.metaUpdatedAt))), eq(webPushAlertArmsTable.alertKind, "fifteenMin")));
      if (armed) filtered.push(candidate);
    }
    candidates += filtered.length;
    for (const candidate of filtered) {
      if (target?.signal?.aborted) throw new Error("Scheduled alert evaluation cancelled");
      // The logical record is claimed before notification delivery. Unlike the
      // per-subscription table this remains useful when nobody is subscribed,
      // and gives operators durable evidence of scheduled evaluation.
      const [record] = await db.insert(scheduledAlertRecordsTable).values({
        id: randomUUID(),
        scope: row.scope,
        alertId: candidate.id,
        alertKind: candidate.kind,
        date: row.date,
        dueAt: candidate.dueAt ? new Date(candidate.dueAt) : null,
        expiresAt: new Date(nowMs + RETENTION_MS),
      }).onConflictDoNothing().returning({ id: scheduledAlertRecordsTable.id });
      // This insert is the cross-instance logical alert claim. Only its winner
      // may evaluate/deliver; a concurrent/restarted scheduler cannot turn one
      // canonical milestone into duplicate notification attempts.
      if (!record) continue;
      if (quietHours(nowMs)) {
        // Quiet hours defer disruptive delivery rather than permanently losing
        // it to the logical alert unique key.
        await db.update(scheduledAlertRecordsTable)
          .set({ status: "deferred" })
          .where(eq(scheduledAlertRecordsTable.id, record.id));
        continue;
      }
      const status = await deliver(row.scope as Scope, candidate, nowMs, target?.signal);
      await db.update(scheduledAlertRecordsTable)
        .set({ status, ...(status === "delivered" ? { deliveredAt: new Date(nowMs) } : {}) })
        .where(eq(scheduledAlertRecordsTable.id, record.id));
    }
  }
  const cutoff = new Date(nowMs);
  await Promise.all([
    db.delete(webPushDeliveriesTable).where(lt(webPushDeliveriesTable.expiresAt, cutoff)),
    db.delete(webPushAlertArmsTable).where(lt(webPushAlertArmsTable.expiresAt, cutoff)),
    db.delete(scheduledAlertRecordsTable).where(lt(scheduledAlertRecordsTable.expiresAt, cutoff)),
    db.delete(webPushSubscriptionsTable).where(and(
      eq(webPushSubscriptionsTable.enabled, true),
      lt(webPushSubscriptionsTable.expiresAt, cutoff),
    )),
    db.delete(webPushSubscriptionsTable).where(and(eq(webPushSubscriptionsTable.enabled, false), lt(webPushSubscriptionsTable.updatedAt, new Date(nowMs - RETENTION_MS)))),
  ]);
  return { examined: rows.length, candidates };
}

/**
 * Optional UTC quiet period, e.g. WEB_PUSH_QUIET_HOURS=22-06. Evaluation and
 * durable recording continue during quiet time; only external delivery waits.
 * UTC is deliberate: server scheduling has no trustworthy browser timezone.
 */
function quietHours(nowMs: number): boolean {
  const match = /^([01]?\d|2[0-3])-([01]?\d|2[0-3])$/.exec(process.env.WEB_PUSH_QUIET_HOURS ?? "");
  if (!match || match[1] === match[2]) return false;
  const start = Number(match[1]), end = Number(match[2]), hour = new Date(nowMs).getUTCHours();
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export function scheduledEvaluationIdempotencyKey(date: string, nowMs: number, bucketMs = DEFAULT_ALERT_INTERVAL_MS): string {
  const bucket = Math.floor(nowMs / bucketMs) * bucketMs;
  return `scheduled-evaluation:${date}:${bucket}`;
}

/**
 * Enqueues one durable workload per canonical scope/date/time bucket. The
 * server_jobs unique key elects the insert winner across API instances; actual
 * evaluation is performed only by the shared bounded ServerJobWorker.
 */
export async function enqueueScheduledWebPushAlerts(
  nowMs = Date.now(),
  bucketMs = DEFAULT_ALERT_INTERVAL_MS,
): Promise<{ examined: number; enqueued: number }> {
  const rows = await db.select({ scope: dailySyncTable.scope, date: dailySyncTable.date }).from(dailySyncTable);
  let enqueued = 0;
  for (const row of rows) {
    const result = await enqueueServerJob({
      scope: row.scope as Scope,
      actorId: SCHEDULED_EVALUATION_ACTOR,
      type: "scheduled-evaluation",
      idempotencyKey: scheduledEvaluationIdempotencyKey(row.date, nowMs, bucketMs),
      input: { date: row.date, scheduledFor: nowMs },
    });
    if (result.created) enqueued++;
  }
  return { examined: rows.length, enqueued };
}

registerServerJob("scheduled-evaluation", {
  capability: "review-incidents",
  maxAttempts: 3,
  timeoutMs: 60_000,
  handler: async (context) => {
    const input = context.job.input as { date?: unknown; scheduledFor?: unknown };
    if (typeof input?.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)
      || typeof input.scheduledFor !== "number" || !Number.isFinite(input.scheduledFor)) {
      throw new Error("scheduled-evaluation requires a date and scheduledFor timestamp");
    }
    if (await context.isCancellationRequested()) throw new Error("Cancelled");
    await context.reportProgress(10, "Evaluating scheduled production alerts");
    // Evaluate at execution time rather than the enqueue timestamp so a queued
    // job cannot emit an alert before its canonical milestone is actually due.
    const result = await runWebPushAlerts(Date.now(), {
      scope: context.job.scope as Scope,
      date: input.date,
      signal: context.signal,
    });
    if (await context.isCancellationRequested()) throw new Error("Cancelled");
    await context.reportProgress(100, "Scheduled production alerts evaluated");
    return result;
  },
});

export type WebPushAlertScheduler = { stop(): void };

export function startWebPushAlertScheduler(): WebPushAlertScheduler {
  const interval = Math.max(30_000, Number(process.env.WEB_PUSH_ALERT_INTERVAL_MS) || DEFAULT_ALERT_INTERVAL_MS);
  let stopped = false;
  let scheduling = false;
  const execute = () => {
    if (stopped || scheduling) return;
    scheduling = true;
    void enqueueScheduledWebPushAlerts(Date.now(), interval)
      .catch(() => logger.error({ event: "web_push_alert_scheduler", outcome: "failed" }, "Web push alert scheduling failed"))
      .finally(() => { scheduling = false; });
  };
  // Enqueue promptly after startup and recurringly without a foreground
  // browser. This timer is only a producer, never a second execution loop.
  const first = setTimeout(execute, 0);
  first.unref();
  const timer = setInterval(execute, interval);
  timer.unref();
  return {
    stop() {
      stopped = true;
      clearTimeout(first);
      clearInterval(timer);
    },
  };
}