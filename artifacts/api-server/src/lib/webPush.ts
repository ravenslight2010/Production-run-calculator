import { createHash, randomUUID } from "node:crypto";
import webpush from "web-push";
import {
  boundedDurationMs,
  classifyBackgroundFailure,
  createBackgroundOperationBackoff,
  runBackgroundOperation,
} from "./backgroundOperations";
import { and, asc, eq, gt, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import {
  db, usersTable, webPushDeliveriesTable, webPushSubscriptionsTable, webPushAlertArmsTable,
  dailySyncTable, freezerAlertRunProjectionTable,
  scheduledAlertRecordsTable,
} from "@workspace/db";
import { hasCompleteFreezerAlertProjection } from "./freezerAlertProjection";
import { computeServerCalc, selectCanonicalLiveRun } from "@workspace/live-calc";
import { logger } from "./logger";
import type { Scope } from "./requestScope";
import { getUserCapabilities } from "./roles";
import { computeAutoTrackElapsedMs } from "@workspace/live-calc";
import { facilityDate } from "./facilityTime";
import {
  enqueueServerJob,
  markScheduledEvaluationQueueSampleUnavailable,
  registerServerJob,
  sampleScheduledEvaluationQueue,
  ScheduledEvaluationQueueReadError,
  SCHEDULED_EVALUATION_CANONICAL_ACTOR,
  SCHEDULED_EVALUATION_MONITOR_SAMPLE_INTERVAL_MS,
  type ScheduledEvaluationQueueTransition,
} from "./serverJobs";

export const WEB_PUSH_KINDS = ["fifteenMin", "batchDue", "warehouseStaging", "runComplete", "freezerEmpty"] as const;
export type WebPushKind = (typeof WEB_PUSH_KINDS)[number];
const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_ENDPOINT = 2048;
const DEFAULT_ALERT_INTERVAL_MS = 60_000;
const SLOW_QUEUE_SAMPLE_WARNING_MS = 1_000;
const SUPPORTED_PUSH_ENDPOINT_HOSTS = new Set([
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.services.mozilla.com",
  "web.push.apple.com",
]);

export type PushProviderClassification = "google" | "mozilla" | "apple" | "other" | "unknown";
export type PushRegistrationRejectionReason =
  | "invalid_subscription"
  | "invalid_endpoint"
  | "unsafe_endpoint"
  | "unsupported_provider"
  | "invalid_keys"
  | "invalid_expiration"
  | "expired_subscription";

const PROVIDER_DOMAIN_HINTS: ReadonlyArray<{ provider: Exclude<PushProviderClassification, "other" | "unknown">; domains: readonly string[] }> = [
  { provider: "google", domains: ["googleapis.com"] },
  { provider: "mozilla", domains: ["mozilla.com", "mozilla.net"] },
  { provider: "apple", domains: ["apple.com"] },
];

function classifyProviderHost(host: string): PushProviderClassification {
  for (const { provider, domains } of PROVIDER_DOMAIN_HINTS) {
    if (domains.some((domain) => host === domain || host.endsWith(`.${domain}`))) return provider;
  }
  return "other";
}

function inspectPushEndpoint(endpoint: unknown): {
  reason: PushRegistrationRejectionReason | null;
  provider: PushProviderClassification;
} {
  if (typeof endpoint !== "string" || endpoint.length === 0 || endpoint.length > MAX_ENDPOINT) {
    return { reason: "invalid_endpoint", provider: "unknown" };
  }

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { reason: "invalid_endpoint", provider: "unknown" };
  }

  const provider = classifyProviderHost(url.hostname);
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    return { reason: "unsafe_endpoint", provider };
  }
  // URL.username/password do not expose an empty userinfo section ("https://@host").
  const authority = /^https:\/\/([^/?#]*)/i.exec(endpoint)?.[1];
  if (!authority || authority.includes("@")) return { reason: "unsafe_endpoint", provider };
  // The exact host set intentionally rejects IP literals and lookalike suffixes.
  if (!SUPPORTED_PUSH_ENDPOINT_HOSTS.has(url.hostname)) return { reason: "unsupported_provider", provider };
  return { reason: null, provider };
}

/**
 * Returns only bounded classification values suitable for operational logs.
 * Never include the endpoint, keys, or other subscription contents in telemetry.
 */
export function classifyPushSubscription(input: unknown): {
  reason: PushRegistrationRejectionReason | null;
  provider: PushProviderClassification;
} {
  if (!input || typeof input !== "object") return { reason: "invalid_subscription", provider: "unknown" };
  const s = input as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown }; expirationTime?: unknown };
  const endpoint = inspectPushEndpoint(s.endpoint);
  if (endpoint.reason) return endpoint;
  if (typeof s.keys?.p256dh !== "string" || s.keys.p256dh.length <= 15 || s.keys.p256dh.length > 512
    || typeof s.keys?.auth !== "string" || s.keys.auth.length <= 7 || s.keys.auth.length > 256) {
    return { reason: "invalid_keys", provider: endpoint.provider };
  }
  if (s.expirationTime != null && (typeof s.expirationTime !== "number" || !Number.isFinite(s.expirationTime))) {
    return { reason: "invalid_expiration", provider: endpoint.provider };
  }
  return { reason: null, provider: endpoint.provider };
}

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

