import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, gt, isNull, or, type SQL } from "drizzle-orm";
import {
  db,
  inventoryItemsTable,
  inventoryLotsTable,
  inventoryLedgerTable,
  inventoryConsumedRunsTable,
  inventoryLocationsTable,
  inventorySettingsTable,
  qualityChecksTable,
  dailySyncTable,
  type InventoryLot,
  type InventoryLocation,
} from "@workspace/db";
import {
  computeRunConsumptionLines,
  applySubstitutions,
  type RunLinesInput,
  type IngredientSubstitution,
} from "@workspace/inventory-math";
import {
  CreateInventoryItemBody,
  UpdateInventoryItemBody,
  RestockInventoryBody,
  AdjustInventoryBody,
  ConsumeInventoryBody,
  MergeInventoryBody,
  CreateInventoryLocationBody,
  UpdateInventoryLocationBody,
  TransferInventoryBody,
  UpdateInventorySettingsBody,
} from "@workspace/api-zod";
import { openai, pickModel } from "@workspace/integrations-openai-ai-server";
import { fetchModelJsonWithRetry } from "../lib/aiJsonRetry";
import { rateLimit } from "../middlewares/rateLimit";
import { PostgresRateLimitStore } from "../middlewares/rateLimitStore";
import { requireCapability } from "../middlewares/requireCapability";
import { getOrCreateUserRole, getStaffMember } from "../lib/roles";
import { sanitizeGuesses, validateIdentifyPhotoBody } from "./photoIdentify";
import {
  buildQualityPrompt,
  sanitizeAssessment,
  validateQualityPhotoBody,
} from "./qualityPhoto";
import {
  buildProductionSheetPrompt,
  sanitizeSheetRows,
  validateProductionSheetBody,
} from "./productionSheetPhoto";
import {
  buildLabelVerifyPrompt,
  expectedToMap,
  sanitizeLabelVerification,
  validateLabelVerifyBody,
} from "./labelVerify";
import {
  parseHistoryFilter,
  rowToRecord,
  validateRecordQualityCheckBody,
} from "./qualityChecks";
import {
  buildWastePrompt,
  flagExpiringItems,
  sanitizeWasteSuggestion,
  validateWasteInsightBody,
  type FlaggableItem,
} from "./wasteInsight";
import { groundPromptWithMemory, recordFacilityKnowledge } from "./aiMemoryContext";
import {
  applyRunConsumption,
  planDrawDown,
  sortLotsForConsumption,
  type ConsumeLine,
} from "./inventoryLogic";
import { currentScope } from "../lib/requestScope";

const router: IRouter = Router();

// Cost/abuse guards for the paid AI vision endpoint. All routes require a
// signed-in user, so cap per-user (falling back to IP) rather than per-IP only.
// Size/shape guards live in photoIdentify.ts.
const PHOTO_RATE_WINDOW_MS = 60_000;
const PHOTO_RATE_MAX = 10; // requests per user per minute

// In production the API may run with more than one instance, so the cost cap is
// backed by a shared Postgres store to keep it effective across instances.
// Everywhere else (dev/test, a single process) the limiter falls back to its
// in-memory store — identical behavior and headers, no DB dependency.
const photoRateStore =
  process.env.NODE_ENV === "production"
    ? new PostgresRateLimitStore(PHOTO_RATE_WINDOW_MS)
    : undefined;

// The quality-check (vision) and waste-insight (text) AI endpoints get their own
// cost caps so they can't starve each other or the stock-intake limiter. Same
// per-user posture and Postgres-in-prod backing as the photo limiter above.
const qualityRateStore =
  process.env.NODE_ENV === "production"
    ? new PostgresRateLimitStore(PHOTO_RATE_WINDOW_MS)
    : undefined;
const wasteRateStore =
  process.env.NODE_ENV === "production"
    ? new PostgresRateLimitStore(PHOTO_RATE_WINDOW_MS)
    : undefined;

// The two vision-expansion endpoints (production-sheet transcription and
// label/pallet verification) get their own cost caps for the same reason —
// same per-user posture and Postgres-in-prod backing as the limiters above.
const productionSheetRateStore =
  process.env.NODE_ENV === "production"
    ? new PostgresRateLimitStore(PHOTO_RATE_WINDOW_MS)
    : undefined;
const labelVerifyRateStore =
  process.env.NODE_ENV === "production"
    ? new PostgresRateLimitStore(PHOTO_RATE_WINDOW_MS)
    : undefined;

// ── SSE: any inventory change pings connected clients to refetch ──────────────
type SseClient = { res: Response; clientId: string; scope: string };
const clients = new Set<SseClient>();

// Only ping clients watching the SAME data scope so a sandbox change never nudges
// a live watcher to refetch (and vice-versa). The refetch itself is scoped too,
// but keeping the ping scoped avoids needless cross-scope traffic.
function broadcast(senderId: string, scope: string): void {
  const msg = `data: ${JSON.stringify({ type: "inventory", senderId })}\n\n`;
  for (const client of clients) {
    if (client.scope === scope && client.clientId !== senderId) {
      try {
        client.res.write(msg);
      } catch {
        /* client gone; cleaned up on close */
      }
    }
  }
}

// ── Locations ────────────────────────────────────────────────────────────────
// The default name given to the implicitly-created onsite/line location. Stock
// without an explicit location (legacy/pre-feature lots) is treated as onsite;
// once any location work happens, those null lots are backfilled to this row.
const DEFAULT_ONSITE_NAME = "Onsite (Line)";

async function getOnsiteLocation(scope: string): Promise<InventoryLocation | undefined> {
  const [row] = await db
    .select()
    .from(inventoryLocationsTable)
    .where(and(eq(inventoryLocationsTable.scope, scope), eq(inventoryLocationsTable.isOnsite, true)))
    .limit(1);
  return row;
}

async function listLocations(scope: string): Promise<InventoryLocation[]> {
  return db
    .select()
    .from(inventoryLocationsTable)
    .where(eq(inventoryLocationsTable.scope, scope))
    .orderBy(desc(inventoryLocationsTable.isOnsite), inventoryLocationsTable.name);
}

// Read-only: the current onsite location id, or null if no location rows exist
// yet (in which case all stock is implicitly onsite). Used by the consume/adjust
// paths so they never create rows as a side effect (keeps those paths pure for
// integration tests that seed null-location lots).
async function resolveOnsiteLocationId(): Promise<number | null> {
  const row = await getOnsiteLocation(currentScope());
  return row?.id ?? null;
}

// Guarantee an onsite location exists for the scope, creating the default one on
// demand and backfilling any pre-feature null-location lots to it. Called by the
// read/restock/transfer/location-CRUD routes (never by consume/adjust).
async function ensureOnsiteLocation(): Promise<InventoryLocation> {
  const scope = currentScope();
  const existing = await getOnsiteLocation(scope);
  if (existing) return existing;
  await db
    .insert(inventoryLocationsTable)
    .values({ scope, name: DEFAULT_ONSITE_NAME, isOnsite: true })
    .onConflictDoNothing({ target: [inventoryLocationsTable.name, inventoryLocationsTable.scope] });
  let onsite = await getOnsiteLocation(scope);
  if (!onsite) {
    // The default-named row exists but wasn't flagged onsite (edge/race) — promote it.
    await db
      .update(inventoryLocationsTable)
      .set({ isOnsite: true })
      .where(
        and(
          eq(inventoryLocationsTable.scope, scope),
          eq(inventoryLocationsTable.name, DEFAULT_ONSITE_NAME),
        ),
      );
    onsite = await getOnsiteLocation(scope);
  }
  if (!onsite) throw new Error("failed to establish onsite location");
  // Backfill legacy/pre-feature null-location lots so they count as onsite stock.
  await db
    .update(inventoryLotsTable)
    .set({ locationId: onsite.id })
    .where(and(eq(inventoryLotsTable.scope, scope), isNull(inventoryLotsTable.locationId)));
  return onsite;
}

