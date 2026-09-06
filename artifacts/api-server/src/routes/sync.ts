import { Router, type IRouter, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import {
  db,
  dailySyncTable,
  dataResetTable,
  brandProfilesTable,
  cheeseRecipesTable,
  doughRecipesTable,
  sauceRecipesTable,
  mixesTable,
  ingredientsTable,
  ingredientBatchWeightsTable,
  importAliasesTable,
  specImportAliasesTable,
  photoAliasesTable,
  mergeAliasesTable,
  deniedMergesTable,
  mergedAwayTable,
  aiCorrectionsTable,
  aiConversationTurnsTable,
  facilityKnowledgeTable,
  fillMissingValuesTable,
  freezerPullItemsTable,
  incidentsTable,
  productionRulesTable,
  runTemplatesTable,
  savedSpecSheetsTable,
  savedShippingGuidesTable,
  savedPremixSheetsTable,
  supervisorPinSettingsTable,
  cycleCountSchedulesTable,
  inventoryItemsTable,
  inventoryLocationsTable,
  inventoryLotsTable,
  inventoryLedgerTable,
  inventoryConsumedRunsTable,
  inventorySettingsTable,
  sandboxMetaTable,
  productionRunsTable,
  qualityChecksTable,
  proactiveAlertSettingsTable,
  auditLogsTable,
  syncConflictLogsTable,
} from "@workspace/db";
import { and, eq, gt, gte, lte, asc, sql } from "drizzle-orm";
import { currentScope, type Scope } from "../lib/requestScope";
import { protectRunValues, sanitizeSyncPayload, isSyncPayloadTooLarge, capMergedResult } from "../lib/protectRunValues";
import { logAuditEvent } from "./auditLogs";
import { healNaturalPepInValues, healNaturalPepList } from "../lib/dataHeals";
import { requireCapability } from "../middlewares/requireCapability";
import { detectConflicts, type ConflictInfo } from "../lib/syncConflict";
import { applyAutoTrackClaim, parseAutoTrackClaim, type AutoTrackClaim } from "../lib/autoTrackCoordination";
import {
  buildNetSecondServerClaims,
  buildWallClockServerClaims,
  withWallClockServerState,
  type WallClockServerPlan,
} from "../lib/autoTrackServerTicks";
import { logger } from "../lib/logger";
import { consumeSauceBarrelInTransaction } from "./inventory";
export { detectConflicts } from "../lib/syncConflict";
import {
  buildAutoTrackScheduleFromPayload,
  computeServerCalc,
  type AutoTrackSchedule,
  type ServerCalcResult,
} from "@workspace/live-calc";

const router: IRouter = Router();

type SseClient = { res: Response; clientId: string; scope: Scope; watchDate: string };
const clients = new Set<SseClient>();
const SNAPSHOT_ID_RE = /^[a-f0-9]{64}$/;

/** Stable identity for a canonical JSON snapshot (object key order independent). */
export function syncSnapshotId(data: unknown): string {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, child]) => [key, stable(child)]),
      );
    }
    return value;
  };
  return createHash("sha256").update(JSON.stringify(stable(data))).digest("hex");
}

function requestedSnapshot(req: Request): string | undefined {
  const value = req.query.snapshot;
  return typeof value === "string" && SNAPSHOT_ID_RE.test(value) ? value : undefined;
}

function emptySyncData(date: string): Record<string, unknown> {
  return {
    dayState: { date, runs: [] },
    runValues: {},
    runValuesUpdatedAt: {},
  };
}

function isPartialSyncPayload(payload: unknown): payload is Record<string, unknown> {
  return !!payload && typeof payload === "object" && !Array.isArray(payload) &&
    (payload as Record<string, unknown>).completeness === "partial";
}

function isValidPartialContract(payload: Record<string, unknown>): boolean {
  return payload.syncVersion === 1 &&
    typeof payload.baseSnapshotId === "string" &&
    SNAPSHOT_ID_RE.test(payload.baseSnapshotId);
}

type ProtectedUpsertResult = {
  data: unknown;
  wrote: boolean;
  partialFallback: boolean;
  retries: number;
};

function unchangedResponse(res: Response, data: unknown, requested: string | undefined): boolean {
  const snapshotId = syncSnapshotId(data);
  if (requested !== snapshotId) return false;
  res.setHeader("X-Sync-Snapshot", snapshotId);
  res.setHeader("X-Sync-Response", "unchanged");
  res.json({ unchanged: true, snapshotId });
  return true;
}

function queueAgeMs(payload: unknown): number | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const record = payload as Record<string, unknown>;
  const meta = record.syncMeta && typeof record.syncMeta === "object"
    ? record.syncMeta as Record<string, unknown>
    : record;
  const queuedAt = meta.queuedAt;
  if (typeof queuedAt !== "number" || !Number.isFinite(queuedAt)) return undefined;
  // Keep queue age bounded and never log a future or ancient client timestamp.
  const age = Date.now() - queuedAt;
  return age >= 0 && age <= 7 * 24 * 60 * 60 * 1000 ? Math.round(age) : undefined;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// "Today" for scheduling is the CLIENT's local date, not the server's. The app
// is driven by client-local midnight, but the server runs in UTC in production,
// so prefer the client-supplied `today` query param and fall back to the server
// date only when it's absent or malformed.
function clientToday(req: Request): string {
  const t = req.query.today;
  return typeof t === "string" && isValidDate(t) ? t : todayStr();
}

// Only ever push to clients watching the SAME data scope AND the SAME local date,
// so a sandbox writer's state never streams into a live watcher's UI, and a peer
// on a different local calendar day (behind/ahead of UTC) never receives another
// day's state into its live view — the cross-date clobber this fix prevents.
type BroadcastPayload = {
  dayState?: { runs?: Array<Record<string, unknown>>; currentIndex?: number };
  runValues?: Record<string, Record<string, unknown>>;
  packagingProgress?: Record<string, unknown>;
  autoTrackCoordination?: {
    runs?: Record<string, Record<string, unknown>>;
  };
};

/** Server-side tick detection for the current run (refactor steps 6a/7). */
function buildAutoTrackSchedule(
  payload: BroadcastPayload | null,
  calcResult: ServerCalcResult | null,
): AutoTrackSchedule | null {
  return buildAutoTrackScheduleFromPayload(payload, calcResult);
}

