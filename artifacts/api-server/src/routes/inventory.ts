import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, gt } from "drizzle-orm";
import {
  db,
  inventoryItemsTable,
  inventoryLotsTable,
  inventoryLedgerTable,
  inventoryConsumedRunsTable,
  inventorySettingsTable,
  qualityChecksTable,
  type InventoryLot,
} from "@workspace/db";
import {
  CreateInventoryItemBody,
  UpdateInventoryItemBody,
  RestockInventoryBody,
  AdjustInventoryBody,
  ConsumeInventoryBody,
  MergeInventoryBody,
  UpdateInventorySettingsBody,
} from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import { rateLimit } from "../middlewares/rateLimit";
import { PostgresRateLimitStore } from "../middlewares/rateLimitStore";
import { requireRole } from "../middlewares/requireRole";
import { getOrCreateUserRole, getStaffMember } from "../lib/roles";
import { sanitizeGuesses, validateIdentifyPhotoBody } from "./photoIdentify";
import {
  buildQualityPrompt,
  sanitizeAssessment,
  validateQualityPhotoBody,
} from "./qualityPhoto";
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

// ── SSE: any inventory change pings connected clients to refetch ──────────────
type SseClient = { res: Response; clientId: string };
const clients = new Set<SseClient>();

function broadcast(senderId: string): void {
  const msg = `data: ${JSON.stringify({ type: "inventory", senderId })}\n\n`;
  for (const client of clients) {
    if (client.clientId !== senderId) {
      try {
        client.res.write(msg);
      } catch {
        /* client gone; cleaned up on close */
      }
    }
  }
}

// ── Serialization ────────────────────────────────────────────────────────────
async function loadItemResponse(itemId: number) {
  const [item] = await db
    .select()
    .from(inventoryItemsTable)
    .where(eq(inventoryItemsTable.id, itemId));
  if (!item) return null;
  const lots = await db
    .select()
    .from(inventoryLotsTable)
    .where(eq(inventoryLotsTable.itemId, itemId));
  const sortedLots = sortLotsForConsumption(lots);
  const onHand = lots.reduce((acc, l) => acc + l.qtyRemaining, 0);
  return { ...item, onHand, lots: sortedLots };
}

// Executor type shared by the top-level db handle and a transaction handle, so
// drawDown can run either standalone or inside a transaction.
type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Draw `qty` out of an item's lots in FIFO/FEFO order. Never goes negative;
// returns how much was actually consumed (may be less than requested). The
// ordering and never-negative math live in planDrawDown (pure, unit-tested);
// this wrapper only adds the locking read and persists the planned updates.
export async function drawDown(exec: Executor, itemId: number, qty: number): Promise<number> {
  if (qty <= 0) return 0;
  // Lock the item's lot rows FOR UPDATE so concurrent consume/adjust transactions
  // for the same item serialize here instead of reading the same stale quantities
  // and writing conflicting qtyRemaining values (lost updates / on-hand drift).
  const lots = await exec
    .select()
    .from(inventoryLotsTable)
    .where(
      and(eq(inventoryLotsTable.itemId, itemId), gt(inventoryLotsTable.qtyRemaining, 0)),
    )
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
  const items = await db
    .select()
    .from(inventoryItemsTable)
    .orderBy(inventoryItemsTable.category, inventoryItemsTable.name);
  const allLots = await db.select().from(inventoryLotsTable);
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
    };
  });
  res.json(out);
});

router.post("/inventory/items", requireRole("manager"), async (req, res): Promise<void> => {
  const parsed = CreateInventoryItemBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid inventory item body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { key, category, name, unit, reorderThreshold } = parsed.data;
  const [item] = await db
    .insert(inventoryItemsTable)
    .values({ key, category, name, unit, reorderThreshold: reorderThreshold ?? 0 })
    .onConflictDoUpdate({
      target: inventoryItemsTable.key,
      set: {
        name,
        unit,
        category,
        ...(reorderThreshold != null ? { reorderThreshold } : {}),
        updatedAt: new Date(),
      },
    })
    .returning();
  broadcast(headerSenderId(req));
  res.status(201).json(await loadItemResponse(item.id));
});