// Lot predicate for an onsite drawdown: lots explicitly at the onsite location
// PLUS any still-null lots (which mean onsite). When no onsite row exists yet,
// every lot is null === onsite, so the predicate is just `locationId IS NULL`.
function onsiteLotCond(onsiteId: number | null): SQL | undefined {
  return onsiteId == null
    ? isNull(inventoryLotsTable.locationId)
    : or(eq(inventoryLotsTable.locationId, onsiteId), isNull(inventoryLotsTable.locationId));
}

type LocationStockOut = {
  locationId: number;
  locationName: string;
  isOnsite: boolean;
  onHand: number;
};

// Per-location on-hand breakdown for one item. Null-location lots fold into the
// onsite row. Onsite is always listed (even at 0) for display; other locations
// appear only when they hold stock.
function computeByLocation(
  lots: InventoryLot[],
  locations: InventoryLocation[],
  onsiteId: number | null,
): LocationStockOut[] {
  const totals = new Map<number, number>();
  for (const lot of lots) {
    const lid = lot.locationId ?? onsiteId;
    if (lid == null) continue;
    totals.set(lid, (totals.get(lid) ?? 0) + lot.qtyRemaining);
  }
  const out: LocationStockOut[] = [];
  for (const loc of locations) {
    const onHand = totals.get(loc.id) ?? 0;
    if (onHand > 0 || loc.isOnsite) {
      out.push({ locationId: loc.id, locationName: loc.name, isOnsite: loc.isOnsite, onHand });
    }
  }
  return out;
}

// ── Serialization ────────────────────────────────────────────────────────────
async function loadItemResponse(itemId: number) {
  const [item] = await db
    .select()
    .from(inventoryItemsTable)
    .where(and(eq(inventoryItemsTable.id, itemId), eq(inventoryItemsTable.scope, currentScope())));
  if (!item) return null;
  const lots = await db
    .select()
    .from(inventoryLotsTable)
    .where(and(eq(inventoryLotsTable.itemId, itemId), eq(inventoryLotsTable.scope, currentScope())));
  const locations = await listLocations(currentScope());
  const onsiteId = locations.find((l) => l.isOnsite)?.id ?? null;
  const sortedLots = sortLotsForConsumption(lots);
  const onHand = lots.reduce((acc, l) => acc + l.qtyRemaining, 0);
  return {
    ...item,
    onHand,
    lots: sortedLots,
    byLocation: computeByLocation(lots, locations, onsiteId),
  };
}

// Executor type shared by the top-level db handle and a transaction handle, so
// drawDown can run either standalone or inside a transaction.
type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Draw `qty` out of an item's lots in FIFO/FEFO order. Never goes negative;
// returns how much was actually consumed (may be less than requested). The
// ordering and never-negative math live in planDrawDown (pure, unit-tested);
// this wrapper only adds the locking read and persists the planned updates.
export async function drawDown(
  exec: Executor,
  itemId: number,
  qty: number,
  locationCond?: SQL,
): Promise<number> {
  if (qty <= 0) return 0;
  // Lock the item's lot rows FOR UPDATE so concurrent consume/adjust transactions
  // for the same item serialize here instead of reading the same stale quantities
  // and writing conflicting qtyRemaining values (lost updates / on-hand drift).
  // When a location predicate is supplied, the drawdown is restricted to that
  // location's lots (production deducts onsite-only); omitting it draws from all
  // lots (kept for the standalone integration path).
  const conds = [
    eq(inventoryLotsTable.itemId, itemId),
    eq(inventoryLotsTable.scope, currentScope()),
    gt(inventoryLotsTable.qtyRemaining, 0),
  ];
  if (locationCond) conds.push(locationCond);
  const lots = await exec
    .select()
    .from(inventoryLotsTable)
    .where(and(...conds))
    .for("update");
  const { consumed, updates } = planDrawDown(lots, qty);
  for (const update of updates) {
    await exec
      .update(inventoryLotsTable)
      .set({ qtyRemaining: update.qtyRemaining })
      .where(eq(inventoryLotsTable.id, update.id));
  }
  return consumed;
}

// ── Routes ───────────────────────────────────────────────────────────────────

router.get("/inventory", async (_req, res): Promise<void> => {
  const onsite = await ensureOnsiteLocation();
  const locations = await listLocations(currentScope());
  const items = await db
    .select()
    .from(inventoryItemsTable)
    .where(eq(inventoryItemsTable.scope, currentScope()))
    .orderBy(inventoryItemsTable.category, inventoryItemsTable.name);
  const allLots = await db
    .select()
    .from(inventoryLotsTable)
    .where(eq(inventoryLotsTable.scope, currentScope()));
  const lotsByItem = new Map<number, InventoryLot[]>();
  for (const lot of allLots) {
    const arr = lotsByItem.get(lot.itemId) ?? [];
    arr.push(lot);
    lotsByItem.set(lot.itemId, arr);
  }
  const out = items.map((item) => {
    const lots = lotsByItem.get(item.id) ?? [];
    return {
      ...item,
      onHand: lots.reduce((acc, l) => acc + l.qtyRemaining, 0),
      lots: sortLotsForConsumption(lots),
      byLocation: computeByLocation(lots, locations, onsite.id),
    };
  });
  res.json(out);
});

router.post("/inventory/items", requireCapability("manage-inventory"), async (req, res): Promise<void> => {
  const parsed = CreateInventoryItemBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid inventory item body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { key, category, name, unit, reorderThreshold } = parsed.data;
  const [item] = await db
    .insert(inventoryItemsTable)
    .values({ key, category, name, unit, reorderThreshold: reorderThreshold ?? 0, scope: currentScope() })
    .onConflictDoUpdate({
      target: [inventoryItemsTable.key, inventoryItemsTable.scope],
      set: {
        name,
        unit,
        category,
        ...(reorderThreshold != null ? { reorderThreshold } : {}),
        updatedAt: new Date(),
      },
    })
    .returning();
  broadcast(headerSenderId(req), currentScope());
  res.status(201).json(await loadItemResponse(item.id));
});

router.patch("/inventory/items/:id", requireCapability("manage-inventory"), async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id == null) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateInventoryItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.name != null) set.name = parsed.data.name;
  if (parsed.data.reorderThreshold != null) set.reorderThreshold = parsed.data.reorderThreshold;
  const [updated] = await db
    .update(inventoryItemsTable)
    .set(set)
    .where(and(eq(inventoryItemsTable.id, id), eq(inventoryItemsTable.scope, currentScope())))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  broadcast(headerSenderId(req), currentScope());
  res.json(await loadItemResponse(id));
});

router.delete("/inventory/items/:id", requireCapability("manage-inventory"), async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id == null) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [deleted] = await db
    .delete(inventoryItemsTable)
    .where(and(eq(inventoryItemsTable.id, id), eq(inventoryItemsTable.scope, currentScope())))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  broadcast(headerSenderId(req), currentScope());
  res.sendStatus(204);
});