// Only ever push to clients watching the SAME data scope AND the SAME local date,
// so a sandbox writer's state never streams into a live watcher's UI, and a peer
// on a different local calendar day (behind/ahead of UTC) never receives another
// day's state into its live view — the cross-date clobber this fix prevents.
function broadcast(data: unknown, senderId: string, scope: Scope, date: string): void {
  // Compute server-side calc + auto-track schedule for the current run so
  // clients can display authoritative values and adopt the server's tick
  // schedule without doing the math themselves.
  let serverCalc: ServerCalcResult | null = null;
  let autoTrackSchedule: AutoTrackSchedule | null = null;
  try {
    const payload = data as BroadcastPayload | null;
    if (payload?.dayState?.runs && payload.dayState.runs.length > 0) {
      serverCalc = computeServerCalc(payload as Parameters<typeof computeServerCalc>[0], []);
      autoTrackSchedule = buildAutoTrackSchedule(payload, serverCalc);
    }
  } catch { /* calc failure must not break the sync broadcast */ }
  const msg = `data: ${JSON.stringify({ data, senderId, serverCalc, autoTrackSchedule })}\n\n`;
  for (const client of clients) {
    if (client.scope === scope && client.watchDate === date && client.clientId !== senderId) {
      try { client.res.write(msg); } catch {}
    }
  }
}

// Push a "data was reset" frame to EVERY open client in the scope, regardless of
// which calendar day they are watching (a reset clears all dates). Clients that
// see a resetEpoch newer than the one they last honored wipe their local copy and
// reload, so an open tab can't keep re-uploading its stale data after the reset.
function broadcastReset(scope: Scope, resetEpoch: number): void {
  const msg = `data: ${JSON.stringify({ reset: true, resetEpoch })}\n\n`;
  for (const client of clients) {
    if (client.scope === scope) {
      try { client.res.write(msg); } catch {}
    }
  }
}

// Current reset generation for a scope (0 when never reset). Clients compare this
// against the epoch they last honored to decide whether to perform a local wipe.
async function getResetEpoch(scope: Scope): Promise<number> {
  const [row] = await db
    .select()
    .from(dataResetTable)
    .where(eq(dataResetTable.scope, scope));
  return row?.epoch ?? 0;
}

