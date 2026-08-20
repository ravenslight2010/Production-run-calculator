import { Router, type IRouter, type Request, type Response } from "express";
import { createHash } from "crypto";
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
import { and, eq, gt, asc, sql } from "drizzle-orm";
import { currentScope, type Scope } from "../lib/requestScope";
import { protectRunValues, sanitizeSyncPayload, isSyncPayloadTooLarge, capMergedResult } from "../lib/protectRunValues";
import { logAuditEvent } from "./auditLogs";
import { healNaturalPepInValues, healNaturalPepList } from "../lib/dataHeals";
import { requireCapability } from "../middlewares/requireCapability";

const router: IRouter = Router();

type SseClient = { res: Response; clientId: string; scope: Scope; watchDate: string };
const clients = new Set<SseClient>();

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
function broadcast(data: unknown, senderId: string, scope: Scope, date: string): void {
  const msg = `data: ${JSON.stringify({ data, senderId })}\n\n`;
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

// ── Sync conflict detection ──────────────────────────────────────────────────
// Compares incoming vs merged payloads to find fields where the protective
// merge kept the stored value instead of the incoming one. Conflicts include:
//   - run values that were overridden (blank-over-populated or stale-stamp)
//   - runs appended from the stored row that the push omitted (run-list union)
// Returns null when no merge protection was actually applied.
function shortHash(v: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(v) ?? "")
    .digest("hex")
    .slice(0, 16);
}

interface ConflictInfo {
  fieldsWithConflicts: string[];
  conflictCount: number;
  clientStateHash: string;
  serverStateHash: string;
  mergedStateHash: string;
}

function detectConflicts(
  incoming: unknown,
  existing: unknown,
  merged: unknown,
): ConflictInfo | null {
  if (
    !incoming || typeof incoming !== "object" ||
    !existing || typeof existing !== "object" ||
    !merged || typeof merged !== "object"
  ) {
    return null;
  }

  const inObj  = incoming as Record<string, unknown>;
  const merObj = merged   as Record<string, unknown>;

  const fields: string[] = [];

  // Run values that the merge overrode (blank-over-populated or stale stamp).
  const inVals  = (inObj.runValues  && typeof inObj.runValues  === "object" && !Array.isArray(inObj.runValues))  ? inObj.runValues  as Record<string, unknown> : {};
  const merVals = (merObj.runValues && typeof merObj.runValues === "object" && !Array.isArray(merObj.runValues)) ? merObj.runValues as Record<string, unknown> : {};
  for (const id of Object.keys(inVals)) {
    if (JSON.stringify(inVals[id]) !== JSON.stringify(merVals[id])) {
      fields.push(`runValues:${id}`);
    }
  }

  // Index incoming run objects by id so we can compare against the merged list.
  const inRunMap = new Map<string, unknown>();
  for (const r of (Array.isArray((inObj.dayState as any)?.runs)
    ? (inObj.dayState as any).runs as unknown[]
    : [])
  ) {
    if (r && typeof r === "object") {
      const id = (r as Record<string, unknown>).id;
      if (typeof id === "string" && id) inRunMap.set(id, r);
    }
  }

  // Walk merged run list to find two kinds of protective outcomes:
  //   1. Appended runs: present in merged but absent from incoming (server rescued them).
  //   2. Meta-LWW overrides: same id in both but objects differ, meaning the stored
  //      copy had a strictly-newer metaUpdatedAt and replaced the incoming one.
  const merRuns: unknown[] = Array.isArray((merObj.dayState as any)?.runs)
    ? (merObj.dayState as any).runs as unknown[]
    : [];
  let appendedCount = 0;
  for (const r of merRuns) {
    if (!r || typeof r !== "object") continue;
    const id = (r as Record<string, unknown>).id;
    if (typeof id !== "string" || !id) continue;
    if (!inRunMap.has(id)) {
      appendedCount++;
    } else if (JSON.stringify(r) !== JSON.stringify(inRunMap.get(id))) {
      // Stored run object replaced the incoming one via the metaUpdatedAt LWW.
      fields.push(`dayState.runs.meta:${id}`);
    }
  }
  if (appendedCount > 0) {
    fields.push(`dayState.runs:appended(${appendedCount})`);
  }

  if (fields.length === 0) return null;

  return {
    fieldsWithConflicts: fields,
    conflictCount: fields.length,
    clientStateHash: shortHash(incoming),
    serverStateHash: shortHash(existing),
    mergedStateHash: shortHash(merged),
  };
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

async function upsertProtected(
  date: string,
  scope: Scope,
  payload: unknown,
  clientTodayDate: string,
  clientIp?: string,
): Promise<unknown> {
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
        // Only a FUTURE scheduled row may use resetAt to replace its run list.
        // Today's row must always be additive/tombstone-driven: a new device can
        // hold a newer local marker before it receives this row, but that marker
        // must never erase other operators' scheduled or live runs.
        const m = capMergedResult(protectRunValues(payload, existing?.data, {
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
        return m;
      });
      // Conflict detection and logging happen outside the transaction so a
      // logging failure can never roll back the actual sync write.
      const conflict = detectConflicts(payload, existingData, merged);
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
  res.json(row?.data ?? null);
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
  const { senderId = "", payload } = req.body as { senderId?: string; payload: unknown };
  const today = clientToday(req);
  const scope = currentScope();

  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    res.status(400).json({ error: "payload must be a JSON object" }); return;
  }
  const sanitized = sanitizeSyncPayload(payload);
  if (isSyncPayloadTooLarge(sanitized)) { res.status(400).json({ error: "Payload too large" }); return; }

  const staleEpoch = await isStaleResetPush(req, scope);
  if (staleEpoch !== null) { res.json({ ok: true, stale: true, epoch: staleEpoch }); return; }
  const merged = await upsertProtected(today, scope, sanitized, today, req.ip);
  // Broadcast the merged result (not the raw push) so peers converge on the same
  // protected state the row was written with.
  broadcast(merged, senderId, scope, today);
  res.json({ ok: true });
});