router.post("/inventory/restock", async (req, res): Promise<void> => {
  const parsed = RestockInventoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { itemKey, category, name, unit, qty, lotNumber, receivedDate, expirationDate, locationId } =
    parsed.data;
  if (qty <= 0) {
    res.status(400).json({ error: "qty must be positive" });
    return;
  }
  // New stock lands at a location: the caller's explicit location if valid for
  // this scope, otherwise the onsite/line location (created on demand).
  const onsite = await ensureOnsiteLocation();
  let targetLocationId = onsite.id;
  if (locationId != null) {
    const [loc] = await db
      .select()
      .from(inventoryLocationsTable)
      .where(
        and(eq(inventoryLocationsTable.id, locationId), eq(inventoryLocationsTable.scope, currentScope())),
      );
    if (!loc) {
      res.status(400).json({ error: "Unknown location" });
      return;
    }
    targetLocationId = loc.id;
  }
  // Restock is a daily-ops, quantity-only action open to operators. It must NOT
  // mutate master data: we never overwrite an existing item's name/unit/category
  // here (that is the manager-only PATCH /inventory/items path). Creating a
  // brand-new item is master-data creation, so it is gated to managers — an
  // operator restocking an unknown key gets a 403 rather than silently minting
  // a new item.
  let [item] = await db
    .select()
    .from(inventoryItemsTable)
    .where(and(eq(inventoryItemsTable.key, itemKey), eq(inventoryItemsTable.scope, currentScope())));
  if (!item) {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const { role } = await getOrCreateUserRole(userId);
    if (role !== "manager") {
      res.status(403).json({ error: "Manager role required to create a new item" });
      return;
    }
    [item] = await db
      .insert(inventoryItemsTable)
      .values({ key: itemKey, category, name, unit, scope: currentScope() })
      .onConflictDoNothing({ target: [inventoryItemsTable.key, inventoryItemsTable.scope] })
      .returning();
    if (!item) {
      [item] = await db
        .select()
        .from(inventoryItemsTable)
        .where(and(eq(inventoryItemsTable.key, itemKey), eq(inventoryItemsTable.scope, currentScope())));
    }
  }
  const [lot] = await db
    .insert(inventoryLotsTable)
    .values({
      itemId: item.id,
      scope: currentScope(),
      locationId: targetLocationId,
      lotNumber: lotNumber ?? "",
      qtyReceived: qty,
      qtyRemaining: qty,
      receivedDate: receivedDate ?? todayStr(),
      expirationDate: expirationDate ?? null,
    })
    .returning();
  await db.insert(inventoryLedgerTable).values({
    itemId: item.id,
    scope: currentScope(),
    lotId: lot.id,
    type: "restock",
    qtyDelta: qty,
    note: lotNumber ? `Restock — lot ${lotNumber}` : "Restock",
  });
  broadcast(headerSenderId(req), currentScope());
  res.json(await loadItemResponse(item.id));
});

// ── Photo stock intake (AI vision) ───────────────────────────────────────────
// Read-only: identifies incoming stock from a photo and returns suggested restock
// entries. It never writes — the client must confirm each entry, which then goes
// through the existing POST /inventory/restock path. Low/zero confidence is left
// to the client to surface as a manual-entry fallback. Request validation and
// model-output sanitizing live in ./photoIdentify so they can be unit-tested
// without a DB or the vision provider.

router.post(
  "/inventory/identify-photo",
  requireCapability("use-ai-tools"),
  rateLimit({
    windowMs: PHOTO_RATE_WINDOW_MS,
    max: PHOTO_RATE_MAX,
    keyGenerator: (req) => req.userId ?? req.ip ?? "unknown",
    store: photoRateStore,
  }),
  async (req, res): Promise<void> => {
  const validation = validateIdentifyPhotoBody(req.body);
  if (!validation.ok) {
    res.status(validation.status).json({ error: validation.error });
    return;
  }
  const { imageBase64, mimeType, candidates } = validation.data;
  const candidateKeys = validation.candidateKeys;
  const cands = candidates ?? [];
  const candidateLines = cands
    .map((c) => `- key="${c.key}" name="${c.name}" unit="${c.unit}" category="${c.category}"`)
    .join("\n");
  const dataUri = `data:${mimeType || "image/jpeg"};base64,${imageBase64}`;

  const systemPrompt =
    "You are a stock-intake assistant for a frozen-pizza production facility. " +
    "You look at a photo of incoming/received goods (ingredients or packaging) and " +
    "identify the distinct physical items and how many units are visible. Be conservative: " +
    "only report items you can actually see, and use a low confidence when unsure.";
  const userText =
    "Identify the distinct stock items in this photo. For each item, estimate the visible " +
    "quantity as a number of discrete units (e.g. cases, boxes, bags, barrels), choose a short " +
    "unit label, and classify it as either \"ingredient\" or \"packaging\".\n\n" +
    "Match each item to one of the KNOWN ITEMS below by returning its exact key in matchedKey " +
    "when you are confident it is the same product; otherwise set matchedKey to null (a new item).\n\n" +
    (candidateLines
      ? `KNOWN ITEMS:\n${candidateLines}\n\n`
      : "KNOWN ITEMS: (none provided)\n\n") +
    "Respond ONLY with JSON of the exact shape: " +
    '{"items":[{"name":string,"qty":number,"unit":string,"category":"ingredient"|"packaging",' +
    '"matchedKey":string|null,"confidence":number}]}. ' +
    "confidence is 0..1. If you cannot identify anything, return {\"items\":[]}.";

  // A malformed reply here silently reads as "the AI saw nothing in the
  // photo", so retry once before the empty fallback.
  const result = await fetchModelJsonWithRetry({
    label: "identify-photo vision",
    log: req.log,
    call: async () => {
      const response = await openai.chat.completions.create({
        model: pickModel("full"),
        max_completion_tokens: 8192,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: userText },
              { type: "image_url", image_url: { url: dataUri } },
            ],
          },
        ],
      });
      return response.choices[0]?.message?.content ?? "";
    },
  });
  if (!result.ok) {
    if (result.reason === "provider") {
      res.status(502).json({ error: "Vision provider error" });
      return;
    }
    res.json({ items: [] });
    return;
  }
  res.json({ items: sanitizeGuesses(result.raw, candidateKeys) });
});

// AI quality/defect check for a finished pizza or crust. A user photographs the
// product and gets a plain-language assessment (status + confidence + specific
// issues) to review. This endpoint is strictly READ-ONLY: it never records,
// grades, accepts, or rejects anything — confirming an outcome is a separate,
// user-driven write to facility memory through the existing /ai-memory path. The
// prompt is grounded in facility memory (the "quality" topic and prior notes) so
// the model reflects what the facility has learned. Validation + model-output
// sanitizing live in ./qualityPhoto so they can be unit-tested without a DB or
// the vision provider.
router.post(
  "/inventory/quality-photo",
  requireCapability("use-ai-tools"),
  rateLimit({
    windowMs: PHOTO_RATE_WINDOW_MS,
    max: PHOTO_RATE_MAX,
    keyGenerator: (req) => req.userId ?? req.ip ?? "unknown",
    store: qualityRateStore,
  }),
  async (req, res): Promise<void> => {
    const validation = validateQualityPhotoBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }
    const input = validation.data;
    const dataUri = `data:${input.mimeType || "image/jpeg"};base64,${input.imageBase64}`;
    const { system, userText } = buildQualityPrompt(input);
    const groundedUserText = await groundPromptWithMemory(req.log, userText, {
      facilityDomains: ["quality"],
    });

    let content = "";
    try {
      const response = await openai.chat.completions.create({
        model: pickModel("full"),
        max_completion_tokens: 8192,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: [
              { type: "text", text: groundedUserText },
              { type: "image_url", image_url: { url: dataUri } },
            ],
          },
        ],
      });
      content = response.choices[0]?.message?.content ?? "";
    } catch (err) {
      req.log.error({ err }, "quality-photo vision call failed");
      res.status(502).json({ error: "Vision provider error" });
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      req.log.warn({ content: content.slice(0, 200) }, "quality-photo non-JSON response");
      res.json({
        assessment: { summary: "", status: "warn", confidence: 0, issues: [] },
        generatedAt: Date.now(),
        note: "The assessment could not be read. Please try another photo.",
      });
      return;
    }
    const { assessment, note } = sanitizeAssessment(raw);
    res.json({ assessment, generatedAt: Date.now(), ...(note ? { note } : {}) });
  },
);