// Postgres unique-violation is SQLSTATE 23505. Drizzle wraps driver errors, so
// the original pg error (carrying `.code`) is reachable via the `.cause` chain
// rather than the top-level error — walk it.
function isUniqueViolation(e: unknown): boolean {
  let cur: unknown = e;
  for (let depth = 0; depth < 5 && cur && typeof cur === "object"; depth++) {
    if ((cur as { code?: string }).code === "23505") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

// Atomically upsert the day-state row with the protective merge applied (see
// protectRunValues). The read of the existing row and the write MUST happen
// inside one transaction with a row lock (SELECT ... FOR UPDATE), otherwise two
// concurrent PUTs could each merge against a stale snapshot and the later commit
// would overwrite a newer per-run stamp (or a fuller run list) with an older one
// — defeating the strictly-newer-wins guarantee and re-opening the data-loss
// window. Mirrors the FOR UPDATE pattern used by inventory drawdown.
//
// FIRST-WRITE RACE: when no row exists yet (first push of a date) FOR UPDATE
// locks nothing, so two concurrent first PUTs would each merge against "no
// existing" and the later writer would clobber the earlier one's runs. We close
// that window by doing a plain INSERT when no row exists: the losing writer hits
// a unique-violation (23505) and we retry — the row now exists, FOR UPDATE locks
// it, and we merge against it instead of overwriting. Returns the merged payload
// that was actually written so callers broadcast the same state peers will read.
//
// The daily-reset SESSION FENCE (see sessionBoundary.getSessionBoundaryMs) reads
// `dayState.resetBoundaryAt`, NOT `dayState.resetAt`. They mean different things:
//   - `resetAt` is advanced on FUTURE-day writes too, purely to trigger the
//     scheduled-day replacement merge when a future row is (re)written. It is
//     keyed to the client's LOCAL calendar, so a user behind UTC stamps their
//     "tomorrow" — which can equal the SERVER's UTC "today". If the fence read
//     `resetAt`, that future-day override would look like today's reset and log
//     the whole shift out hours before their real local midnight.
//   - `resetBoundaryAt` is set ONLY when a row is written as the writer's ACTUAL
//     current local day (target date === the client's `today`). So only a genuine
//     same-day rollover can ever fence sessions; a future/past write cannot.
// Derived server-side (never trusted from the client payload) so the fence stays
// authoritative regardless of what a client echoes back.
//
// SECURITY: `resetAt` itself is still attacker-controlled (it comes straight off
// `payload.dayState.resetAt`), so it must never be adopted verbatim. A malicious
// same-day write could set it to an arbitrary far-future millisecond timestamp,
// which `requireAuth` would then treat as "every token issued before this instant
// is signed out" — i.e. forever, taking the whole live deployment offline. Clamp
// it to (server clock + a small skew allowance): a genuine same-day rollover's
// `resetAt` is the WRITER's `Date.now()` at write time, which can be a second or
// two ahead of the server's own clock/round-trip and is intentionally nudged a
// beat past a token's second-truncated `iat` (see requireAuth's iat+1 comparison)
// — this tolerance preserves that, while capping how far into the future a
// crafted value can push the fence, bounding the DoS instead of eliminating any
// self-healing time window.
const MAX_RESET_AT_SKEW_MS = 5 * 60_000;
function applyResetBoundary(
  merged: unknown,
  existingData: unknown,
  isCurrentDay: boolean,
): void {
  if (!merged || typeof merged !== "object") return;
  const day = (merged as { dayState?: Record<string, unknown> }).dayState;
  if (!day || typeof day !== "object") return;
  if (isCurrentDay) {
    const resetAt = day.resetAt;
    if (typeof resetAt === "number" && resetAt > 0) {
      day.resetBoundaryAt = Math.min(resetAt, Date.now() + MAX_RESET_AT_SKEW_MS);
    } else {
      delete day.resetBoundaryAt;
    }
  } else {
    // A future- (or past-) dated write must never establish or advance the fence.
    // Preserve any boundary a genuine same-day write already recorded on this row.
    const prev = (existingData as { dayState?: { resetBoundaryAt?: unknown } } | null | undefined)
      ?.dayState?.resetBoundaryAt;
    if (typeof prev === "number" && prev > 0) day.resetBoundaryAt = prev;
    else delete day.resetBoundaryAt;
  }
}

// Durable write-time guard for the Lowe's bare-"NATURAL" pep-type poison: a
// stale pre-fix client can still push the bare qualifier names ("Natural",
// "NATURAL", "NATURAL (Hormel - 24878)") in its pep-type list or run values
// after the one-time heal ran. Canonicalize them at every sync write so the
// poison can never be re-persisted (idempotent; matching is anchored so real
// product names like "Natural Bacon" are untouched).
function canonicalizePepNames(merged: unknown): void {
  if (!merged || typeof merged !== "object") return;
  const data = merged as Record<string, unknown>;
  const healedList = healNaturalPepList(data.pepTypes);
  if (healedList) data.pepTypes = healedList;
  const runValues = data.runValues;
  if (runValues && typeof runValues === "object") {
    for (const vals of Object.values(runValues as Record<string, unknown>)) {
      if (vals && typeof vals === "object") {
        healNaturalPepInValues(vals as Record<string, unknown>);
      }
    }
  }
}

// Best-effort: insert a sync_conflict_logs row when the protective merge
// actually changed the incoming payload. Never throws — a logging failure
// must never block the sync response.
async function recordSyncConflict(
  scope: Scope,
  date: string,
  info: ConflictInfo,
  clientIp: string | undefined,
): Promise<void> {
  try {
    await db.insert(syncConflictLogsTable).values({
      scope,
      date,
      fieldsWithConflicts: info.fieldsWithConflicts,
      conflictCount: info.conflictCount,
      resolution: "additive-union",
      clientStateHash: info.clientStateHash,
      serverStateHash: info.serverStateHash,
      mergedStateHash: info.mergedStateHash,
      clientIp: clientIp ?? null,
    });
  } catch {
    // best-effort: log failures must never break the sync write
  }
}

type ConflictTrendPoint = {
  date: string;
  conflicts: number;
  events: number;
};

function previousDates(today: string, count: number): string[] {
  const cursor = new Date(`${today}T00:00:00.000Z`);
  const dates: string[] = [];
  for (let offset = count - 1; offset >= 0; offset--) {
    const day = new Date(cursor);
    day.setUTCDate(cursor.getUTCDate() - offset);
    dates.push(day.toISOString().slice(0, 10));
  }
  return dates;
}

function conflictFieldName(field: string): string {
  if (field.startsWith("runValues:")) return "Run values";
  if (field.startsWith("packagingProgress:")) return "Packaging progress";
  if (field.startsWith("dayState.runs.meta:")) return "Run details";
  if (field.startsWith("dayState.runs:appended")) return "Run list";
  return field;
}

function conflictRunId(field: string): string | null {
  for (const prefix of ["runValues:", "packagingProgress:", "dayState.runs.meta:"]) {
    if (field.startsWith(prefix)) return field.slice(prefix.length) || null;
  }
  return null;
}

router.get(
  "/sync/conflict-stats",
  requireCapability("manage-staff"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const today = clientToday(req);
      const dates = previousDates(today, 7);
      const [startDate] = dates;
      const scope = currentScope();
      const rows = await db
        .select({
          date: syncConflictLogsTable.date,
          conflictCount: syncConflictLogsTable.conflictCount,
          fieldsWithConflicts: syncConflictLogsTable.fieldsWithConflicts,
        })
        .from(syncConflictLogsTable)
        .where(and(
          eq(syncConflictLogsTable.scope, scope),
          gte(syncConflictLogsTable.date, startDate),
          lte(syncConflictLogsTable.date, today),
        ));

      const byDate = new Map<string, ConflictTrendPoint>(
        dates.map((date) => [date, { date, conflicts: 0, events: 0 }]),
      );
      const fieldCounts = new Map<string, number>();
      const runCounts = new Map<string, { count: number; fields: Set<string> }>();

      for (const row of rows) {
        const point = byDate.get(row.date);
        if (point) {
          point.conflicts += row.conflictCount;
          point.events += 1;
        }
        const fields = Array.isArray(row.fieldsWithConflicts)
          ? row.fieldsWithConflicts.filter((field): field is string => typeof field === "string")
          : [];
        for (const rawField of fields) {
          const field = conflictFieldName(rawField);
          fieldCounts.set(field, (fieldCounts.get(field) ?? 0) + 1);
          const runId = conflictRunId(rawField);
          if (runId) {
            const run = runCounts.get(runId) ?? { count: 0, fields: new Set<string>() };
            run.count += 1;
            run.fields.add(field);
            runCounts.set(runId, run);
          }
        }
      }

      const fields = [...fieldCounts]
        .map(([field, count]) => ({ field, count }))
        .sort((a, b) => b.count - a.count || a.field.localeCompare(b.field));
      const runs = [...runCounts]
        .map(([runId, value]) => ({ runId, count: value.count, fields: [...value.fields].sort() }))
        .sort((a, b) => b.count - a.count || a.runId.localeCompare(b.runId));

      res.json({
        scope,
        today,
        totalConflictsToday: byDate.get(today)?.conflicts ?? 0,
        trend: dates.map((date) => byDate.get(date)!),
        fields,
        runs,
      });
    } catch (err) {
      req.log.error({ err }, "Failed to fetch sync conflict stats");
      res.status(500).json({ error: "Failed to fetch sync conflict stats" });
    }
  },
);

async function upsertProtected(
  date: string,
  scope: Scope,
  payload: unknown,
  clientTodayDate: string,
  clientIp?: string,
): Promise<ProtectedUpsertResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      let existingData: unknown = undefined;
      const merged = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(dailySyncTable)
          .where(and(eq(dailySyncTable.date, date), eq(dailySyncTable.scope, scope)))
          .for("update");
        existingData = existing?.data;
        // A partial payload is a delta over the exact locked snapshot. Inherit
        // omitted cold sections (such as history) from that snapshot before the
        // normal per-run/LWW protection runs.
        const payloadForMerge = isPartialSyncPayload(payload) && existing?.data
          ? { ...(existing.data as Record<string, unknown>), ...(payload as Record<string, unknown>) }
          : payload;
        // Validate partial deltas while the canonical row lock is held.
        // Otherwise another writer could change the row between validation and
        // merge, making the client's base snapshot unsafe.
        if (isPartialSyncPayload(payload)) {
          const currentSnapshotId = existing?.data === undefined
            ? undefined
            : syncSnapshotId(existing.data);
          if (
            !isValidPartialContract(payload) ||
            typeof currentSnapshotId !== "string" ||
            payload.baseSnapshotId !== currentSnapshotId
          ) {
            // Do not apply a delta with a missing, malformed, or stale
            // dependency. Return the complete authoritative snapshot instead.
            return {
              data: existing?.data ?? null,
              wrote: false,
              partialFallback: true,
              retries: attempt,
            };
          }
        }
        // Only a FUTURE scheduled row may use resetAt to replace its run list.
        // Today's row must always be additive/tombstone-driven: a new device can
        // hold a newer local marker before it receives this row, but that marker
        // must never erase other operators' scheduled or live runs.
        const m = capMergedResult(protectRunValues(payloadForMerge, existing?.data, {
          allowRunListReplacement: date > clientTodayDate,
        }));
        canonicalizePepNames(m);
        applyResetBoundary(m, existing?.data, date === clientTodayDate);
        if (existing) {
          await tx
            .update(dailySyncTable)
            .set({ data: m as any, updatedAt: new Date() })
            .where(and(eq(dailySyncTable.date, date), eq(dailySyncTable.scope, scope)));
        } else {
          await tx
            .insert(dailySyncTable)
            .values({ date, scope, data: m as any, updatedAt: new Date() });
        }
        return { data: m, wrote: true, partialFallback: false, retries: attempt };
      });
      if (!merged.wrote) return merged;
      // Conflict detection and logging happen outside the transaction so a
      // logging failure can never roll back the actual sync write.
      const conflict = detectConflicts(payload, existingData, merged.data);
      if (conflict) {
        void recordSyncConflict(scope, date, conflict, clientIp);
      }
      return merged;
    } catch (e) {
      // A concurrent first writer created the row between our select and insert;
      // retry so we merge against it rather than failing or clobbering.
      if (isUniqueViolation(e) && attempt < 3) continue;
      throw e;
    }
  }
}