router.get("/sync/events", async (req: Request, res: Response): Promise<void> => {
  const clientId = (req.query.clientId as string) ?? "";
  const scope = currentScope();
  const watchDate = clientToday(req);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const [row] = await db
    .select()
    .from(dailySyncTable)
    .where(and(eq(dailySyncTable.date, watchDate), eq(dailySyncTable.scope, scope)));
  // Always send a first frame, including when no row exists. The web client uses
  // this acknowledgement as its sync baseline and must not upload local state
  // before it has either applied the row or learned that the row is absent.
  res.write(`data: ${JSON.stringify({ data: row?.data ?? null, senderId: null, initial: true })}\n\n`);

  // Record the client's local date so broadcasts only reach peers on the SAME
  // calendar day (see broadcast). Matches the initial-row lookup above.
  const client: SseClient = { res, clientId, scope, watchDate };
  clients.add(client);

  const heartbeat = setInterval(() => {
    try { res.write(": heartbeat\n\n"); } catch {}
  }, 15_000);

  req.on("close", () => {
    clients.delete(client);
    clearInterval(heartbeat);
  });
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
  res.json(row?.data ?? null);
});

router.put("/sync/:date", async (req: Request<{ date: string }>, res: Response): Promise<void> => {
  const { date } = req.params;
  if (!isValidDate(date)) { res.status(400).json({ error: "Invalid date format" }); return; }
  const { senderId = "", payload } = req.body as { senderId?: string; payload: unknown };
  const scope = currentScope();

  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    res.status(400).json({ error: "payload must be a JSON object" }); return;
  }
  const sanitized = sanitizeSyncPayload(payload);
  if (isSyncPayloadTooLarge(sanitized)) { res.status(400).json({ error: "Payload too large" }); return; }

  const staleEpoch = await isStaleResetPush(req, scope);
  if (staleEpoch !== null) { res.json({ ok: true, stale: true, epoch: staleEpoch }); return; }
  const merged = await upsertProtected(date, scope, sanitized, clientToday(req), req.ip);
  // Broadcast to live SSE clients when writing today's date (supports same-day
  // watchers). "Today" is the client's local date, matching /sync/today's keying.
  if (date === clientToday(req)) {
    broadcast(merged, senderId, scope, date);
  }
  res.json({ ok: true });
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
      // Reset only wipes the shared day-state for this scope. Master-data
      // (profiles, recipes, etc.) is preserved. Use /sync/purge-all to wipe
      // everything. Scope-isolated: live never touches sandbox.
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

export default router;