// POST /inventory/production-sheet-photo — read a photo of a paper production/run
// sheet and transcribe the run rows it lists so they can be reviewed and added
// to the schedule. Read-only and advisory: every extracted row is confirmed by
// the user before it is applied through the existing schedule path. Validation +
// model-output sanitizing live in ./productionSheetPhoto so they can be
// unit-tested without a DB or the vision provider.
router.post(
  "/inventory/production-sheet-photo",
  requireCapability("use-ai-tools"),
  rateLimit({
    windowMs: PHOTO_RATE_WINDOW_MS,
    max: PHOTO_RATE_MAX,
    keyGenerator: (req) => req.userId ?? req.ip ?? "unknown",
    store: productionSheetRateStore,
  }),
  async (req, res): Promise<void> => {
    const validation = validateProductionSheetBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }
    const input = validation.data;
    const dataUri = `data:${input.mimeType || "image/jpeg"};base64,${input.imageBase64}`;
    const { system, userText } = buildProductionSheetPrompt(input);

    // A malformed reply here means a whole paper sheet comes back with zero
    // rows, so retry once before the empty fallback.
    const result = await fetchModelJsonWithRetry({
      label: "production-sheet-photo vision",
      log: req.log,
      call: async () => {
        const response = await openai.chat.completions.create({
          model: pickModel("full"),
          max_completion_tokens: 8192,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            {
              role: "user",
              content: [
                { type: "text", text: userText },
                { type: "image_url", image_url: { url: dataUri } },
              ],
            },
          ],
        });
        return response.choices[0]?.message?.content ?? "";
      },
    });
    if (!result.ok) {
      if (result.reason === "provider") {
        res.status(502).json({ error: "Vision provider error" });
        return;
      }
      res.json({
        rows: [],
        generatedAt: Date.now(),
        note: "The production sheet could not be read. Please try another photo.",
      });
      return;
    }
    const { rows, note } = sanitizeSheetRows(result.raw);
    res.json({ rows, generatedAt: Date.now(), ...(note ? { note } : {}) });
  },
);

// POST /inventory/label-verify — read a photo of a finished-product label or
// pallet placard and compare the visible fields against the expected values the
// client supplies. Returns a per-field match/mismatch breakdown plus an overall
// verdict. Read-only and advisory: a person reviews the result and decides what
// to do. The overall verdict is RECOMPUTED server-side from the per-field
// results so a model "pass" can never mask a real mismatch. Validation +
// sanitizing live in ./labelVerify for unit testing.
router.post(
  "/inventory/label-verify",
  requireCapability("use-ai-tools"),
  rateLimit({
    windowMs: PHOTO_RATE_WINDOW_MS,
    max: PHOTO_RATE_MAX,
    keyGenerator: (req) => req.userId ?? req.ip ?? "unknown",
    store: labelVerifyRateStore,
  }),
  async (req, res): Promise<void> => {
    const validation = validateLabelVerifyBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }
    const input = validation.data;
    const expected = expectedToMap(input.expected);
    const dataUri = `data:${input.mimeType || "image/jpeg"};base64,${input.imageBase64}`;
    const { system, userText } = buildLabelVerifyPrompt(input);

    let content = "";
    try {
      const response = await openai.chat.completions.create({
        model: pickModel("full"),
        max_completion_tokens: 8192,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: [
              { type: "text", text: userText },
              { type: "image_url", image_url: { url: dataUri } },
            ],
          },
        ],
      });
      content = response.choices[0]?.message?.content ?? "";
    } catch (err) {
      req.log.error({ err }, "label-verify vision call failed");
      res.status(502).json({ error: "Vision provider error" });
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      req.log.warn({ content: content.slice(0, 200) }, "label-verify non-JSON response");
      const { result } = sanitizeLabelVerification(null, expected);
      res.json({
        ...result,
        generatedAt: Date.now(),
        note: "The label could not be read. Please try another photo.",
      });
      return;
    }
    const { result, note } = sanitizeLabelVerification(raw, expected);
    res.json({ ...result, generatedAt: Date.now(), ...(note ? { note } : {}) });
  },
);

// POST /inventory/quality-checks — persist a reviewed-and-confirmed quality
// check into the manager history. Manager-only. The /inventory/quality-photo
// endpoint above is purely advisory; this is the deliberate, user-driven save of
// a structured record (verdict, confidence, issues, optional notes + thumbnail)
// the manager can browse and audit later. Validation/normalization live in
// ./qualityChecks so they can be unit-tested without a DB.
router.post(
  "/inventory/quality-checks",
  requireCapability("use-ai-tools"),
  async (req, res): Promise<void> => {
    const validation = validateRecordQualityCheckBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }
    const data = validation.data;

    // Snapshot the reviewer's identity so the history view survives even if the
    // account is later removed; a lookup failure must not fail the save.
    const reviewerId = req.userId ?? null;
    let reviewerName: string | null = null;
    if (reviewerId) {
      try {
        reviewerName = (await getStaffMember(reviewerId)).name;
      } catch (err) {
        req.log.warn({ err }, "quality-check reviewer lookup failed");
      }
    }

    const [row] = await db
      .insert(qualityChecksTable)
      .values({
        productType: data.productType,
        status: data.status,
        confidence: data.confidence,
        summary: data.summary,
        issues: data.issues,
        notes: data.notes,
        thumbnail: data.thumbnail,
        reviewerId,
        reviewerName,
      })
      .returning();
    res.json(rowToRecord(row));
  },
);

// GET /inventory/quality-checks — manager-only quality history (newest first),
// optionally filtered by product type and/or status. Unknown filter values are
// ignored rather than erroring so a stray query param never breaks the view.
router.get(
  "/inventory/quality-checks",
  requireCapability("use-ai-tools"),
  async (req, res): Promise<void> => {
    const filter = parseHistoryFilter(req.query);
    const conditions = [];
    if (filter.productType)
      conditions.push(eq(qualityChecksTable.productType, filter.productType));
    if (filter.status) conditions.push(eq(qualityChecksTable.status, filter.status));

    const rows = await db
      .select()
      .from(qualityChecksTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(qualityChecksTable.createdAt));
    res.json(rows.map(rowToRecord));
  },
);