router.get("/sync/today", async (req: Request, res: Response): Promise<void> => {
  // "Today" is the CLIENT's local date (see clientToday). The server runs in UTC,
  // so a client behind UTC would otherwise read/write a different calendar row
  // than its scheduled days and rollover use — clobbering a scheduled "tomorrow".
  const [row] = await db
    .select()
    .from(dailySyncTable)
    .where(and(eq(dailySyncTable.date, clientToday(req)), eq(dailySyncTable.scope, currentScope())));
  // A missing live row is an empty baseline, not a null payload. Returning the
  // same shape as a populated row keeps reset/wake recovery within the client
  // sync contract and gives it a stable snapshot identity.
  const data = row?.data ?? emptySyncData(clientToday(req));
  if (unchangedResponse(res, data, requestedSnapshot(req))) return;
  if (data) res.setHeader("X-Sync-Snapshot", syncSnapshotId(data));
  res.json(data);
});

// A client pushes the reset epoch it last honored as `?epoch=`. If a data reset
// bumped the server epoch past it, the client is still holding pre-reset data and
// is about to re-upload it — so reject the write (returning the new epoch) until
// the client has wiped and re-adopted the empty state. This closes the re-adoption
// race that used to require taking the API down during a manual purge.
//
// SECURITY: this check must fail CLOSED once a reset has ever happened for the
// scope. A missing or malformed `?epoch=` param used to be treated the same as
// "no opinion" (accept the write) — that let anyone skip the query param
// entirely and immediately replay stale pre-reset data right after a manager
// wiped it, defeating the whole point of the reset. Now, once the scope has a
// nonzero server epoch, any push without a valid, sufficiently-advanced epoch
// is treated as stale. Scopes that have never been reset (serverEpoch === 0)
// have nothing to protect, so older/epoch-unaware clients keep working there.
async function isStaleResetPush(req: Request, scope: Scope): Promise<number | null> {
  const serverEpoch = await getResetEpoch(scope);
  if (serverEpoch === 0) return null;
  const raw = req.query.epoch;
  const clientEpoch = typeof raw === "string" && raw !== "" ? Number(raw) : NaN;
  if (!Number.isFinite(clientEpoch) || clientEpoch < serverEpoch) return serverEpoch;
  return null;
}

router.get("/sync/reset-epoch", async (_req: Request, res: Response): Promise<void> => {
  res.json({ epoch: await getResetEpoch(currentScope()) });
});

router.put("/sync/today", async (req: Request, res: Response): Promise<void> => {
  const { senderId = "", payload, snapshotId: requestedId, syncMeta } = req.body as {
    senderId?: string;
    payload: unknown;
    snapshotId?: unknown;
    syncMeta?: unknown;
  };
  const today = clientToday(req);
    const scope = currentScope();

  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    res.status(400).json({ error: "payload must be a JSON object" }); return;
  }
  const sanitized = sanitizeSyncPayload(payload);
  if (isSyncPayloadTooLarge(sanitized)) { res.status(400).json({ error: "Payload too large" }); return; }
  const staleEpoch = await isStaleResetPush(req, scope);
  if (staleEpoch !== null) { res.setHeader("X-Sync-Response", "stale"); res.json({ ok: true, stale: true, epoch: staleEpoch }); return; }
  const result = await upsertProtected(today, scope, sanitized, today, req.ip);
  const merged = result.data;
  // Broadcast the merged result (not the raw push) so peers converge on the same
  // protected state the row was written with.
  if (result.wrote) broadcast(merged, senderId, scope, today);
  const snapshotId = merged === null ? undefined : syncSnapshotId(merged);
  res.setHeader("X-Sync-Response", !result.partialFallback && snapshotId !== undefined && requestedId === snapshotId
    ? "unchanged"
    : result.partialFallback ? "partial-fallback" : "full");
  res.setHeader("X-Sync-Retry-Count", String(result.retries));
  res.setHeader("X-Sync-Queue-Age-Ms", String(queueAgeMs(syncMeta) ?? ""));
  res.setHeader("X-Sync-Convergence", result.wrote ? "written" : "fallback");
  const responseBody = !result.partialFallback && snapshotId !== undefined && requestedId === snapshotId
    ? { ok: true, unchanged: true, snapshotId }
    : {
        ok: true,
        data: merged,
        ...(snapshotId ? { snapshotId } : {}),
        ...(result.partialFallback ? { partialFallback: true } : {}),
      };
  res.setHeader("X-Sync-Response-Bytes", String(Buffer.byteLength(JSON.stringify(responseBody))));
  res.json(responseBody);
});