router.patch("/inventory/items/:id", requireRole("manager"), async (req, res): Promise<void> => {
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
    .where(eq(inventoryItemsTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  broadcast(headerSenderId(req));
  res.json(await loadItemResponse(id));
});

router.delete("/inventory/items/:id", requireRole("manager"), async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id == null) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [deleted] = await db
    .delete(inventoryItemsTable)
    .where(eq(inventoryItemsTable.id, id))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  broadcast(headerSenderId(req));
  res.sendStatus(204);
});

router.post("/inventory/restock", async (req, res): Promise<void> => {
  const parsed = RestockInventoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { itemKey, category, name, unit, qty, lotNumber, receivedDate, expirationDate } =
    parsed.data;
  if (qty <= 0) {
    res.status(400).json({ error: "qty must be positive" });
    return;
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
    .where(eq(inventoryItemsTable.key, itemKey));
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
      .values({ key: itemKey, category, name, unit })
      .onConflictDoNothing({ target: inventoryItemsTable.key })
      .returning();
    if (!item) {
      [item] = await db
        .select()
        .from(inventoryItemsTable)
        .where(eq(inventoryItemsTable.key, itemKey));
    }
  }
  const [lot] = await db
    .insert(inventoryLotsTable)
    .values({
      itemId: item.id,
      lotNumber: lotNumber ?? "",
      qtyReceived: qty,
      qtyRemaining: qty,
      receivedDate: receivedDate ?? todayStr(),
      expirationDate: expirationDate ?? null,
    })
    .returning();
  await db.insert(inventoryLedgerTable).values({
    itemId: item.id,
    lotId: lot.id,
    type: "restock",
    qtyDelta: qty,
    note: lotNumber ? `Restock — lot ${lotNumber}` : "Restock",
  });
  broadcast(headerSenderId(req));
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
  requireRole("manager"),
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

  let content = "";
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.4",
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
    content = response.choices[0]?.message?.content ?? "";
  } catch (err) {
    req.log.error({ err }, "identify-photo vision call failed");
    res.status(502).json({ error: "Vision provider error" });
    return;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    req.log.warn({ content: content.slice(0, 200) }, "identify-photo non-JSON response");
    res.json({ items: [] });
    return;
  }
  res.json({ items: sanitizeGuesses(raw, candidateKeys) });
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
  requireRole("manager"),
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
        model: "gpt-5.4",
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

// POST /inventory/quality-checks — persist a reviewed-and-confirmed quality
// check into the manager history. Manager-only. The /inventory/quality-photo
// endpoint above is purely advisory; this is the deliberate, user-driven save of
// a structured record (verdict, confidence, issues, optional notes + thumbnail)
// the manager can browse and audit later. Validation/normalization live in
// ./qualityChecks so they can be unit-tested without a DB.
router.post(
  "/inventory/quality-checks",
  requireRole("manager"),
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
  requireRole("manager"),
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
  requireRole("manager"),
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
      .orderBy(inventoryItemsTable.category, inventoryItemsTable.name);
    const allLots = await db.select().from(inventoryLotsTable);
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
        model: "gpt-5.4",
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
    if (qtyDelta > 0) {
      // Positive correction lands in a new unlotted lot.
      const [lot] = await tx
        .insert(inventoryLotsTable)
        .values({
          itemId,
          lotNumber: "",
          qtyReceived: qtyDelta,
          qtyRemaining: qtyDelta,
          receivedDate: todayStr(),
          expirationDate: null,
        })
        .returning();
      lotId = lot.id;
    } else {
      const consumed = await drawDown(tx, itemId, -qtyDelta);
      appliedDelta = -consumed; // cap at available stock
    }
    await tx.insert(inventoryLedgerTable).values({
      itemId,
      lotId,
      type: "adjust",
      qtyDelta: appliedDelta,
      note: note ?? "Manual adjustment",
    });
    await tx
      .update(inventoryItemsTable)
      .set({ updatedAt: new Date() })
      .where(eq(inventoryItemsTable.id, itemId));
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
    .where(eq(inventoryItemsTable.id, itemId));
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  if (qtyDelta === 0) {
    res.json(await loadItemResponse(itemId));
    return;
  }
  await adjustInventory(itemId, qtyDelta, note);
  broadcast(headerSenderId(req));
  res.json(await loadItemResponse(itemId));
});

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
  return db.transaction((tx) =>
    applyRunConsumption(
      {
        claimRun: async (rid) => {
          const [claim] = await tx
            .insert(inventoryConsumedRunsTable)
            .values({ runId: rid })
            .onConflictDoNothing({ target: inventoryConsumedRunsTable.runId })
            .returning();
          return Boolean(claim);
        },
        findItemByKey: async (itemKey) => {
          const [item] = await tx
            .select()
            .from(inventoryItemsTable)
            .where(eq(inventoryItemsTable.key, itemKey));
          return item ?? null;
        },
        drawDown: (itemId, qty) => drawDown(tx, itemId, qty),
        recordConsumption: async (itemId, consumed) => {
          await tx.insert(inventoryLedgerTable).values({
            itemId,
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
    ),
  );
}

router.post("/inventory/consume", async (req, res): Promise<void> => {
  const parsed = ConsumeInventoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { runId, lines } = parsed.data;
  if (!runId) {
    res.status(400).json({ error: "runId required" });
    return;
  }
  const result = await consumeRun(runId, lines);
  if (!result.applied) {
    res.json({ applied: false, consumed: 0 });
    return;
  }
  broadcast(headerSenderId(req));
  res.json({ applied: true, consumed: result.consumed });
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
        .where(eq(inventoryItemsTable.key, fromKey));
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
        .values({ key: toKey, category: m.category, name: m.toName, unit: m.unit })
        .onConflictDoUpdate({
          target: inventoryItemsTable.key,
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

router.post("/inventory/merge", requireRole("manager"), async (req, res): Promise<void> => {
  const parsed = MergeInventoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const report = await mergeInventoryItems(parsed.data.merges);
  if (report.merged > 0) broadcast(headerSenderId(req));
  res.json(report);
});

router.get("/inventory/ledger", async (req, res): Promise<void> => {
  const itemIdRaw = req.query.itemId;
  const itemId = itemIdRaw != null ? parseId(String(itemIdRaw)) : null;
  const rows = itemId != null
    ? await db
        .select()
        .from(inventoryLedgerTable)
        .where(eq(inventoryLedgerTable.itemId, itemId))
        .orderBy(desc(inventoryLedgerTable.createdAt))
        .limit(500)
    : await db
        .select()
        .from(inventoryLedgerTable)
        .orderBy(desc(inventoryLedgerTable.createdAt))
        .limit(500);
  res.json(rows);
});

// Global inventory settings live in a single row (id=1). Reads create the
// default row on demand so a fresh install returns a safe default (7-day lead).
async function loadSettings() {
  const [row] = await db
    .select()
    .from(inventorySettingsTable)
    .where(eq(inventorySettingsTable.id, 1));
  if (row) return row;
  const [created] = await db
    .insert(inventorySettingsTable)
    .values({ id: 1 })
    .onConflictDoNothing({ target: inventorySettingsTable.id })
    .returning();
  if (created) return created;
  const [existing] = await db
    .select()
    .from(inventorySettingsTable)
    .where(eq(inventorySettingsTable.id, 1));
  return existing;
}

router.get("/inventory/settings", async (_req, res): Promise<void> => {
  const row = await loadSettings();
  res.json({ expirySoonDays: row.expirySoonDays });
});

router.put("/inventory/settings", requireRole("manager"), async (req, res): Promise<void> => {
  const parsed = UpdateInventorySettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const expirySoonDays = Math.max(0, Math.round(parsed.data.expirySoonDays));
  const [row] = await db
    .insert(inventorySettingsTable)
    .values({ id: 1, expirySoonDays, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: inventorySettingsTable.id,
      set: { expirySoonDays, updatedAt: new Date() },
    })
    .returning();
  broadcast(headerSenderId(req));
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

  const client: SseClient = { res, clientId };
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

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default router;