// AI expiry & waste insight. The server reads current inventory + the global
// expiry-soon lead time and flags items that are expired or expiring soon
// (pure logic in ./wasteInsight). When nothing is at risk it returns an empty
// result WITHOUT calling the model (no cost for a no-op). Otherwise it asks the
// model — grounded in facility memory ("waste"/"inventory") and the optional
// upcoming-plan items — for a plain-language run-order suggestion to consume the
// at-risk stock first. Advisory only: it never reorders runs or touches stock.
// A best-effort note is recorded back to facility memory so the insight informs
// future grounding; a write failure never fails the request.
router.post(
  "/inventory/waste-insight",
  requireCapability("use-ai-tools"),
  rateLimit({
    windowMs: PHOTO_RATE_WINDOW_MS,
    max: PHOTO_RATE_MAX,
    keyGenerator: (req) => req.userId ?? req.ip ?? "unknown",
    store: wasteRateStore,
  }),
  async (req, res): Promise<void> => {
    const validation = validateWasteInsightBody(req.body);
    if (!validation.ok) {
      res.status(validation.status).json({ error: validation.error });
      return;
    }
    const plannedItems = validation.data.plannedItems ?? [];

    const settings = await loadSettings();
    const soonDays = settings.expirySoonDays ?? 7;

    const items = await db
      .select()
      .from(inventoryItemsTable)
      .where(eq(inventoryItemsTable.scope, currentScope()))
      .orderBy(inventoryItemsTable.category, inventoryItemsTable.name);
    const allLots = await db
      .select()
      .from(inventoryLotsTable)
      .where(eq(inventoryLotsTable.scope, currentScope()));
    const lotsByItem = new Map<number, InventoryLot[]>();
    for (const lot of allLots) {
      const arr = lotsByItem.get(lot.itemId) ?? [];
      arr.push(lot);
      lotsByItem.set(lot.itemId, arr);
    }
    const flaggable: FlaggableItem[] = items.map((item) => ({
      key: item.key,
      name: item.name,
      category: item.category,
      unit: item.unit,
      lots: (lotsByItem.get(item.id) ?? []).map((l) => ({
        qtyRemaining: l.qtyRemaining,
        expirationDate: l.expirationDate,
      })),
    }));
    const flagged = flagExpiringItems(flaggable, soonDays);

    // Nothing at risk → no AI call, no cost.
    if (flagged.length === 0) {
      res.json({ flagged: [], suggestion: null, generatedAt: Date.now() });
      return;
    }

    const { system, user } = buildWastePrompt(flagged, plannedItems);
    const groundedUser = await groundPromptWithMemory(req.log, user, {
      facilityDomains: ["waste", "inventory"],
    });

    let content = "";
    try {
      const response = await openai.chat.completions.create({
        model: pickModel("full"),
        max_completion_tokens: 4096,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: groundedUser },
        ],
      });
      content = response.choices[0]?.message?.content ?? "";
    } catch (err) {
      req.log.error({ err }, "waste-insight AI call failed");
      res.json({
        flagged,
        suggestion: null,
        generatedAt: Date.now(),
        note: "Could not generate a suggestion right now. The flagged items above are still accurate.",
      });
      return;
    }

    const { suggestion, note } = sanitizeWasteSuggestion(content);

    // Best-effort: remember that these items trended toward waste so future
    // insights are grounded in it. Never let a memory write fail the request.
    if (suggestion) {
      try {
        const topNames = flagged
          .slice(0, 5)
          .map((f) => f.name)
          .join(", ");
        await recordFacilityKnowledge([
          {
            domain: "waste",
            key: `at-risk:${todayStr()}`,
            fact: `On ${todayStr()}, at-risk stock flagged: ${topNames}. Suggested run-order: ${suggestion}`,
            source: "waste-insight",
          },
        ]);
      } catch (err) {
        req.log.warn({ err }, "waste-insight memory write failed (non-fatal)");
      }
    }

    res.json({
      flagged,
      suggestion: suggestion || null,
      generatedAt: Date.now(),
      ...(note ? { note } : {}),
    });
  },
);

// Apply a manual stock correction. A positive delta lands in a new lot; a
// negative delta draws stock down through the same FIFO/FEFO `drawDown` logic as
// run completion, capped at what's on hand so stock never goes negative. The
// ledger records the ACTUAL applied delta (the capped amount for downward
// corrections), not the requested one. Lot mutation + ledger + item touch are
// one atomic unit so a mid-step failure can't leave stock and audit trail out of
// sync. A zero delta is a no-op (no lot, no ledger row). Exported so the DB
// wiring (new-lot insert, cap-at-available drawdown, applied-delta ledger,
// transaction boundaries) can be integration-tested against a real Postgres.
export async function adjustInventory(
  itemId: number,
  qtyDelta: number,
  note?: string,
): Promise<{ appliedDelta: number; lotId: number | null }> {
  if (qtyDelta === 0) return { appliedDelta: 0, lotId: null };
  return db.transaction(async (tx) => {
    let appliedDelta = qtyDelta;
    let lotId: number | null = null;
    // Manual corrections target onsite stock: a positive correction lands in a
    // new onsite lot; a negative one draws down from onsite lots only (matching
    // where production deducts). `onsiteId` is null when no location rows exist
    // yet, in which case the lot stays null === onsite and the drawdown spans
    // the still-null lots.
    const onsiteId = await resolveOnsiteLocationId();
    if (qtyDelta > 0) {
      // Positive correction lands in a new unlotted onsite lot.
      const [lot] = await tx
        .insert(inventoryLotsTable)
        .values({
          itemId,
          scope: currentScope(),
          locationId: onsiteId,
          lotNumber: "",
          qtyReceived: qtyDelta,
          qtyRemaining: qtyDelta,
          receivedDate: todayStr(),
          expirationDate: null,
        })
        .returning();
      lotId = lot.id;
    } else {
      const consumed = await drawDown(tx, itemId, -qtyDelta, onsiteLotCond(onsiteId));
      appliedDelta = -consumed; // cap at available stock
    }
    await tx.insert(inventoryLedgerTable).values({
      itemId,
      scope: currentScope(),
      lotId,
      type: "adjust",
      qtyDelta: appliedDelta,
      note: note ?? "Manual adjustment",
    });
    await tx
      .update(inventoryItemsTable)
      .set({ updatedAt: new Date() })
      .where(and(eq(inventoryItemsTable.id, itemId), eq(inventoryItemsTable.scope, currentScope())));
    return { appliedDelta, lotId };
  });
}

router.post("/inventory/adjust", async (req, res): Promise<void> => {
  const parsed = AdjustInventoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { itemId, qtyDelta, note } = parsed.data;
  const [item] = await db
    .select()
    .from(inventoryItemsTable)
    .where(and(eq(inventoryItemsTable.id, itemId), eq(inventoryItemsTable.scope, currentScope())));
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (qtyDelta === 0) {
    res.json(await loadItemResponse(itemId));
    return;
  }
  await adjustInventory(itemId, qtyDelta, note);
  broadcast(headerSenderId(req), currentScope());
  res.json(await loadItemResponse(itemId));
});

// Mirrors artifacts/run-calculator's DEFAULT_PEP_TYPES (each app owns its own
// copy by design — see lib/inventory-math). Only used server-side to recompute
// the EXPECTED consumption for a run so we can validate what the client
// claims to have consumed; never surfaced to clients.
const SERVER_DEFAULT_PEP_TYPES = ["Pepperoni Stick", "Pepperoni Stick - NATURAL"];