router.post("/sync/auto-track/claim", async (req: Request, res: Response): Promise<void> => {
  const startedAt = Date.now();
  const claim = parseAutoTrackClaim(req.body?.claim, startedAt);
  if (!claim) {
    res.status(400).json({ error: "Invalid auto-track event" });
    return;
  }
  const date = clientToday(req);
  const scope = currentScope();
  const staleEpoch = await isStaleResetPush(req, scope);
  if (staleEpoch !== null) {
    res.setHeader("X-Sync-Response", "stale");
    res.json({ ok: true, stale: true, epoch: staleEpoch });
    return;
  }

  try {
    let result:
      | ReturnType<typeof applyAutoTrackClaim>
      | undefined;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        result = await db.transaction(async (tx) => {
          const [existing] = await tx
            .select()
            .from(dailySyncTable)
            .where(and(eq(dailySyncTable.date, date), eq(dailySyncTable.scope, scope)))
            .for("update");
          const applied = applyAutoTrackClaim(existing?.data ?? emptySyncData(date), claim);
          if (applied.outcome === "accepted") {
             if (applied.inventoryConsumption?.kind === "sauce-barrel") {
               const consumption = applied.inventoryConsumption;
               await consumeSauceBarrelInTransaction(
                 tx,
                 consumption.runId,
                 consumption.barrelIndex,
                 consumption.itemKey,
                 consumption.qty,
                 true,
                 consumption.eventId,
               );
             }
            if (existing) {
              await tx.update(dailySyncTable)
                .set({ data: applied.data as any, updatedAt: new Date() })
                .where(and(eq(dailySyncTable.date, date), eq(dailySyncTable.scope, scope)));
            } else {
              await tx.insert(dailySyncTable)
                .values({ date, scope, data: applied.data as any, updatedAt: new Date() });
            }
          }
          return applied;
        });
        break;
      } catch (error) {
        if (isUniqueViolation(error) && attempt < 3) continue;
        throw error;
      }
    }
    if (!result) throw new Error("Auto-track claim did not complete");
    const senderId = typeof req.body?.senderId === "string" ? req.body.senderId.slice(0, 160) : "";
    if (result.outcome === "accepted") broadcast(result.data, senderId, scope, date);
    req.log.info({
      event: "auto_track_claim",
      outcome: result.outcome,
      channel: claim.channel,
      runId: createHash("sha256").update(claim.runId).digest("hex").slice(0, 12),
      eventId: createHash("sha256").update(claim.eventId).digest("hex").slice(0, 12),
      sequence: claim.sequence,
      durationMs: Date.now() - startedAt,
    }, "Auto-track claim resolved");
    let autoTrackSchedule: AutoTrackSchedule | null = null;
    try {
      const claimCalc = computeServerCalc(result.data as unknown as Parameters<typeof computeServerCalc>[0], []);
      autoTrackSchedule = buildAutoTrackSchedule(result.data as BroadcastPayload, claimCalc);
    } catch { /* schedule failure must not break the claim response */ }
    res.json({
      ok: true,
      outcome: result.outcome,
      state: result.channelState,
      values: result.values,
      data: result.data,
      autoTrackSchedule,
      snapshotId: syncSnapshotId(result.data),
    });
  } catch (error) {
    req.log.error({
      err: error,
      event: "auto_track_claim",
      channel: claim.channel,
      durationMs: Date.now() - startedAt,
    }, "Auto-track claim failed");
    res.status(500).json({ error: "Automatic tracking could not sync. Please try again." });
  }
});

router.get("/sync/events", async (req: Request, res: Response): Promise<void> => {
  const clientId = (req.query.clientId as string) ?? "";
  const scope = currentScope();
  const watchDate = clientToday(req);
  let closed = false;
  let client: SseClient | undefined;
  let heartbeat: NodeJS.Timeout | undefined;

  // Register this before any awaited work. A browser can abort its wake
  // reconciliation while the initial row lookup is in flight; registering
  // afterward would add a disconnected response to `clients` permanently.
  req.once("close", () => {
    closed = true;
    if (client) clients.delete(client);
    if (heartbeat) clearInterval(heartbeat);
  });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const [row] = await db
    .select()
    .from(dailySyncTable)
    .where(and(eq(dailySyncTable.date, watchDate), eq(dailySyncTable.scope, scope)));
  if (closed) return;
  // Always send a first frame, including when no row exists. The web client uses
  // this acknowledgement as its sync baseline and must not upload local state
  // before it has either applied the row or learned that the row is absent.
  const data = row?.data ?? null;
  const snapshotId = data ? syncSnapshotId(data) : undefined;
  const requested = requestedSnapshot(req);
  let autoTrackSchedule: AutoTrackSchedule | null = null;
  let initialServerCalc: ServerCalcResult | null = null;
  if (data) {
    try {
      initialServerCalc = computeServerCalc(data as Parameters<typeof computeServerCalc>[0], []);
      autoTrackSchedule = buildAutoTrackSchedule(data as BroadcastPayload, initialServerCalc);
    } catch { /* calc failure must not break the baseline frame */ }
  }
  res.write(`data: ${JSON.stringify({
    ...(requested && requested === snapshotId
      ? { unchanged: true, snapshotId }
      : { data, snapshotId }),
    senderId: null,
    initial: true,
    serverCalc: initialServerCalc,
    autoTrackSchedule,
  })}\n\n`);

  // Record the client's local date so broadcasts only reach peers on the SAME
  // calendar day (see broadcast). Matches the initial-row lookup above.
  client = { res, clientId, scope, watchDate };
  clients.add(client);

  // Schedule-bearing heartbeat (refactor step 6c): the existing 15s keepalive
  // ping now carries the server-computed auto-track schedule instead of an
  // empty comment — same connection, same cadence, zero extra request traffic.
  // The frame is sent DELTA-ONLY (skipped while the schedule is unchanged;
  // atMs is excluded from the comparison because it changes every compute), so
  // clients continuously converge on the server's due times/verdicts and the
  // local derivation stays a fallback. A failed beat never kills the stream.
  // Tests override the interval via AUTO_TRACK_HEARTBEAT_MS (read per request
  // so a suite can set it without rebuilding the app).
  let lastBeatScheduleKey: string | null = null;
  heartbeat = setInterval(() => {
    void (async () => {
      if (closed) return;
      let frame: string | null = null;
      try {
        const [freshRow] = await db
          .select()
          .from(dailySyncTable)
          .where(and(eq(dailySyncTable.date, watchDate), eq(dailySyncTable.scope, scope)));
        const freshData = freshRow?.data ?? null;
        if (freshData) {
          const calc = computeServerCalc(freshData as Parameters<typeof computeServerCalc>[0], []);
          const freshSchedule = buildAutoTrackSchedule(freshData as BroadcastPayload, calc);
          if (freshSchedule) {
            const key = JSON.stringify({ generation: freshSchedule.generation, entries: freshSchedule.entries });
            if (key !== lastBeatScheduleKey) {
              lastBeatScheduleKey = key;
              frame = `data: ${JSON.stringify({ autoTrackSchedule: freshSchedule, heartbeat: true })}\n\n`;
            }
          }
        }
      } catch { /* a failed compute/read must not tear the connection down */ }
      try {
        res.write(frame ?? ": heartbeat\n\n");
      } catch { /* connection already closed */ }
    })();
  }, Number(process.env.AUTO_TRACK_HEARTBEAT_MS) || 15_000);
});

// ── Scheduled (future) days ──────────────────────────────────────────────────
// NOTE: /sync/scheduled must be declared before /sync/:date so Express doesn't
// treat "scheduled" as a date param.

router.get("/sync/scheduled", async (req: Request, res: Response): Promise<void> => {
  const includeRuns = req.query.include === "runs";
  // "Future" is relative to the CLIENT's local date (see clientToday): filtering
  // by the server's UTC date would make a user behind UTC lose their local
  // "tomorrow" a day early.
  const rows = await db
    .select()
    .from(dailySyncTable)
    .where(and(gt(dailySyncTable.date, clientToday(req)), eq(dailySyncTable.scope, currentScope())))
    .orderBy(asc(dailySyncTable.date));

  res.json(
    rows.map(r => {
      const data = r.data as any;
      const runs: Array<{ brand: string; flavor: string }> = data?.dayState?.runs ?? [];

      const runValues: Record<string, any> = data?.runValues ?? {};
      const base: Record<string, unknown> = {
        date: r.date,
        runCount: runs.length,
      };
      if (includeRuns) {
        base.runs = runs.map((run: any) => ({
          id: run.id ?? "",
          brand: run.brand ?? "",
          flavor: run.flavor ?? "",
          casesNeeded: runValues[run.id]?.casesNeeded ?? 0,
          dieType: runValues[run.id]?.dieType ?? "",
        }));
      }
      return base;
    })
  );
});