export function validPushEndpoint(endpoint: unknown): endpoint is string {
  return inspectPushEndpoint(endpoint).reason === null;
}

export function validSubscription(input: unknown): input is { endpoint: string; keys: { p256dh: string; auth: string }; expirationTime?: number | null } {
  return classifyPushSubscription(input).reason === null;
}

export async function sendPushNotification(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
): Promise<void> {
  if (!validPushEndpoint(subscription.endpoint)) throw new Error("Invalid push endpoint");
  await webpush.sendNotification(subscription, payload, { TTL: 300, urgency: "high" });
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

function activeAlertContext(p: SyncData, nowMs: number) {
  const run = selectCanonicalLiveRun(p?.dayState?.runs);
  if (!run || typeof run.id !== "string" || !number(run.startedAt)
    || number(run.pausedAt) || number(run.endedAt)) return null;
  const values = p.runValues?.[run.id];
  if (!values) return null;
  try {
    // Explicitly target the lifecycle winner, not a legacy device selection.
    const result = computeServerCalc({
      ...p, dayState: { runs: [run], currentIndex: 0 },
    } as Parameters<typeof computeServerCalc>[0], [], nowMs);
    if (!result?.calc || result.runId !== run.id || result.calc.ppm <= 0) return null;
    return {
      run, values, calc: result.calc,
      key: runKey(run.id, number(run.startedAt) || number(run.metaUpdatedAt)),
    };
  } catch { return null; }
}

// This operates only on the server's canonical daily_sync blob. A paused run
// cannot emit timing alerts; reset/new run ids yield new stable alert ids.
export function alertCandidates(data: unknown, date: string, nowMs = Date.now()): Candidate[] {
  const context = activeAlertContext(data as SyncData, nowMs);
  if (!context) return [];
  const { run, values: v, calc, key } = context;
  const started = number(run.startedAt), paused = number(run.pausedAt);
  // Do not put client-controlled run ids (which can contain operational
  // labels) in the push payload. The digest is stable but fixed-size.
  const prefix = `${date}:${key}`;
  const out: Candidate[] = [];
  if (calc.adjustedTimeSec > 0 && calc.adjustedTimeSec <= 900) out.push({ id: `${prefix}:fifteen-min`, kind: "fifteenMin", armKey: key });
  if (calc.adjustedTimeSec <= 0 && nowMs - started >= 60_000) out.push({ id: `${prefix}:run-complete`, kind: "runComplete" });
  if (run.autoTrackDisabled === true && !calc.pressDone && calc.timePerBatchSec > 0) {
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

export function fifteenArm(data: unknown, nowMs: number): string | null {
  const context = activeAlertContext(data as SyncData, nowMs);
  return context && context.calc.adjustedTimeSec > 900 ? context.key : null;
}

function alertArmIdentity(kind: "fifteenMin" | "freezerEmpty", runKey: string): string {
  return `${kind}:${runKey}`;
}

function candidateHasRequiredArm(candidate: Candidate, activeArms: ReadonlySet<string>): boolean {
  if (candidate.kind !== "fifteenMin" && candidate.kind !== "freezerEmpty") return true;
  return !!candidate.armKey && activeArms.has(alertArmIdentity(candidate.kind, candidate.armKey));
}

export function scheduledAlertCandidateCount(
  data: unknown,
  date: string,
  nowMs: number,
  activeArms: ReadonlySet<string>,
): number {
  return [
    ...alertCandidates(data, date, nowMs),
    ...freezerCandidates(data, date, nowMs),
  ].filter((candidate) => candidateHasRequiredArm(candidate, activeArms)).length;
}

export function scheduledAlertDateNeedsEvaluation(
  data: unknown,
  date: string,
  nowMs: number,
  activeArms: ReadonlySet<string>,
  existingAlertIds: ReadonlySet<string>,
  hasPendingDeferredDelivery: boolean,
): boolean {
  if (hasPendingDeferredDelivery) return true;

  const fifteenMinuteArm = fifteenArm(data, nowMs);
  if (fifteenMinuteArm && !activeArms.has(alertArmIdentity("fifteenMin", fifteenMinuteArm))) return true;
  for (const runKey of pendingFreezerArms(data, nowMs)) {
    if (!activeArms.has(alertArmIdentity("freezerEmpty", runKey))) return true;
  }

  const candidates = [
    ...alertCandidates(data, date, nowMs),
    ...freezerCandidates(data, date, nowMs),
  ];
  return candidates.some((candidate) =>
    !existingAlertIds.has(candidate.id) && candidateHasRequiredArm(candidate, activeArms),
  );
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
    // Protect delivery as well as registration: legacy or manually altered rows
    // must never become signed requests to an unapproved destination.
    if (!validPushEndpoint(s.endpoint)) continue;
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
      await sendPushNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
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
    gt(scheduledAlertRecordsTable.expiresAt, new Date(nowMs)),
    inArray(scheduledAlertRecordsTable.alertKind, WEB_PUSH_KINDS),
    or(
      eq(scheduledAlertRecordsTable.status, "pending"),
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
      gt(scheduledAlertRecordsTable.expiresAt, new Date(nowMs)),
      inArray(scheduledAlertRecordsTable.alertKind, WEB_PUSH_KINDS),
      or(
        eq(scheduledAlertRecordsTable.status, "pending"),
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
  target?: {
    scope: Scope;
    date: string;
    signal?: AbortSignal;
    pruneExpired?: boolean;
    recoverDeferred?: boolean;
  },
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
    if (target?.recoverDeferred !== false && !quietHours(nowMs)) {
      await deliverDeferredAlerts(row.scope as Scope, row.date, nowMs, target?.signal);
    }
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
      if (!candidate.armKey) continue;
      const [armed] = await db.select({ runKey: webPushAlertArmsTable.runKey }).from(webPushAlertArmsTable)
        .where(and(eq(webPushAlertArmsTable.scope, row.scope), eq(webPushAlertArmsTable.runKey, candidate.armKey), eq(webPushAlertArmsTable.alertKind, "fifteenMin")));
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
  if (target?.pruneExpired !== false) await pruneExpiredWebPushData(nowMs);
  return { examined: rows.length, candidates };
}

export async function pruneExpiredWebPushData(nowMs = Date.now()): Promise<void> {
  const cutoff = new Date(nowMs);
  // Retention cleanup is idempotent. Run each table sweep separately so one
  // background job never fans out five simultaneous database checkouts.
  await db.delete(webPushDeliveriesTable).where(lt(webPushDeliveriesTable.expiresAt, cutoff));
  await db.delete(webPushAlertArmsTable).where(lt(webPushAlertArmsTable.expiresAt, cutoff));
  await db.delete(scheduledAlertRecordsTable).where(lt(scheduledAlertRecordsTable.expiresAt, cutoff));
  await db.delete(webPushSubscriptionsTable).where(and(
    eq(webPushSubscriptionsTable.enabled, true),
    lt(webPushSubscriptionsTable.expiresAt, cutoff),
  ));
  await db.delete(webPushSubscriptionsTable).where(and(
    eq(webPushSubscriptionsTable.enabled, false),
    lt(webPushSubscriptionsTable.updatedAt, new Date(nowMs - RETENTION_MS)),
  ));
}

const WEB_PUSH_RETENTION_PRUNE_INTERVAL_MS = 60 * 60_000;

/**
 * Coalesce cleanup across overlapping jobs and avoid repeating retention
 * sweeps on every minute-bucketed alert evaluation. A failed sweep is retryable
 * on the next call; the interval starts only after success.
 */
export function createWebPushRetentionPruner(
  prune: (nowMs: number) => Promise<void>,
  intervalMs = WEB_PUSH_RETENTION_PRUNE_INTERVAL_MS,
): (nowMs?: number) => Promise<void> {
  let lastSuccessfulAt: number | undefined;
  let inFlight: Promise<void> | undefined;
  return (nowMs = Date.now()) => {
    if (inFlight) return inFlight;
    if (lastSuccessfulAt !== undefined && nowMs - lastSuccessfulAt < intervalMs) {
      return Promise.resolve();
    }
    const run = Promise.resolve()
      .then(() => prune(nowMs))
      .then(() => { lastSuccessfulAt = nowMs; })
      .finally(() => { inFlight = undefined; });
    inFlight = run;
    return run;
  };
}

const pruneExpiredWebPushDataIfDue = createWebPushRetentionPruner(pruneExpiredWebPushData);

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

export function scheduledEvaluationIdempotencyKey(scope: Scope, nowMs: number, bucketMs = DEFAULT_ALERT_INTERVAL_MS): string {
  const bucket = Math.floor(nowMs / bucketMs) * bucketMs;
  return `scheduled-evaluation:${scope}:${bucket}`;
}

type ScheduledFreezerProjectionRow = {
  date: string;
  runId: string;
  startedAt: number | null;
  endedAt: number | null;
  freezerTime: number | null;
  dueAt: number | null;
};

function freezerAlertId(row: ScheduledFreezerProjectionRow): string {
  const generation = number(row.startedAt) || number(row.endedAt);
  return `${row.date}:${runKey(row.runId, generation)}:freezer-empty`;
}

/**
 * Fail open until the scope has an audited projection. Once complete, schedule
 * only for live runs, an unarmed upcoming freezer threshold, a due armed
 * freezer alert without its logical record, or a recoverable logical record.
 * Subscription count is deliberately not part of eligibility: a real alert
 * still needs its durable audit row when nobody has opted into push.
 */
async function hasScheduledAlertWork(scope: Scope, nowMs: number): Promise<boolean> {
  try {
    if (!await hasCompleteFreezerAlertProjection(scope)) return true;

    const [activeRun] = await db.select({ runId: freezerAlertRunProjectionTable.runId })
      .from(freezerAlertRunProjectionTable).where(and(
        eq(freezerAlertRunProjectionTable.scope, scope),
        eq(freezerAlertRunProjectionTable.isActive, true),
      )).limit(1);
    if (activeRun) return true;

    if (!quietHours(nowMs)) {
      const [recoverableRecord] = await db.select({ id: scheduledAlertRecordsTable.id })
        .from(scheduledAlertRecordsTable).where(and(
          eq(scheduledAlertRecordsTable.scope, scope),
          gt(scheduledAlertRecordsTable.expiresAt, new Date(nowMs)),
          inArray(scheduledAlertRecordsTable.alertKind, WEB_PUSH_KINDS),
          or(
            eq(scheduledAlertRecordsTable.status, "pending"),
            eq(scheduledAlertRecordsTable.status, "deferred"),
            and(
              eq(scheduledAlertRecordsTable.status, "delivering"),
              lt(scheduledAlertRecordsTable.evaluatedAt, new Date(nowMs - DEFERRED_DELIVERY_CLAIM_MS)),
            ),
          ),
        )).limit(1);
      if (recoverableRecord) return true;
    }

    const freezerRows: ScheduledFreezerProjectionRow[] = await db.select({
      date: freezerAlertRunProjectionTable.date,
      runId: freezerAlertRunProjectionTable.runId,
      startedAt: freezerAlertRunProjectionTable.startedAt,
      endedAt: freezerAlertRunProjectionTable.endedAt,
      freezerTime: freezerAlertRunProjectionTable.freezerTime,
      dueAt: freezerAlertRunProjectionTable.dueAt,
    }).from(freezerAlertRunProjectionTable).where(and(
      eq(freezerAlertRunProjectionTable.scope, scope),
      gte(freezerAlertRunProjectionTable.dueAt, nowMs - RETENTION_MS),
    )).limit(5_000);
    if (freezerRows.length >= 5_000) return true;
    const actionableFreezerRows = freezerRows.filter((row) =>
      row.endedAt !== null && row.endedAt !== 0
      && row.freezerTime !== null && row.freezerTime > 0
      && row.dueAt !== null,
    );
    if (actionableFreezerRows.length === 0) return false;

    const armKeys = [...new Set(actionableFreezerRows.map((row) =>
      runKey(row.runId, number(row.startedAt) || number(row.endedAt)),
    ))];
    const armRows = await db.select({ runKey: webPushAlertArmsTable.runKey })
      .from(webPushAlertArmsTable).where(and(
        eq(webPushAlertArmsTable.scope, scope),
        eq(webPushAlertArmsTable.alertKind, "freezerEmpty"),
        inArray(webPushAlertArmsTable.runKey, armKeys),
        gt(webPushAlertArmsTable.expiresAt, new Date(nowMs)),
      )).limit(armKeys.length);
    const armedKeys = new Set(armRows.map((row) => row.runKey));

    if (actionableFreezerRows.some((row) => {
      const key = runKey(row.runId, number(row.startedAt) || number(row.endedAt));
      return row.dueAt! > nowMs && !armedKeys.has(key);
    })) return true;

    const dueAlertIds = [...new Set(actionableFreezerRows
      .filter((row) => {
        const key = runKey(row.runId, number(row.startedAt) || number(row.endedAt));
        return row.dueAt! <= nowMs && armedKeys.has(key);
      })
      .map(freezerAlertId))];
    for (let offset = 0; offset < dueAlertIds.length; offset += 500) {
      const batch = dueAlertIds.slice(offset, offset + 500);
      const existingRows = await db.select({ alertId: scheduledAlertRecordsTable.alertId })
        .from(scheduledAlertRecordsTable).where(and(
          eq(scheduledAlertRecordsTable.scope, scope),
          inArray(scheduledAlertRecordsTable.alertId, batch),
          gt(scheduledAlertRecordsTable.expiresAt, new Date(nowMs)),
        )).limit(batch.length);
      const existingIds = new Set(existingRows.map((row) => row.alertId));
      if (batch.some((alertId) => !existingIds.has(alertId))) return true;
    }
    return false;
  } catch (error) {
    logger.warn({
      event: "scheduled_alert_work_gate",
      outcome: "fallback_to_evaluation",
      failureReason: classifyBackgroundFailure(error, { assumeDatabase: true }),
    }, "Scheduled alert work gate failed open");
    return true;
  }
}

type ScheduledAlertSnapshotRow = { date: string; data?: unknown };

async function readLegacyHistoricalAlertRows(scope: Scope, today: string, nowMs: number) {
  const result = await db.execute(sql`
    WITH expanded AS (
      SELECT
        daily.date,
        daily.data,
        run.value AS run,
        daily.data->'runValues'->(run.value->>'id') AS settings
      FROM daily_sync AS daily
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(daily.data->'dayState'->'runs') = 'array'
          THEN daily.data->'dayState'->'runs'
          ELSE '[]'::jsonb
        END
      ) AS run(value)
      WHERE daily.scope = ${scope}
        AND daily.date < ${today}
    ),
    classified AS (
      SELECT
        date,
        data,
        run,
        settings,
        (
          jsonb_typeof(run->'id') = 'string'
          AND jsonb_typeof(run->'startedAt') = 'number'
          AND (run->>'startedAt')::numeric > 0
          AND CASE
            WHEN jsonb_typeof(run->'endedAt') = 'number'
            THEN (run->>'endedAt')::numeric
            ELSE 0
          END = 0
          AND CASE
            WHEN jsonb_typeof(run->'pausedAt') = 'number'
            THEN (run->>'pausedAt')::numeric
            ELSE 0
          END = 0
        ) AS is_active,
        (
          jsonb_typeof(run->'id') = 'string'
          AND CASE
            WHEN jsonb_typeof(run->'endedAt') = 'number'
            THEN (run->>'endedAt')::numeric
            ELSE 0
          END <> 0
          AND CASE
            WHEN jsonb_typeof(settings->'freezerTime') = 'number'
            THEN (settings->>'freezerTime')::numeric
            ELSE 0
          END > 0
          AND CASE
            WHEN jsonb_typeof(run->'endedAt') = 'number'
              AND jsonb_typeof(settings->'freezerTime') = 'number'
            THEN (run->>'endedAt')::numeric
              + (settings->>'freezerTime')::numeric * 60000
            ELSE 0
          END >= ${nowMs - RETENTION_MS}
        ) AS freezer_due
      FROM expanded
    )
    SELECT
      date,
      CASE WHEN bool_or(is_active) THEN data ELSE NULL::jsonb END AS data,
      jsonb_agg(jsonb_build_object(
        'run', jsonb_build_object(
          'id', run->'id',
          'startedAt', run->'startedAt',
          'endedAt', run->'endedAt'
        ),
        'freezerTime', settings->'freezerTime'
      )) FILTER (WHERE freezer_due) AS "freezerRuns"
    FROM classified
    GROUP BY date, data
    HAVING bool_or(is_active) OR bool_or(freezer_due)
  `);
  type HistoricalFreezerRow = {
    date: string;
    data: unknown | null;
    freezerRuns: Array<{
      run: { id: string; startedAt?: number; endedAt: number };
      freezerTime: number;
    }> | null;
  };
  const rows = (result as unknown as { rows: HistoricalFreezerRow[] }).rows;
  return rows.map((row) => {
    if (row.data !== null) return { date: row.date, data: row.data };
    const freezerRuns = row.freezerRuns ?? [];
    return {
      date: row.date,
      data: {
        dayState: { runs: freezerRuns.map(({ run }) => run) },
        runValues: Object.fromEntries(freezerRuns.map(({ run, freezerTime }) => [
          run.id,
          { freezerTime },
        ])),
      },
    };
  });
}

/**
 * Read only the full current/future snapshots and indexed historical alert
 * facts. Legacy scopes keep the previous JSONB query until their explicit
 * projection backfill has completed.
 */
export async function readScheduledAlertSnapshotRows(
  scope: Scope,
  today: string,
  nowMs: number,
): Promise<ScheduledAlertSnapshotRow[]> {
  const currentRows = await db.select({ date: dailySyncTable.date, data: dailySyncTable.data })
    .from(dailySyncTable)
    .where(and(eq(dailySyncTable.scope, scope), gte(dailySyncTable.date, today)))
    .orderBy(asc(dailySyncTable.date));

  if (!(await hasCompleteFreezerAlertProjection(scope))) {
    const historical = await readLegacyHistoricalAlertRows(scope, today, nowMs);
    const rowsByDate = new Map(currentRows.map((row) => [row.date, row]));
    for (const row of historical) rowsByDate.set(row.date, row);
    return [...rowsByDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  }

  const activeDateRows = await db.select({ date: freezerAlertRunProjectionTable.date })
    .from(freezerAlertRunProjectionTable)
    .where(and(
      eq(freezerAlertRunProjectionTable.scope, scope),
      lt(freezerAlertRunProjectionTable.date, today),
      eq(freezerAlertRunProjectionTable.isActive, true),
    ))
    .groupBy(freezerAlertRunProjectionTable.date);
  const freezerRows = await db.select({
    date: freezerAlertRunProjectionTable.date,
    runId: freezerAlertRunProjectionTable.runId,
    startedAt: freezerAlertRunProjectionTable.startedAt,
    endedAt: freezerAlertRunProjectionTable.endedAt,
    freezerTime: freezerAlertRunProjectionTable.freezerTime,
  }).from(freezerAlertRunProjectionTable).where(and(
    eq(freezerAlertRunProjectionTable.scope, scope),
    lt(freezerAlertRunProjectionTable.date, today),
    gte(freezerAlertRunProjectionTable.dueAt, nowMs - RETENTION_MS),
  )).orderBy(
    asc(freezerAlertRunProjectionTable.date),
    asc(freezerAlertRunProjectionTable.dueAt),
  );

  const activeSnapshots = activeDateRows.length
    ? await db.select({ date: dailySyncTable.date, data: dailySyncTable.data })
      .from(dailySyncTable)
      .where(and(
        eq(dailySyncTable.scope, scope),
        inArray(dailySyncTable.date, activeDateRows.map((row) => row.date)),
      ))
    : [];
  const rowsByDate = new Map(currentRows.map((row) => [row.date, row]));
  for (const row of activeSnapshots) rowsByDate.set(row.date, row);

  const freezerByDate = new Map<string, typeof freezerRows>();
  for (const row of freezerRows) {
    const grouped = freezerByDate.get(row.date) ?? [];
    grouped.push(row);
    freezerByDate.set(row.date, grouped);
  }
  for (const [date, runs] of freezerByDate) {
    if (rowsByDate.has(date)) continue;
    rowsByDate.set(date, {
      date,
      data: {
        dayState: {
          runs: runs.map((run) => ({
            id: run.runId,
            ...(run.startedAt === null ? {} : { startedAt: run.startedAt }),
            endedAt: run.endedAt,
          })),
        },
        runValues: Object.fromEntries(runs.map((run) => [
          run.runId,
          { freezerTime: run.freezerTime },
        ])),
      },
    });
  }

  return [...rowsByDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

/**
 * Enqueues one durable workload per canonical scope/time bucket. A single job
 * evaluates that scope's dates individually, so local-day boundaries and
 * date-specific alert state remain intact without one queue entry per date.
 */
export async function enqueueScheduledWebPushAlerts(
  nowMs = Date.now(),
  bucketMs = DEFAULT_ALERT_INTERVAL_MS,
): Promise<{ examined: number; enqueued: number }> {
  const rows = await db.select({ scope: dailySyncTable.scope })
    .from(dailySyncTable)
    .groupBy(dailySyncTable.scope);
  let enqueued = 0;
  let skippedNoWork = 0;
  for (const row of rows) {
    const scope = row.scope as Scope;
    if (!await hasScheduledAlertWork(scope, nowMs)) {
      skippedNoWork++;
      continue;
    }
    const result = await enqueueServerJob({
      scope,
      actorId: SCHEDULED_EVALUATION_CANONICAL_ACTOR,
      type: "scheduled-evaluation",
      idempotencyKey: scheduledEvaluationIdempotencyKey(scope, nowMs, bucketMs),
      input: { scheduledFor: nowMs },
    });
    if (result.created) enqueued++;
  }
  if (skippedNoWork > 0) {
    logger.info({
      event: "web_push_alert_scheduler",
      outcome: "idle_scopes_skipped",
      safeCounts: { examined: rows.length, enqueued, skippedNoWork },
    }, "Scheduled alert scopes had no current work");
  }
  return { examined: rows.length, enqueued };
}

registerServerJob("scheduled-evaluation", {
  capability: "review-incidents",
  maxAttempts: 3,
  timeoutMs: 60_000,
  handler: async (context) => {
    const input = context.job.input as { date?: unknown; scheduledFor?: unknown };
    if ((input?.date !== undefined
      && (typeof input.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)))
      || typeof input?.scheduledFor !== "number" || !Number.isFinite(input.scheduledFor)) {
      throw new Error("scheduled-evaluation requires scheduledFor and an optional date");
    }
    if (await context.isCancellationRequested()) throw new Error("Cancelled");
    await context.reportProgress(10, "Evaluating scheduled production alerts");
    const scope = context.job.scope as Scope;
    const requestedDate = typeof input.date === "string" ? input.date : undefined;
    let dateRows: Array<{ date: string; data?: unknown }> = requestedDate ? [{ date: requestedDate }] : [];
    let examined = 0;
    let candidates = 0;
    let datesToEvaluate = dateRows;
    if (!requestedDate) {
      const nowMs = Date.now();
      const today = facilityDate(nowMs);
      // Keep this burst of pool reads serial: they are independent, but doing
      // them together increases peak checkouts while other background work runs.
      const snapshotRows = await readScheduledAlertSnapshotRows(scope, today, nowMs);
      const recordRows = await db.select({
        alertId: scheduledAlertRecordsTable.alertId,
        alertKind: scheduledAlertRecordsTable.alertKind,
        date: scheduledAlertRecordsTable.date,
        status: scheduledAlertRecordsTable.status,
        evaluatedAt: scheduledAlertRecordsTable.evaluatedAt,
      }).from(scheduledAlertRecordsTable).where(and(
        eq(scheduledAlertRecordsTable.scope, scope),
        gt(scheduledAlertRecordsTable.expiresAt, new Date(nowMs)),
      ));
      const armRows = await db.select({
        runKey: webPushAlertArmsTable.runKey,
        alertKind: webPushAlertArmsTable.alertKind,
      }).from(webPushAlertArmsTable).where(and(
        eq(webPushAlertArmsTable.scope, scope),
        gt(webPushAlertArmsTable.expiresAt, new Date(nowMs)),
      ));
      dateRows = snapshotRows;
      examined = dateRows.length;
      const existingAlertIds = new Set(recordRows.map((row) => row.alertId));
      const activeArms = new Set(armRows.map((row) =>
        alertArmIdentity(row.alertKind as "fifteenMin" | "freezerEmpty", row.runKey),
      ));
      candidates = dateRows.reduce<number>((total, row) => total
        + scheduledAlertCandidateCount(row.data, row.date, nowMs, activeArms), 0);
      const pendingDeferredDates = !quietHours(nowMs)
        ? recordRows.filter((row) =>
          (WEB_PUSH_KINDS as readonly string[]).includes(row.alertKind as string)
          && (row.status === "pending" || row.status === "deferred"
            || (row.status === "delivering"
              && row.evaluatedAt instanceof Date
              && row.evaluatedAt.getTime() < nowMs - DEFERRED_DELIVERY_CLAIM_MS)))
          .map((row) => row.date)
        : [];
      for (const date of new Set(pendingDeferredDates)) {
        if (await context.isCancellationRequested()) throw new Error("Cancelled");
        await context.commit(() => deliverDeferredAlerts(scope, date, Date.now(), context.signal));
      }
      datesToEvaluate = dateRows.filter((row) => scheduledAlertDateNeedsEvaluation(
        row.data,
        row.date,
        nowMs,
        activeArms,
        existingAlertIds,
        false,
      ));
    }
    // Keep each date's alert effects in its own commit. Besides preserving the
    // former transaction size, logical alert claims make retries safe if a
    // later date fails after earlier dates have completed.
    for (const row of datesToEvaluate) {
      if (await context.isCancellationRequested()) throw new Error("Cancelled");
      const result = await context.commit(() => runWebPushAlerts(Date.now(), {
        scope,
        date: row.date,
        signal: context.signal,
        pruneExpired: false,
        recoverDeferred: requestedDate !== undefined,
      }));
      if (requestedDate) {
        examined += result.examined;
        candidates += result.candidates;
      }
    }
    if (await context.isCancellationRequested()) throw new Error("Cancelled");
    // Retention cleanup is maintenance, not a user-visible alert effect. Keep
    // it outside the protected alert transaction and rate-limit it to hourly.
    await pruneExpiredWebPushDataIfDue(Date.now());
    if (await context.isCancellationRequested()) throw new Error("Cancelled");
    await context.reportProgress(100, "Scheduled production alerts evaluated");
    return { examined, candidates };
  },
});

export type WebPushAlertScheduler = { stop(): void };

function logScheduledEvaluationQueueTransitions(
  transition: ScheduledEvaluationQueueTransition,
): void {
  const { diagnostics } = transition;
  const backgroundPassFields = transition.sampleTiming?.backgroundPassId
    ? { backgroundPassId: transition.sampleTiming.backgroundPassId }
    : {};
  const safeCounts = {
    queued: diagnostics.queued,
    running: diagnostics.running,
    terminalLastWindow: diagnostics.terminalLastWindow,
    duplicateTimeBucketGroups: diagnostics.duplicateTimeBucketGroups,
    duplicateGroupsTruncated: diagnostics.duplicateGroupsTruncated,
    sampleAvailability: diagnostics.sampleAvailability,
    sampleCount: diagnostics.sampleCount,
    windowMs: diagnostics.windowMs,
  };
  if (transition.started.length) {
    logger.warn({
      event: "scheduled_evaluation_queue_monitor",
      outcome: "warning",
      warningCodes: transition.started,
      ...backgroundPassFields,
      safeCounts,
    }, "Scheduled evaluation queue warning started");
  }
  if (transition.cleared.length) {
    logger.info({
      event: "scheduled_evaluation_queue_monitor",
      outcome: "recovered",
      warningCodes: transition.cleared,
      ...backgroundPassFields,
      safeCounts,
    }, "Scheduled evaluation queue warning cleared");
  }
}

export function startWebPushAlertScheduler(options: {
  now?: () => number;
  monotonicNow?: () => number;
  enqueue?: typeof enqueueScheduledWebPushAlerts;
  sampleQueue?: () => Promise<ScheduledEvaluationQueueTransition>;
} = {}): WebPushAlertScheduler {
  const interval = Math.max(30_000, Number(process.env.WEB_PUSH_ALERT_INTERVAL_MS) || DEFAULT_ALERT_INTERVAL_MS);
  const now = options.now ?? Date.now;
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const enqueue = options.enqueue ?? enqueueScheduledWebPushAlerts;
  const sampleQueue = options.sampleQueue ?? sampleScheduledEvaluationQueue;
  const backoff = createBackgroundOperationBackoff({ jitter: true });
  let stopped = false;
  let scheduling = false;
  let monitoring = false;
  let monitorUnavailable = false;
  const sample = () => {
    if (stopped || monitoring) return;
    monitoring = true;
    const startedAt = monotonicNow();
    void sampleQueue()
      .then((transition) => {
        if (monitorUnavailable) {
          logger.info({
            event: "scheduled_evaluation_queue_monitor",
            outcome: "monitor_recovered",
          }, "Scheduled evaluation queue monitor recovered");
          monitorUnavailable = false;
        }
        const durationMs = transition.sampleTiming?.durationMs ??
          boundedDurationMs(monotonicNow() - startedAt);
        if (durationMs >= SLOW_QUEUE_SAMPLE_WARNING_MS) {
          logger.warn({
            event: "scheduled_evaluation_queue_monitor",
            outcome: "slow_sample",
            failureStage: "snapshot",
            ...(transition.sampleTiming?.backgroundPassId
              ? { backgroundPassId: transition.sampleTiming.backgroundPassId }
              : {}),
            durationMs,
            ...(transition.sampleTiming
              ? { queryDurationsMs: transition.sampleTiming.queryDurationsMs }
              : {}),
            ...(transition.sampleTiming?.databasePhases
              ? { databasePhaseVersion: 1, databasePhases: transition.sampleTiming.databasePhases }
              : {}),
          }, "Scheduled evaluation queue monitor sample was slow");
        }
        logScheduledEvaluationQueueTransitions(transition);
      })
      .catch((error: unknown) => {
        markScheduledEvaluationQueueSampleUnavailable();
        const readError = error instanceof ScheduledEvaluationQueueReadError ? error : undefined;
        logger.warn({
          event: "scheduled_evaluation_queue_monitor",
          outcome: "sample_unavailable",
          failureStage: readError?.failureStage ?? "snapshot",
          failureReason: classifyBackgroundFailure(error, { assumeDatabase: true }),
          ...(readError?.backgroundPassId
            ? { backgroundPassId: readError.backgroundPassId }
            : {}),
          durationMs: readError?.totalDurationMs ?? boundedDurationMs(monotonicNow() - startedAt),
          ...(readError ? { queryDurationMs: readError.queryDurationMs } : {}),
          ...(readError?.databasePhase
            ? { databasePhaseVersion: 1, databasePhase: readError.databasePhase }
            : {}),
        }, "Scheduled evaluation queue monitor sample unavailable");
        monitorUnavailable = true;
      })
      .finally(() => { monitoring = false; });
  };
  const execute = () => {
    if (stopped || scheduling) return;
    const currentTime = now();
    if (!backoff.isReady(currentTime)) return;
    scheduling = true;
    const startedAt = monotonicNow();
    // Freeze the bucket input across the retry. A partial first insert near a
    // bucket boundary must converge on the same idempotency keys.
    const scheduledAt = currentTime;
    void runBackgroundOperation(
      "web-push-schedule",
      () => enqueue(scheduledAt, interval),
    )
      .then(() => backoff.recordSuccess())
      .catch((error: unknown) => {
        backoff.recordFailure(now());
        logger.error({
          event: "web_push_alert_scheduler",
          outcome: "failed",
          failureStage: "enqueue",
          failureReason: classifyBackgroundFailure(error, { assumeDatabase: true }),
          durationMs: boundedDurationMs(monotonicNow() - startedAt),
        }, "Web push alert scheduling failed");
      })
      .finally(() => { scheduling = false; });
  };
  // Enqueue promptly after startup and recurringly without a foreground
  // browser. This timer is only a producer, never a second execution loop.
  const first = setTimeout(execute, 0);
  const firstSample = setTimeout(sample, 0);
  first.unref();
  firstSample.unref();
  const timer = setInterval(execute, interval);
  const sampleTimer = setInterval(sample, SCHEDULED_EVALUATION_MONITOR_SAMPLE_INTERVAL_MS);
  timer.unref();
  sampleTimer.unref();
  return {
    stop() {
      stopped = true;
      clearTimeout(first);
      clearTimeout(firstSample);
      clearInterval(timer);
      clearInterval(sampleTimer);
    },
  };
}