// `/inventory/consume` is reachable to any authenticated user, but its request
// body is NOT trusted for what actually gets deducted (see below) — only for
// WHICH run to finalize. We defend by treating the synced day-state
// (server-persisted per date+scope in `daily_sync`) as the source of truth for
// "which runs exist and what do they actually need": the referenced runId
// must appear in some day's `dayState.runs` for this scope, and the amounts
// applied come ONLY from the shared, pure `computeRunConsumptionLines` formula
// (the SAME formula the clients use) run against that run's own stored
// settings + substitutions. Scanning all of a scope's daily_sync rows is
// acceptable here: it's one JSONB row per calendar day, so even years of
// history stay small.
async function findExpectedConsumptionForRun(
  runId: string,
  scope: ReturnType<typeof currentScope>,
): Promise<Map<string, number> | null> {
  const rows = await db
    .select({ data: dailySyncTable.data })
    .from(dailySyncTable)
    .where(eq(dailySyncTable.scope, scope));
  for (const row of rows) {
    const data = row.data as {
      dayState?: { runs?: Array<{ id?: string }>; substitutions?: IngredientSubstitution[] };
      runValues?: Record<string, unknown>;
    } | null;
    const runs = data?.dayState?.runs ?? [];
    if (!runs.some((r) => r?.id === runId)) continue;
    const vals = data?.runValues?.[runId];
    if (!vals || typeof vals !== "object") continue;
    const substitutions = data?.dayState?.substitutions ?? [];
    const effective = substitutions.length
      ? applySubstitutions(vals as Record<string, unknown>, substitutions)
      : vals;
    const expectedLines = computeRunConsumptionLines(
      effective as unknown as RunLinesInput,
      SERVER_DEFAULT_PEP_TYPES,
    );
    return new Map(expectedLines.map((l) => [l.itemKey, l.qty]));
  }
  return null;
}

// Claim + drawdown + ledger all run in one transaction. The unique runId
// marker is written even for zero-consume runs, so a later restock + re-consume
// of the same run can't double-deduct, and onConflictDoNothing makes the claim
// race-safe. Because the claim is part of the transaction, any failure mid-loop
// rolls the claim back too, so the run can be retried and applied exactly once.
// The run-once control flow lives in applyRunConsumption (pure, unit-tested);
// here we just bind it to transaction-scoped DB operations. Exported so the DB
// wiring (FOR UPDATE drawdown, race-safe claim, transaction boundaries) can be
// integration-tested against a real Postgres.
export async function consumeRun(
  runId: string,
  lines: ConsumeLine[],
): Promise<{ applied: boolean; consumed: number }> {
  return db.transaction(async (tx) => {
    // Production only ever pulls from onsite/line stock. `onsiteId` is null when
    // no location rows exist (all stock implicitly onsite), in which case the
    // drawdown spans the still-null lots — same result as before this feature.
    const onsiteId = await resolveOnsiteLocationId();
    const onsiteCond = onsiteLotCond(onsiteId);
    return applyRunConsumption(
      {
        claimRun: async (rid) => {
          const [claim] = await tx
            .insert(inventoryConsumedRunsTable)
            .values({ runId: rid, scope: currentScope() })
            .onConflictDoNothing({
              target: [inventoryConsumedRunsTable.runId, inventoryConsumedRunsTable.scope],
            })
            .returning();
          return Boolean(claim);
        },
        findItemByKey: async (itemKey) => {
          const [item] = await tx
            .select()
            .from(inventoryItemsTable)
            .where(and(eq(inventoryItemsTable.key, itemKey), eq(inventoryItemsTable.scope, currentScope())));
          return item ?? null;
        },
        drawDown: (itemId, qty) => drawDown(tx, itemId, qty, onsiteCond),
        recordConsumption: async (itemId, consumed) => {
          await tx.insert(inventoryLedgerTable).values({
            itemId,
            scope: currentScope(),
            lotId: null,
            type: "consume",
            qtyDelta: -consumed,
            runId,
            note: "Auto-deducted on run completion",
          });
        },
      },
      runId,
      lines,
    );
  });
}

router.post("/inventory/consume", async (req, res): Promise<void> => {
  const parsed = ConsumeInventoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { runId } = parsed.data;
  if (!runId) {
    res.status(400).json({ error: "runId required" });
    return;
  }
  // The client-supplied `lines` are NEVER trusted for what actually gets drawn
  // down — that would let an attacker request an arbitrary subset (or none) of
  // a real run's materials, or split an over-consume across many duplicate
  // lines. Instead we look up the run in the server-persisted day-state and
  // derive the ONLY lines this endpoint will ever apply from that trusted
  // state, via the same shared formula the clients use. A caller can affect
  // WHICH real run gets finalized, never HOW MUCH gets deducted.
  const expected = await findExpectedConsumptionForRun(runId, currentScope());
  if (!expected) {
    res.status(403).json({ error: "runId does not match a known scheduled run" });
    return;
  }
  const authoritativeLines: ConsumeLine[] = [...expected.entries()].map(([itemKey, qty]) => ({
    itemKey,
    qty,
  }));
  const result = await consumeRun(runId, authoritativeLines);
  if (!result.applied) {
    res.json({ applied: false, consumed: 0 });
    return;
  }
  broadcast(headerSenderId(req), currentScope());
  res.json({ applied: true, consumed: result.consumed });
});

// ── Locations CRUD ───────────────────────────────────────────────────────────
router.get("/inventory/locations", async (_req, res): Promise<void> => {
  await ensureOnsiteLocation();
  res.json(await listLocations(currentScope()));
});

router.post(
  "/inventory/locations",
  requireCapability("manage-inventory"),
  async (req, res): Promise<void> => {
    const parsed = CreateInventoryLocationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const name = parsed.data.name.trim();
    if (!name) {
      res.status(400).json({ error: "name required" });
      return;
    }
    // Guarantee a baseline onsite exists before adding more locations.
    await ensureOnsiteLocation();
    const scope = currentScope();
    const wantOnsite = parsed.data.isOnsite === true;
    try {
      const created = await db.transaction(async (tx) => {
        // There is always exactly one onsite location; promoting a new one demotes
        // the rest first (rolled back atomically if the insert collides on name).
        if (wantOnsite) {
          await tx
            .update(inventoryLocationsTable)
            .set({ isOnsite: false })
            .where(eq(inventoryLocationsTable.scope, scope));
        }
        const [row] = await tx
          .insert(inventoryLocationsTable)
          .values({ scope, name, isOnsite: wantOnsite })
          .returning();
        return row;
      });
      broadcast(headerSenderId(req), scope);
      res.status(201).json(created);
    } catch (err) {
      if (isUniqueViolation(err)) {
        res.status(409).json({ error: "A location with that name already exists" });
        return;
      }
      throw err;
    }
  },
);