router.get("/sync/:date", async (req: Request<{ date: string }>, res: Response): Promise<void> => {
  const { date } = req.params;
  if (!isValidDate(date)) { res.status(400).json({ error: "Invalid date format" }); return; }
  const [row] = await db
    .select()
    .from(dailySyncTable)
    .where(and(eq(dailySyncTable.date, date), eq(dailySyncTable.scope, currentScope())));
  const data = row?.data ?? null;
  if (unchangedResponse(res, data, requestedSnapshot(req))) return;
  if (data) res.setHeader("X-Sync-Snapshot", syncSnapshotId(data));
  res.json(data);
});

router.put("/sync/:date", async (req: Request<{ date: string }>, res: Response): Promise<void> => {
  const { date } = req.params;
  if (!isValidDate(date)) { res.status(400).json({ error: "Invalid date format" }); return; }
  const { senderId = "", payload, snapshotId: requestedId, syncMeta } = req.body as {
    senderId?: string;
    payload: unknown;
    snapshotId?: unknown;
    syncMeta?: unknown;
  };
    const scope = currentScope();

  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    res.status(400).json({ error: "payload must be a JSON object" }); return;
  }
  const sanitized = sanitizeSyncPayload(payload);
  if (isSyncPayloadTooLarge(sanitized)) { res.status(400).json({ error: "Payload too large" }); return; }
  const staleEpoch = await isStaleResetPush(req, scope);
  if (staleEpoch !== null) { res.setHeader("X-Sync-Response", "stale"); res.json({ ok: true, stale: true, epoch: staleEpoch }); return; }
  const result = await upsertProtected(date, scope, sanitized, clientToday(req), req.ip);
  const merged = result.data;
  // Broadcast to live SSE clients when writing today's date (supports same-day
  // watchers). "Today" is the client's local date, matching /sync/today's keying.
  if (result.wrote && date === clientToday(req)) {
    broadcast(merged, senderId, scope, date);
  }
  const snapshotId = merged === null ? undefined : syncSnapshotId(merged);
  res.setHeader("X-Sync-Response", !result.partialFallback && snapshotId !== undefined && requestedId === snapshotId
    ? "unchanged"
    : result.partialFallback ? "partial-fallback" : "full");
  res.setHeader("X-Sync-Retry-Count", String(result.retries));
  res.setHeader("X-Sync-Queue-Age-Ms", String(queueAgeMs(syncMeta) ?? ""));
  res.setHeader("X-Sync-Convergence", result.wrote ? "written" : "fallback");
  const responseBody = !result.partialFallback && snapshotId !== undefined && requestedId === snapshotId
    ? { ok: true, unchanged: true, snapshotId }
    : {
      ok: true,
      data: merged,
      ...(snapshotId ? { snapshotId } : {}),
      ...(result.partialFallback ? { partialFallback: true } : {}),
    };
  res.setHeader("X-Sync-Response-Bytes", String(Buffer.byteLength(JSON.stringify(responseBody))));
  res.json(responseBody);
});

router.delete("/sync/:date", requireCapability("manage-factory-settings"), async (req: Request<{ date: string }>, res: Response): Promise<void> => {
  const { date } = req.params;
  if (!isValidDate(date)) { res.status(400).json({ error: "Invalid date format" }); return; }
  // Use server date (not client-supplied ?today=) so the past-date guard cannot be bypassed
  if (date <= todayStr()) { res.status(400).json({ error: "Cannot delete today or past days" }); return; }
  await db
    .delete(dailySyncTable)
    .where(and(eq(dailySyncTable.date, date), eq(dailySyncTable.scope, currentScope())));
  res.json({ ok: true });
});

// ── Full data reset (admin-only) ─────────────────────────────────────────────
// The single, reliable "wipe back to a clean slate" action. In ONE transaction it
// deletes every daily_sync row for the caller's scope (today + all scheduled days)
// and bumps the scope's reset epoch. It then broadcasts a reset frame so open tabs
// wipe and reload immediately, and the epoch guard on PUT rejects any in-flight
// stale push — so the cleared state can't be re-adopted and re-uploaded by a
// populated client. Manager-only; scope-isolated (a live reset never touches the
// sandbox and vice-versa).
router.post(
  "/sync/reset",
  requireCapability("manage-staff"),
  async (_req: Request, res: Response): Promise<void> => {
    const scope = currentScope();
    const actor = (_req as any).user?.username || "unknown";
    const epoch = await db.transaction(async (tx) => {
      await tx.delete(dailySyncTable).where(eq(dailySyncTable.scope, scope));
      const [row] = await tx
        .insert(dataResetTable)
        .values({ scope, epoch: 1, resetAt: new Date() })
        .onConflictDoUpdate({
          target: dataResetTable.scope,
          set: { epoch: sql`${dataResetTable.epoch} + 1`, resetAt: new Date() },
        })
        .returning();
      return row?.epoch ?? 0;
    });
    // Best-effort audit log — never fails the reset
    void logAuditEvent(
      scope,
      actor,
      "factory_reset",
      "daily_sync",
      { scope },
      _req.ip,
      _req.headers["user-agent"] as string | undefined,
    );
    broadcastReset(scope, epoch);
    res.json({ ok: true, epoch });
  },
);

// ── Full FACTORY purge (admin-only) ──────────────────────────────────────────
// Wipes EVERYTHING except accounts: all day-state (like /sync/reset) PLUS every
// server master-data pool — profiles, recipes (cheese/dough/sauce), mixes,
// ingredients, learned aliases/corrections, AI memory, incidents, inventory,
// production rules, templates, saved import sheets, settings. `users`/`roles`/
// `user_roles` (and pending password-reset requests) are untouched. Scoped
// tables are cleared for the CALLER's scope only; the few scope-less
// operational tables (legacy saved runs, quality history, alert settings) are
// cleared outright. The reset epoch is bumped and broadcast exactly like
// /sync/reset, so every populated client wipes its local `run-calc*` copy and
// reloads instead of re-uploading stale data.
router.post(
  "/sync/purge-all",
  requireCapability("manage-staff"),
  async (_req: Request, res: Response): Promise<void> => {
    const scope = currentScope();
    const scopedTables = [
      dailySyncTable,
      brandProfilesTable,
      cheeseRecipesTable,
      doughRecipesTable,
      sauceRecipesTable,
      mixesTable,
      ingredientsTable,
      ingredientBatchWeightsTable,
      importAliasesTable,
      specImportAliasesTable,
      photoAliasesTable,
      mergeAliasesTable,
      deniedMergesTable,
      mergedAwayTable,
      aiCorrectionsTable,
      facilityKnowledgeTable,
      fillMissingValuesTable,
      freezerPullItemsTable,
      incidentsTable,
      productionRulesTable,
      runTemplatesTable,
      savedSpecSheetsTable,
      savedShippingGuidesTable,
      savedPremixSheetsTable,
      supervisorPinSettingsTable,
      cycleCountSchedulesTable,
      // Operational tables that are now scope-isolated.
      productionRunsTable,
      qualityChecksTable,
      proactiveAlertSettingsTable,
      // Inventory tables child-first so FK constraints never block the wipe.
      inventoryLedgerTable,
      inventoryLotsTable,
      inventoryConsumedRunsTable,
      inventorySettingsTable,
      inventoryItemsTable,
      inventoryLocationsTable,
    ] as const;
    // sandbox_meta has no scope column — clearing it just forces the sandbox to
    // re-copy from live next time, which is the correct post-purge behavior.
    // ai_conversation_turns is naturally isolated by userId (sandbox users have
    // distinct user accounts) so wiping all turns is acceptable here.
    const globalTables = [
      // Per-user AI chat history (keyed by userId, no scope column).
      aiConversationTurnsTable,
      sandboxMetaTable,
    ] as const;
    const epoch = await db.transaction(async (tx) => {
      for (const t of scopedTables) {
        await tx.execute(sql`DELETE FROM ${t} WHERE scope = ${scope}`);
      }
      for (const t of globalTables) {
        await tx.execute(sql`DELETE FROM ${t}`);
      }
      const [row] = await tx
        .insert(dataResetTable)
        .values({ scope, epoch: 1, resetAt: new Date() })
        .onConflictDoUpdate({
          target: dataResetTable.scope,
          set: { epoch: sql`${dataResetTable.epoch} + 1`, resetAt: new Date() },
        })
        .returning();
      return row?.epoch ?? 0;
    });
    broadcastReset(scope, epoch);
    res.json({ ok: true, epoch });
  },
);

// ── Server-owned auto-track tick loop (refactor steps 7a/7b) ────────────────
// Runs the NET-SECOND channels (sauce barrel, applicator batches) AND the
// WALL-CLOCK channels (case/tray/batch/hopper, step 7b) from the server itself
// so runs keep auto-tracking even when every device is closed. Net-second
// claims are pure stored-state math; wall-clock claims mirror the client's
// arm-state machines through the shared tickWallClock engine, with per-run
// bookkeeping persisted atomically under `autoTrackServerState`. Server
// wall-clock execution is limited to FRESH runs (< 6h) with no canonical
// coordination register yet — once any claim (server or client) re-persists a
// canonical nextDueAt, that channel returns to client ownership. Every server
// claim is applied through the EXACT same parse/apply/transaction path as a
// client claim POST, so every safety invariant (sequence, generation,
// correction generation, mutation from-checks, sauce inventory idempotency)
// still holds; a competing client or another server instance simply loses the
// row-lock race and is rejected as stale/duplicate.

const SERVER_TICK_SENDER_ID = "server:tick";
const SERVER_TICK_DEFAULT_MS = 15_000;
const SERVER_TICK_LOOKBACK_DAYS = 45;
const SERVER_TICK_MAX_CLAIMS = 24;

function dateDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Apply one server-built claim with the same row-locked transaction as the
 * claim POST route (sauce inventory consumption + upsert + unique retry). */
async function applyServerClaim(
  date: string,
  scope: Scope,
  claim: AutoTrackClaim,
  nowMs: number,
): Promise<ReturnType<typeof applyAutoTrackClaim>> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(dailySyncTable)
          .where(and(eq(dailySyncTable.date, date), eq(dailySyncTable.scope, scope)))
          .for("update");
        const applied = applyAutoTrackClaim(existing?.data ?? emptySyncData(date), claim, nowMs);
        if (applied.outcome === "accepted") {
          if (applied.inventoryConsumption?.kind === "sauce-barrel") {
            const consumption = applied.inventoryConsumption;
            await consumeSauceBarrelInTransaction(
              tx,
              consumption.runId,
              consumption.barrelIndex,
              consumption.itemKey,
              consumption.qty,
              true,
              consumption.eventId,
            );
          }
          const where = and(eq(dailySyncTable.date, date), eq(dailySyncTable.scope, scope));
          if (existing) {
            await tx.update(dailySyncTable)
              .set({ data: applied.data as any, updatedAt: new Date() })
              .where(where);
          } else {
            await tx.insert(dailySyncTable)
              .values({ date, scope, data: applied.data as any, updatedAt: new Date() });
          }
        }
        return applied;
      });
    } catch (error) {
      if (isUniqueViolation(error) && attempt < 3) continue;
      throw error;
    }
  }
  throw new Error("Server auto-track claim did not complete");
}

export type ServerTickSummary = {
  examinedDates: number;
  builtClaims: number;
  accepted: number;
  outcomes: Record<string, number>;
};

/** Scan the live scope's recent days and apply server-built net-second claims
 * that are due now. Bounded per pass (maxClaims) — anything not reached simply
 * fires on a later beat. Exported for the integration suite; started in
 * production by `startAutoTrackServerTicks`. */
export async function runNetSecondServerTicks(opts: {
  nowMs?: number;
  maxClaims?: number;
} = {}): Promise<ServerTickSummary> {
  const nowMs = opts.nowMs ?? Date.now();
  const maxClaims = opts.maxClaims ?? SERVER_TICK_MAX_CLAIMS;
  // No upper date bound on purpose: the suite seeds historical pseudo-dates,
  // and future rows without a live run simply produce no claims (a run needs a
  // startedAt to be ticked at all).
  const rows = await db
    .select()
    .from(dailySyncTable)
    .where(and(
      eq(dailySyncTable.scope, "live"),
      gte(dailySyncTable.date, dateDaysAgo(SERVER_TICK_LOOKBACK_DAYS)),
    ));
  let builtClaims = 0;
  let accepted = 0;
  const outcomes: Record<string, number> = {};
  for (const row of rows) {
    if (builtClaims >= maxClaims) break;
    let claims: AutoTrackClaim[] = [];
    try {
      claims = buildNetSecondServerClaims(row.data, nowMs);
    } catch { /* an un-computable row simply has no server ticks this beat */ }
    for (const raw of claims) {
      if (builtClaims >= maxClaims) break;
      const parsed = parseAutoTrackClaim(raw, nowMs);
      if (!parsed) {
        outcomes.invalid = (outcomes.invalid ?? 0) + 1;
        continue;
      }
      builtClaims++;
      let result: ReturnType<typeof applyAutoTrackClaim>;
      try {
        result = await applyServerClaim(row.date, "live", parsed, nowMs);
      } catch (error) {
        logger.error({
          err: error,
          event: "server_auto_track_tick",
          date: row.date,
          runId: createHash("sha256").update(parsed.runId).digest("hex").slice(0, 12),
          channel: parsed.channel,
        }, "Server auto-track tick failed");
        outcomes.error = (outcomes.error ?? 0) + 1;
        continue;
      }
      outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
      if (result.outcome === "accepted") {
        accepted++;
        broadcast(result.data, SERVER_TICK_SENDER_ID, "live", row.date);
      }
    }
  }
  if (builtClaims > 0) {
    logger.info({
      event: "server_auto_track_tick",
      examinedDates: rows.length,
      builtClaims,
      accepted,
      outcomes,
    }, "Server auto-track tick pass completed");
  }
  return { examinedDates: rows.length, builtClaims, accepted, outcomes };
}