router.patch(
  "/inventory/locations/:id",
  requireCapability("manage-inventory"),
  async (req, res): Promise<void> => {
    const id = parseId(req.params.id);
    if (id == null) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const parsed = UpdateInventoryLocationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const scope = currentScope();
    const [loc] = await db
      .select()
      .from(inventoryLocationsTable)
      .where(and(eq(inventoryLocationsTable.id, id), eq(inventoryLocationsTable.scope, scope)));
    if (!loc) {
      res.status(404).json({ error: "Location not found" });
      return;
    }
    let name: string | undefined;
    if (parsed.data.name != null) {
      name = parsed.data.name.trim();
      if (!name) {
        res.status(400).json({ error: "name cannot be blank" });
        return;
      }
    }
    const wantOnsite = parsed.data.isOnsite;
    // There must always be one onsite location: you can't turn the onsite one off
    // directly — promote another instead.
    if (wantOnsite === false && loc.isOnsite) {
      res.status(400).json({
        error: "There must always be one onsite location. Make another location onsite instead.",
      });
      return;
    }
    try {
      const updated = await db.transaction(async (tx) => {
        if (wantOnsite === true) {
          await tx
            .update(inventoryLocationsTable)
            .set({ isOnsite: false })
            .where(eq(inventoryLocationsTable.scope, scope));
        }
        const set: Record<string, unknown> = {};
        if (name != null) set.name = name;
        if (wantOnsite === true) set.isOnsite = true;
        if (Object.keys(set).length === 0) {
          const [row] = await tx
            .select()
            .from(inventoryLocationsTable)
            .where(and(eq(inventoryLocationsTable.id, id), eq(inventoryLocationsTable.scope, scope)));
          return row;
        }
        const [row] = await tx
          .update(inventoryLocationsTable)
          .set(set)
          .where(and(eq(inventoryLocationsTable.id, id), eq(inventoryLocationsTable.scope, scope)))
          .returning();
        return row;
      });
      broadcast(headerSenderId(req), scope);
      res.json(updated);
    } catch (err) {
      if (isUniqueViolation(err)) {
        res.status(409).json({ error: "A location with that name already exists" });
        return;
      }
      throw err;
    }
  },
);

router.delete(
  "/inventory/locations/:id",
  requireCapability("manage-inventory"),
  async (req, res): Promise<void> => {
    const id = parseId(req.params.id);
    if (id == null) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const scope = currentScope();
    const [loc] = await db
      .select()
      .from(inventoryLocationsTable)
      .where(and(eq(inventoryLocationsTable.id, id), eq(inventoryLocationsTable.scope, scope)));
    if (!loc) {
      res.status(404).json({ error: "Location not found" });
      return;
    }
    if (loc.isOnsite) {
      res.status(409).json({ error: "Cannot delete the onsite location" });
      return;
    }
    const [held] = await db
      .select()
      .from(inventoryLotsTable)
      .where(
        and(
          eq(inventoryLotsTable.scope, scope),
          eq(inventoryLotsTable.locationId, id),
          gt(inventoryLotsTable.qtyRemaining, 0),
        ),
      )
      .limit(1);
    if (held) {
      res
        .status(409)
        .json({ error: "Cannot delete a location that still holds stock. Transfer it out first." });
      return;
    }
    await db
      .delete(inventoryLocationsTable)
      .where(and(eq(inventoryLocationsTable.id, id), eq(inventoryLocationsTable.scope, scope)));
    broadcast(headerSenderId(req), scope);
    res.sendStatus(204);
  },
);

// Move `qty` of an item from one location to another, drawing source lots in
// FIFO/FEFO order and re-creating matching destination lots so expiration dates
// and lot numbers are preserved across the move. On-hand is conserved: a paired
// "transfer" ledger entry records the outbound (−) and inbound (+) legs. Exported
// so the per-lot move + paired-ledger wiring can be integration-tested.
export async function transferStock(
  itemId: number,
  fromLocationId: number,
  toLocationId: number,
  qty: number,
  opts: { fromIsOnsite: boolean; fromName: string; toName: string },
): Promise<{ transferred: number }> {
  if (qty <= 0) return { transferred: 0 };
  return db.transaction(async (tx) => {
    // Onsite source also sweeps any still-null lots (which mean onsite); a named
    // source draws only its own lots.
    const cond = opts.fromIsOnsite
      ? onsiteLotCond(fromLocationId)
      : eq(inventoryLotsTable.locationId, fromLocationId);
    const conds = [
      eq(inventoryLotsTable.itemId, itemId),
      eq(inventoryLotsTable.scope, currentScope()),
      gt(inventoryLotsTable.qtyRemaining, 0),
    ];
    if (cond) conds.push(cond);
    const lots = await tx
      .select()
      .from(inventoryLotsTable)
      .where(and(...conds))
      .for("update");
    const { consumed, updates } = planDrawDown(lots, qty);
    if (consumed <= 0) return { transferred: 0 };
    const byId = new Map(lots.map((l) => [l.id, l]));
    for (const update of updates) {
      const src = byId.get(update.id);
      if (!src) continue;
      const moved = src.qtyRemaining - update.qtyRemaining;
      if (moved <= 0) continue;
      await tx
        .update(inventoryLotsTable)
        .set({ qtyRemaining: update.qtyRemaining })
        .where(eq(inventoryLotsTable.id, update.id));
      await tx.insert(inventoryLotsTable).values({
        itemId,
        scope: currentScope(),
        locationId: toLocationId,
        lotNumber: src.lotNumber,
        qtyReceived: moved,
        qtyRemaining: moved,
        receivedDate: src.receivedDate,
        expirationDate: src.expirationDate,
      });
    }
    await tx.insert(inventoryLedgerTable).values([
      {
        itemId,
        scope: currentScope(),
        lotId: null,
        type: "transfer",
        qtyDelta: -consumed,
        note: `Transfer to ${opts.toName}`,
      },
      {
        itemId,
        scope: currentScope(),
        lotId: null,
        type: "transfer",
        qtyDelta: consumed,
        note: `Transfer from ${opts.fromName}`,
      },
    ]);
    await tx
      .update(inventoryItemsTable)
      .set({ updatedAt: new Date() })
      .where(and(eq(inventoryItemsTable.id, itemId), eq(inventoryItemsTable.scope, currentScope())));
    return { transferred: consumed };
  });
}

router.post("/inventory/transfer", async (req, res): Promise<void> => {
  const parsed = TransferInventoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { itemId, fromLocationId, toLocationId, qty } = parsed.data;
  if (qty <= 0) {
    res.status(400).json({ error: "qty must be positive" });
    return;
  }
  if (fromLocationId === toLocationId) {
    res.status(400).json({ error: "Source and destination must differ" });
    return;
  }
  await ensureOnsiteLocation();
  const scope = currentScope();
  const [item] = await db
    .select()
    .from(inventoryItemsTable)
    .where(and(eq(inventoryItemsTable.id, itemId), eq(inventoryItemsTable.scope, scope)));
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  const locations = await listLocations(scope);
  const from = locations.find((l) => l.id === fromLocationId);
  const to = locations.find((l) => l.id === toLocationId);
  if (!from || !to) {
    res.status(400).json({ error: "Unknown location" });
    return;
  }
  const result = await transferStock(itemId, fromLocationId, toLocationId, qty, {
    fromIsOnsite: from.isOnsite,
    fromName: from.name,
    toName: to.name,
  });
  if (result.transferred <= 0) {
    res.status(409).json({ error: "No stock available at the source location" });
    return;
  }
  broadcast(headerSenderId(req), scope);
  res.json(await loadItemResponse(itemId));
});

// Fold one or more source inventory items into a target item when the user
// merges similar ingredients. Lots and ledger rows are RE-POINTED to the target
// (not re-created), so on-hand totals and the audit trail are preserved exactly
// without a second stock writer. The source item is then deleted. A zero-delta
// "adjust" ledger row documents each fold for traceability. All ops run in one
// transaction so a mid-merge failure leaves stock + audit consistent. Exported
// so the correctness-critical re-point ordering (lots/ledger cascade-delete with
// the item) can be integration-tested against a real Postgres.
export type MergeSpec = {
  fromKey: string;
  toKey: string;
  toName: string;
  unit: string;
  category: string;
};