/** Apply one wall-clock beat for a single row inside a row-locked transaction:
 * build from the LOCKED data + persisted bookkeeping, run every claim through
 * the standard parse/apply path, then persist the next bookkeeping in the same
 * upsert — even on beats with no event (case refs/baseline advance every
 * tick, remainder carries must survive rejection beats). */
async function applyWallClockServerTick(
  date: string,
  scope: Scope,
  nowMs: number,
  claimBudget: number,
): Promise<{
  plan: WallClockServerPlan | null;
  claimsBuilt: number;
  accepted: number;
  outcomes: Record<string, number>;
  broadcastData?: Record<string, unknown>;
}> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(dailySyncTable)
          .where(and(eq(dailySyncTable.date, date), eq(dailySyncTable.scope, scope)))
          .for("update");
        const stored = existing?.data ?? emptySyncData(date);
        const plan = buildWallClockServerClaims(stored, nowMs);
        if (!plan) {
          return { plan: null, claimsBuilt: 0, accepted: 0, outcomes: {} };
        }
        const outcomes: Record<string, number> = {};
        let accepted = 0;
        let data: Record<string, unknown> = stored as Record<string, unknown>;
        const claims = plan.claims.slice(0, claimBudget);
        for (const raw of claims) {
          const parsed = parseAutoTrackClaim(raw, nowMs);
          if (!parsed) {
            outcomes.invalid = (outcomes.invalid ?? 0) + 1;
            continue;
          }
          const applied = applyAutoTrackClaim(data, parsed, nowMs);
          outcomes[applied.outcome] = (outcomes[applied.outcome] ?? 0) + 1;
          if (applied.outcome === "accepted") {
            accepted++;
            data = applied.data;
          }
        }
        const nextData = withWallClockServerState(data, plan.runId, plan.bookkeeping);
        const where = and(eq(dailySyncTable.date, date), eq(dailySyncTable.scope, scope));
        if (existing) {
          await tx.update(dailySyncTable)
            .set({ data: nextData as any, updatedAt: new Date() })
            .where(where);
        } else {
          await tx.insert(dailySyncTable)
            .values({ date, scope, data: nextData as any, updatedAt: new Date() });
        }
        return {
          plan,
          claimsBuilt: claims.length,
          accepted,
          outcomes,
          ...(accepted > 0 ? { broadcastData: nextData } : {}),
        };
      });
    } catch (error) {
      if (isUniqueViolation(error) && attempt < 3) continue;
      throw error;
    }
  }
  throw new Error("Server wall-clock auto-track tick did not complete");
}

/** Scan the live scope's recent days and apply due server-built wall-clock
 * claims (case/tray/batch/hopper bootstrap for fresh runs). Purely additive to
 * the net-second pass; each beat persists the run's arm-state bookkeeping so
 * the state machine never re-bootstraps from zero. */
export async function runWallClockServerTicks(opts: {
  nowMs?: number;
  maxClaims?: number;
} = {}): Promise<ServerTickSummary> {
  const nowMs = opts.nowMs ?? Date.now();
  const maxClaims = opts.maxClaims ?? SERVER_TICK_MAX_CLAIMS;
  const rows = await db
    .select()
    .from(dailySyncTable)
    .where(and(
      eq(dailySyncTable.scope, "live"),
      gte(dailySyncTable.date, dateDaysAgo(SERVER_TICK_LOOKBACK_DAYS)),
    ));
  let builtClaims = 0;
  let accepted = 0;
  const outcomes: Record<string, number> = {};
  for (const row of rows) {
    if (builtClaims >= maxClaims) break;
    let result: Awaited<ReturnType<typeof applyWallClockServerTick>>;
    try {
      result = await applyWallClockServerTick(row.date, "live", nowMs, maxClaims - builtClaims);
    } catch (error) {
      logger.error({
        err: error,
        event: "server_wall_clock_tick",
        date: row.date,
      }, "Server wall-clock auto-track tick failed");
      outcomes.error = (outcomes.error ?? 0) + 1;
      continue;
    }
    if (!result.plan) continue;
    builtClaims += result.claimsBuilt;
    accepted += result.accepted;
    for (const [outcome, count] of Object.entries(result.outcomes)) {
      outcomes[outcome] = (outcomes[outcome] ?? 0) + count;
    }
    if (result.broadcastData) broadcast(result.broadcastData, SERVER_TICK_SENDER_ID, "live", row.date);
  }
  if (builtClaims > 0) {
    logger.info({
      event: "server_wall_clock_tick",
      examinedDates: rows.length,
      builtClaims,
      accepted,
      outcomes,
    }, "Server wall-clock auto-track tick pass completed");
  }
  return { examinedDates: rows.length, builtClaims, accepted, outcomes };
}

/** App-level ticker (deferred/unref'd so it never blocks shutdown). Reads the
 * interval from AUTO_TRACK_SERVER_TICK_MS (default 15s) and skips a pass that
 * is still running from the previous beat. */
export function startAutoTrackServerTicks(): NodeJS.Timeout {
  const intervalMs = Math.max(5_000, Number(process.env.AUTO_TRACK_SERVER_TICK_MS ?? SERVER_TICK_DEFAULT_MS));
  let running = false;
  const tick = (): void => {
    if (running) return;
    running = true;
    runNetSecondServerTicks()
      .catch((err: unknown) => {
        logger.error({ err, event: "server_auto_track_tick" }, "Server auto-track tick pass failed");
      })
      .then(() => runWallClockServerTicks())
      .catch((err: unknown) => {
        logger.error({ err, event: "server_wall_clock_tick" }, "Server wall-clock auto-track tick pass failed");
      })
      .finally(() => { running = false; });
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return timer;
}

export default router;