// Why a fold was skipped instead of applied. `blank-key`/`same-key` are
// malformed inputs; `source-not-tracked` means nothing is in inventory under
// the source name (benign — only master-data names are being merged);
// `same-item` means the source and target keys resolve to the same row.
export type MergeSkipReason =
  | "blank-key"
  | "same-key"
  | "source-not-tracked"
  | "same-item";

// Per-entry outcome so callers can tell exactly which folds applied and which
// were skipped (and why) instead of just seeing a total count. `fromKey`/`toKey`
// echo the caller's original (untrimmed) input so a client can match a result
// back to the pair it submitted.
export type MergeOutcome = {
  fromKey: string;
  toKey: string;
  status: "applied" | "skipped";
  reason?: MergeSkipReason;
};

export type MergeReport = {
  merged: number;
  results: MergeOutcome[];
};

export async function mergeInventoryItems(merges: MergeSpec[]): Promise<MergeReport> {
  const results: MergeOutcome[] = [];
  let merged = 0;
  await db.transaction(async (tx) => {
    for (const m of merges) {
      const fromKey = m.fromKey.trim();
      const toKey = m.toKey.trim();
      if (!fromKey || !toKey) {
        results.push({ fromKey: m.fromKey, toKey: m.toKey, status: "skipped", reason: "blank-key" });
        continue;
      }
      if (fromKey === toKey) {
        results.push({ fromKey: m.fromKey, toKey: m.toKey, status: "skipped", reason: "same-key" });
        continue;
      }
      const [source] = await tx
        .select()
        .from(inventoryItemsTable)
        .where(and(eq(inventoryItemsTable.key, fromKey), eq(inventoryItemsTable.scope, currentScope())));
      if (!source) {
        // nothing tracked under the source name
        results.push({
          fromKey: m.fromKey,
          toKey: m.toKey,
          status: "skipped",
          reason: "source-not-tracked",
        });
        continue;
      }
      // Ensure the target item exists (create if the target ingredient isn't
      // tracked yet) and capture its id.
      const [target] = await tx
        .insert(inventoryItemsTable)
        .values({ key: toKey, category: m.category, name: m.toName, unit: m.unit, scope: currentScope() })
        .onConflictDoUpdate({
          target: [inventoryItemsTable.key, inventoryItemsTable.scope],
          set: { name: m.toName, unit: m.unit, category: m.category, updatedAt: new Date() },
        })
        .returning();
      if (target.id === source.id) {
        results.push({ fromKey: m.fromKey, toKey: m.toKey, status: "skipped", reason: "same-item" });
        continue;
      }
      // Move lots + ledger to the target BEFORE deleting the source (ledger/lots
      // cascade-delete with the item, so re-point first or history is lost).
      await tx
        .update(inventoryLotsTable)
        .set({ itemId: target.id })
        .where(eq(inventoryLotsTable.itemId, source.id));
      await tx
        .update(inventoryLedgerTable)
        .set({ itemId: target.id })
        .where(eq(inventoryLedgerTable.itemId, source.id));
      await tx.insert(inventoryLedgerTable).values({
        itemId: target.id,
        scope: currentScope(),
        lotId: null,
        type: "adjust",
        qtyDelta: 0,
        note: `Merged from ${source.name}`,
      });
      await tx
        .delete(inventoryItemsTable)
        .where(eq(inventoryItemsTable.id, source.id));
      await tx
        .update(inventoryItemsTable)
        .set({ updatedAt: new Date() })
        .where(eq(inventoryItemsTable.id, target.id));
      results.push({ fromKey: m.fromKey, toKey: m.toKey, status: "applied" });
      merged++;
    }
  });
  return { merged, results };
}

router.post("/inventory/merge", requireCapability("manage-inventory"), async (req, res): Promise<void> => {
  const parsed = MergeInventoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const report = await mergeInventoryItems(parsed.data.merges);
  if (report.merged > 0) broadcast(headerSenderId(req), currentScope());
  res.json(report);
});

router.get("/inventory/ledger", async (req, res): Promise<void> => {
  const itemIdRaw = req.query.itemId;
  const itemId = itemIdRaw != null ? parseId(String(itemIdRaw)) : null;
  const rows = itemId != null
    ? await db
        .select()
        .from(inventoryLedgerTable)
        .where(and(eq(inventoryLedgerTable.itemId, itemId), eq(inventoryLedgerTable.scope, currentScope())))
        .orderBy(desc(inventoryLedgerTable.createdAt))
        .limit(500)
    : await db
        .select()
        .from(inventoryLedgerTable)
        .where(eq(inventoryLedgerTable.scope, currentScope()))
        .orderBy(desc(inventoryLedgerTable.createdAt))
        .limit(500);
  res.json(rows);
});

// Global inventory settings live in a single row PER SCOPE. Reads create the
// default row on demand so a fresh install (or a freshly reset sandbox) returns
// a safe default (7-day lead).
// inventory_settings keeps its original integer PK (a push-safe singleton id);
// each scope gets a fixed distinct id so the live and sandbox rows never clash.
const settingsRowId = (scope: string) => (scope === "sandbox" ? 2 : 1);

async function loadSettings() {
  const scope = currentScope();
  const [row] = await db
    .select()
    .from(inventorySettingsTable)
    .where(eq(inventorySettingsTable.scope, scope));
  if (row) return row;
  const [created] = await db
    .insert(inventorySettingsTable)
    .values({ id: settingsRowId(scope), scope })
    .onConflictDoNothing({ target: inventorySettingsTable.scope })
    .returning();
  if (created) return created;
  const [existing] = await db
    .select()
    .from(inventorySettingsTable)
    .where(eq(inventorySettingsTable.scope, scope));
  return existing;
}

router.get("/inventory/settings", async (_req, res): Promise<void> => {
  const row = await loadSettings();
  res.json({ expirySoonDays: row.expirySoonDays });
});

router.put("/inventory/settings", requireCapability("manage-inventory"), async (req, res): Promise<void> => {
  const parsed = UpdateInventorySettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const expirySoonDays = Math.max(0, Math.round(parsed.data.expirySoonDays));
  const [row] = await db
    .insert(inventorySettingsTable)
    .values({
      id: settingsRowId(currentScope()),
      scope: currentScope(),
      expirySoonDays,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: inventorySettingsTable.scope,
      set: { expirySoonDays, updatedAt: new Date() },
    })
    .returning();
  broadcast(headerSenderId(req), currentScope());
  res.json({ expirySoonDays: row.expirySoonDays });
});

router.get("/inventory/events", async (req: Request, res: Response): Promise<void> => {
  const clientId = (req.query.clientId as string) ?? "";
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: "inventory", senderId: null })}\n\n`);

  const client: SseClient = { res, clientId, scope: currentScope() };
  clients.add(client);
  const heartbeat = setInterval(() => {
    try {
      res.write(": heartbeat\n\n");
    } catch {
      /* noop */
    }
  }, 15_000);
  req.on("close", () => {
    clients.delete(client);
    clearInterval(heartbeat);
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────
function parseId(raw: string | string[] | undefined): number | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  const n = parseInt(s ?? "", 10);
  return Number.isFinite(n) ? n : null;
}

function headerSenderId(req: Request): string {
  const h = req.header("x-client-id");
  return typeof h === "string" ? h : "";
}

// Postgres unique-violation (SQLSTATE 23505) — used to turn a duplicate location
// name into a clean 409 instead of a 500.
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default router;
