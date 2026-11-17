import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import {
  cheeseRecipesTable,
  db,
  doughRecipesTable,
  mixesTable,
  qcWorkflowEventsTable,
  sauceRecipesTable,
} from "@workspace/db";
import { currentScope } from "../lib/requestScope";
import {
  lockRecipeQcFamily,
  recipeQcResultHash,
  RECIPE_QC_FAMILIES,
  type RecipeQcFamily,
} from "../lib/recipeQcReview";
import { requireAnyCapability, requireCapability } from "../middlewares/requireCapability";

const router: IRouter = Router();
const familyTables = {
  dough: doughRecipesTable,
  sauce: sauceRecipesTable,
  cheese: cheeseRecipesTable,
  mix: mixesTable,
} as const;
const statusValues = ["pending", "verified", "rejected", "superseded", "deleted", "all"] as const;

type RecipeRow = Record<string, unknown> & { id: string; name: string };
type ReviewStatus = "pending" | "verified" | "rejected" | "superseded" | "deleted";

async function loadRecipe(
  executor: any,
  family: RecipeQcFamily,
  scope: string,
  id: string,
): Promise<RecipeRow | null> {
  const table = familyTables[family];
  const [row] = await executor.select().from(table).where(and(
    eq(table.scope, scope),
    eq(table.id, id),
  )).limit(1);
  return (row as RecipeRow | undefined) ?? null;
}

function parseCapture(row: typeof qcWorkflowEventsTable.$inferSelect) {
  const payload = row.payload ?? {};
  const family = payload.recipeType;
  const recipeId = payload.recipeId;
  const resultHash = payload.resultHash;
  if (
    !RECIPE_QC_FAMILIES.includes(family as RecipeQcFamily) ||
    typeof recipeId !== "string" ||
    typeof resultHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(resultHash)
  ) return null;
  return { family: family as RecipeQcFamily, recipeId, resultHash };
}

async function projectCaptureStatuses(
  captures: (typeof qcWorkflowEventsTable.$inferSelect)[],
  scope: string,
) {
  if (captures.length === 0) return new Map<number, {
    status: ReviewStatus;
    sourceState: "active" | "renamed" | "deleted";
    currentName: string | null;
  }>();

  const recordIds = [...new Set(captures.map((capture) => capture.recordId))];
  const captureIds = captures.map((capture) => String(capture.id));
  const [latestCaptures, decisions] = await Promise.all([
    db.select().from(qcWorkflowEventsTable).where(and(
      eq(qcWorkflowEventsTable.scope, scope),
      eq(qcWorkflowEventsTable.eventType, "recipe-committed"),
      inArray(qcWorkflowEventsTable.recordId, recordIds),
    )).orderBy(desc(qcWorkflowEventsTable.id)),
    db.select().from(qcWorkflowEventsTable).where(and(
      eq(qcWorkflowEventsTable.scope, scope),
      eq(qcWorkflowEventsTable.eventType, "recipe-review"),
      inArray(qcWorkflowEventsTable.relatedEventId, captureIds),
    )).orderBy(desc(qcWorkflowEventsTable.id)),
  ]);
  const latestCaptureByRecord = new Map<string, number>();
  for (const row of latestCaptures) {
    if (!latestCaptureByRecord.has(row.recordId)) latestCaptureByRecord.set(row.recordId, row.id);
  }
  const decisionByCapture = new Map<string, (typeof decisions)[number]>();
  for (const row of decisions) {
    if (row.relatedEventId && !decisionByCapture.has(row.relatedEventId)) {
      decisionByCapture.set(row.relatedEventId, row);
    }
  }

  const currentByIdentity = new Map<string, RecipeRow>();
  for (const family of RECIPE_QC_FAMILIES) {
    const ids = [...new Set(captures.flatMap((capture) => {
      const parsed = parseCapture(capture);
      return parsed?.family === family ? [parsed.recipeId] : [];
    }))];
    if (!ids.length) continue;
    const table = familyTables[family];
    const rows = await db.select().from(table).where(and(
      eq(table.scope, scope),
      inArray(table.id, ids),
    ));
    for (const row of rows) currentByIdentity.set(`${family}:${row.id}`, row as RecipeRow);
  }

  return new Map(captures.map((capture) => {
    const parsed = parseCapture(capture);
    if (!parsed) return [capture.id, {
      status: "superseded" as const, sourceState: "deleted" as const, currentName: null,
    }];
    const current = currentByIdentity.get(capture.recordId);
    const sourceState = !current
      ? "deleted" as const
      : current.name !== capture.payload.displayName
        ? "renamed" as const
        : "active" as const;
    let status: ReviewStatus;
    if (!current) status = "deleted";
    else if (
      latestCaptureByRecord.get(capture.recordId) !== capture.id ||
      recipeQcResultHash(parsed.family, parsed.recipeId, current) !== parsed.resultHash
    ) status = "superseded";
    else {
      const decision = decisionByCapture.get(String(capture.id));
      status = decision?.payload.status === "verified" || decision?.payload.status === "rejected"
        ? decision.payload.status
        : "pending";
    }
    return [capture.id, { status, sourceState, currentName: current?.name ?? null }];
  }));
}

function encodeStatusCursor(family: RecipeQcFamily, id: string): string {
  return Buffer.from(JSON.stringify({ family, id })).toString("base64url");
}

function decodeStatusCursor(value: string | undefined): { family: RecipeQcFamily; id: string } | null {
  if (!value) return null;
  if (value.length > 240 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      !decoded || typeof decoded !== "object" ||
      !RECIPE_QC_FAMILIES.includes(decoded.family) ||
      typeof decoded.id !== "string" || decoded.id.length < 1 || decoded.id.length > 300
    ) return null;
    return { family: decoded.family, id: decoded.id };
  } catch {
    return null;
  }
}

router.get(
  "/qc/recipe-review-statuses",
  requireAnyCapability(["record-qc", "manage-qc"]),
  async (req, res) => {
    const query = z.object({
      cursor: z.string().max(240).optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }).strict().safeParse(req.query);
    const decodedCursor = query.success ? decodeStatusCursor(query.data.cursor) : null;
    if (!query.success || (query.data.cursor && !decodedCursor)) {
      res.status(400).json({ error: "Invalid recipe review status filters" });
      return;
    }

    const scope = currentScope();
    const limit = query.data.limit;
    const rows: Array<{ family: RecipeQcFamily; row: RecipeRow }> = [];
    let hasMore = false;
    for (const family of RECIPE_QC_FAMILIES) {
      if (decodedCursor && RECIPE_QC_FAMILIES.indexOf(family) < RECIPE_QC_FAMILIES.indexOf(decodedCursor.family)) continue;
      const table = familyTables[family];
      const conditions = [eq(table.scope, scope)];
      if (decodedCursor?.family === family) conditions.push(gt(table.id, decodedCursor.id));
      const page = await db.select().from(table).where(and(...conditions))
        .orderBy(asc(table.id)).limit(limit + 1 - rows.length);
      for (const row of page) {
        if (rows.length === limit) { hasMore = true; break; }
        rows.push({ family, row: row as RecipeRow });
      }
      if (hasMore || rows.length > limit) break;
    }

    const recordIds = rows.map(({ family, row }) => `${family}:${row.id}`);
    const latestCaptures = recordIds.length
      ? await db.select().from(qcWorkflowEventsTable).where(and(
          eq(qcWorkflowEventsTable.scope, scope),
          eq(qcWorkflowEventsTable.eventType, "recipe-committed"),
          inArray(qcWorkflowEventsTable.recordId, recordIds),
        )).orderBy(desc(qcWorkflowEventsTable.id))
      : [];
    const captureByRecord = new Map<string, (typeof latestCaptures)[number]>();
    for (const event of latestCaptures) {
      if (!captureByRecord.has(event.recordId)) captureByRecord.set(event.recordId, event);
    }
    const currentCaptureIds = [...captureByRecord.values()].map((event) => String(event.id));
    const decisions = currentCaptureIds.length
      ? await db.select().from(qcWorkflowEventsTable).where(and(
          eq(qcWorkflowEventsTable.scope, scope),
          eq(qcWorkflowEventsTable.eventType, "recipe-review"),
          inArray(qcWorkflowEventsTable.relatedEventId, currentCaptureIds),
        )).orderBy(desc(qcWorkflowEventsTable.id))
      : [];
    const decisionByCapture = new Map<string, (typeof decisions)[number]>();
    for (const event of decisions) {
      if (event.relatedEventId && !decisionByCapture.has(event.relatedEventId)) {
        decisionByCapture.set(event.relatedEventId, event);
      }
    }

    const items = rows.slice(0, limit).map(({ family, row }) => {
      const recordId = `${family}:${row.id}`;
      const capture = captureByRecord.get(recordId);
      const parsed = capture ? parseCapture(capture) : null;
      const isCurrent = !!parsed &&
        recipeQcResultHash(family, row.id, row) === parsed.resultHash;
      const decision = capture ? decisionByCapture.get(String(capture.id)) : undefined;
      const status = !isCurrent
        ? "unreviewed"
        : decision?.payload.status === "verified" || decision?.payload.status === "rejected"
          ? decision.payload.status
          : "pending";
      return { recipeType: family, recipeId: row.id, recipeName: row.name, status };
    });
    const last = rows[Math.min(rows.length, limit) - 1];
    res.setHeader("Cache-Control", "no-store");
    res.json({
      items,
      nextCursor: hasMore && last ? encodeStatusCursor(last.family, last.row.id) : null,
    });
  },
);

router.get("/qc/recipe-reviews", requireCapability("manage-qc"), async (req, res) => {
  const query = z.object({
    cursor: z.string().regex(/^[1-9]\d{0,8}$/).optional(),
    status: z.enum(statusValues).default("pending"),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  }).strict().safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Invalid recipe review filters" });
    return;
  }
  const { cursor, status, limit } = query.data;
  const scope = currentScope();
  const pageSize = 100;
  const maxScanned = 1000;
  const matches: Array<Record<string, unknown>> = [];
  let scanned = 0;
  let lastScanned: number | null = cursor ? Number(cursor) : null;
  let exhausted = false;
  while (matches.length <= limit && scanned < maxScanned) {
    const conditions = [
      eq(qcWorkflowEventsTable.scope, scope),
      eq(qcWorkflowEventsTable.eventType, "recipe-committed"),
    ];
    if (lastScanned !== null) conditions.push(lt(qcWorkflowEventsTable.id, lastScanned));
    const batch = await db.select().from(qcWorkflowEventsTable).where(and(...conditions))
      .orderBy(desc(qcWorkflowEventsTable.id)).limit(Math.min(pageSize, maxScanned - scanned));
    if (batch.length === 0) { exhausted = true; break; }
    const projected = await projectCaptureStatuses(batch, scope);
    for (const event of batch) {
      const state = projected.get(event.id);
      if (!state) continue;
      const selected = status === "all" || state.status === status;
      if (!selected) continue;
      matches.push({
        captureId: event.id,
        recipeType: event.payload.recipeType,
        recipeId: event.payload.recipeId,
        recipeName: event.payload.displayName,
        currentName: state.currentName,
        status: state.status,
        sourceState: state.sourceState,
        resultHash: event.payload.resultHash,
        actorId: event.actorId,
        createdAt: event.createdAt.toISOString(),
      });
      if (matches.length > limit) break;
    }
    scanned += batch.length;
    lastScanned = batch[batch.length - 1]!.id;
    if (batch.length < pageSize) { exhausted = true; break; }
  }
  const items = matches.slice(0, limit);
  let nextCursor: string | null = null;
  if (matches.length > limit) {
    nextCursor = String(items.at(-1)!.captureId);
  } else if (!exhausted && lastScanned !== null) {
    nextCursor = String(lastScanned);
  }
  res.setHeader("Cache-Control", "no-store");
  res.json({ items, nextCursor, scanLimitReached: !exhausted && scanned >= maxScanned });
});

router.get("/qc/recipe-reviews/:captureId", requireCapability("manage-qc"), async (req, res) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.captureId);
  if (!id.success) { res.status(400).json({ error: "Invalid recipe review revision" }); return; }
  const scope = currentScope();
  const [capture] = await db.select().from(qcWorkflowEventsTable).where(and(
    eq(qcWorkflowEventsTable.scope, scope),
    eq(qcWorkflowEventsTable.id, id.data),
    eq(qcWorkflowEventsTable.eventType, "recipe-committed"),
  )).limit(1);
  if (!capture) { res.status(404).json({ error: "Recipe review revision not found" }); return; }
  const parsed = parseCapture(capture);
  if (!parsed) { res.status(500).json({ error: "Stored recipe review evidence is invalid" }); return; }
  const [current, latestCapture] = await Promise.all([
    loadRecipe(db, parsed.family, scope, parsed.recipeId),
    db.select().from(qcWorkflowEventsTable).where(and(
      eq(qcWorkflowEventsTable.scope, scope),
      eq(qcWorkflowEventsTable.eventType, "recipe-committed"),
      eq(qcWorkflowEventsTable.recordId, capture.recordId),
    )).orderBy(desc(qcWorkflowEventsTable.id)).limit(1).then((rows) => rows[0]),
  ]);
  const decisions = await db.select().from(qcWorkflowEventsTable).where(and(
    eq(qcWorkflowEventsTable.scope, scope),
    eq(qcWorkflowEventsTable.eventType, "recipe-review"),
    eq(qcWorkflowEventsTable.relatedEventId, String(capture.id)),
  )).orderBy(desc(qcWorkflowEventsTable.id)).limit(20);
  const targetEventIds = [String(capture.id), ...decisions.map((event) => String(event.id))];
  const redactionEvents = await db.select().from(qcWorkflowEventsTable).where(and(
    eq(qcWorkflowEventsTable.scope, scope),
    eq(qcWorkflowEventsTable.eventType, "redaction"),
    inArray(qcWorkflowEventsTable.relatedEventId, targetEventIds),
  )).orderBy(asc(qcWorkflowEventsTable.id));
  const redactedFields = new Map<string, Set<string>>();
  for (const event of redactionEvents) {
    if (!event.relatedEventId || !Array.isArray(event.payload.fields)) continue;
    const fields = redactedFields.get(event.relatedEventId) ?? new Set<string>();
    for (const field of event.payload.fields) if (typeof field === "string") fields.add(field);
    redactedFields.set(event.relatedEventId, fields);
  }
  const captureRedactions = redactedFields.get(String(capture.id)) ?? new Set<string>();
  const summary = captureRedactions.has("payload.summary")
    ? { redacted: true }
    : { ...capture.payload };
  if (summary !== null && !("redacted" in summary)) {
    if (captureRedactions.has("payload.before")) delete summary.before;
    if (captureRedactions.has("payload.after")) delete summary.after;
    if (captureRedactions.has("payload.changedFields")) delete summary.changedFields;
  }
  const hashMatches = !!current &&
    recipeQcResultHash(parsed.family, parsed.recipeId, current) === parsed.resultHash;
  const state = !current ? "deleted"
    : current.name !== capture.payload.displayName ? "renamed"
      : "active";
  const status: ReviewStatus = !current ? "deleted"
    : latestCapture?.id !== capture.id || !hashMatches ? "superseded"
      : decisions[0]?.payload.status === "verified" || decisions[0]?.payload.status === "rejected"
        ? decisions[0].payload.status
        : "pending";
  res.setHeader("Cache-Control", "no-store");
  res.json({
    captureId: capture.id,
    recipeType: parsed.family,
    recipeId: parsed.recipeId,
    recipeName: capture.payload.displayName,
    currentName: current?.name ?? null,
    sourceState: state,
    status,
    resultHash: parsed.resultHash,
    summary,
    actorId: captureRedactions.has("actorId") ? "[redacted]" : capture.actorId,
    createdAt: capture.createdAt.toISOString(),
    decisionRevision: decisions[0]?.id ?? 0,
    decisions: decisions.map((event) => ({
      id: event.id,
      status: event.payload.status,
      resultHash: event.payload.resultHash,
      reason: redactedFields.get(String(event.id))?.has("payload.reason")
        ? "[redacted]"
        : event.payload.reason,
      actorId: redactedFields.get(String(event.id))?.has("actorId")
        ? "[redacted]"
        : event.actorId,
      createdAt: event.createdAt.toISOString(),
    })),
  });
});

const decisionSchema = z.object({
  decisionId: z.string().regex(/^[A-Za-z0-9_-]{16,120}$/),
  status: z.enum(["verified", "rejected"]),
  expectedResultHash: z.string().regex(/^[a-f0-9]{64}$/),
  expectedRevision: z.number().int().nonnegative().safe(),
  reason: z.string().trim().min(1).max(1000),
}).strict();

router.post("/qc/recipe-reviews/:captureId/decisions", requireCapability("manage-qc"), async (req, res) => {
  const id = z.coerce.number().int().positive().safeParse(req.params.captureId);
  const body = decisionSchema.safeParse(req.body);
  if (!id.success || !body.success || !req.userId) {
    res.status(400).json({ error: "Invalid recipe review decision; include a rationale" });
    return;
  }
  const scope = currentScope();
  const input = body.data;
  const result = await db.transaction(async (tx) => {
    const [outsideCapture] = await tx.select().from(qcWorkflowEventsTable).where(and(
      eq(qcWorkflowEventsTable.scope, scope),
      eq(qcWorkflowEventsTable.id, id.data),
      eq(qcWorkflowEventsTable.eventType, "recipe-committed"),
    )).limit(1);
    if (!outsideCapture) return { error: "Recipe review revision not found", code: 404 as const };
    const outsideParsed = parseCapture(outsideCapture);
    if (!outsideParsed) return { error: "Stored recipe review evidence is invalid", code: 500 as const };
    await lockRecipeQcFamily(tx, scope, outsideParsed.family);
    const operationId = `recipe-review:${input.decisionId}`;
    const [prior] = await tx.select().from(qcWorkflowEventsTable).where(and(
      eq(qcWorkflowEventsTable.scope, scope),
      eq(qcWorkflowEventsTable.operationId, operationId),
    )).limit(1);
    if (prior) {
      const matches = prior.eventType === "recipe-review" &&
        prior.actorId === req.userId &&
        prior.recordId === outsideCapture.recordId &&
        prior.relatedEventId === String(id.data) &&
        prior.payload.resultHash === input.expectedResultHash &&
        prior.payload.expectedRevision === input.expectedRevision &&
        prior.payload.status === input.status &&
        prior.payload.reason === input.reason;
      return matches
        ? { event: prior, replayed: true }
        : { error: "This retry identity belongs to a different review decision", code: 409 as const };
    }
    const [capture] = await tx.select().from(qcWorkflowEventsTable).where(and(
      eq(qcWorkflowEventsTable.scope, scope),
      eq(qcWorkflowEventsTable.id, id.data),
      eq(qcWorkflowEventsTable.eventType, "recipe-committed"),
    )).limit(1);
    if (!capture) return { error: "Recipe review revision not found", code: 404 as const };
    const parsed = parseCapture(capture);
    if (!parsed || parsed.resultHash !== input.expectedResultHash) {
      return { error: "The reviewed recipe hash changed. Refresh the review before deciding.", code: 409 as const };
    }
    const [latestCapture] = await tx.select().from(qcWorkflowEventsTable).where(and(
      eq(qcWorkflowEventsTable.scope, scope),
      eq(qcWorkflowEventsTable.recordId, capture.recordId),
      eq(qcWorkflowEventsTable.eventType, "recipe-committed"),
    )).orderBy(desc(qcWorkflowEventsTable.id)).limit(1);
    if (!latestCapture || latestCapture.id !== capture.id) {
      return { error: "This recipe revision was superseded. Review the current pending revision.", code: 409 as const };
    }
    const current = await loadRecipe(tx, parsed.family, scope, parsed.recipeId);
    if (!current || recipeQcResultHash(parsed.family, parsed.recipeId, current) !== parsed.resultHash) {
      return { error: "The recipe no longer matches this revision. Refresh and review the current recipe.", code: 409 as const };
    }
    const [latestDecision] = await tx.select().from(qcWorkflowEventsTable).where(and(
      eq(qcWorkflowEventsTable.scope, scope),
      eq(qcWorkflowEventsTable.eventType, "recipe-review"),
      eq(qcWorkflowEventsTable.relatedEventId, String(capture.id)),
    )).orderBy(desc(qcWorkflowEventsTable.id)).limit(1);
    if ((latestDecision?.id ?? 0) !== input.expectedRevision) {
      return { error: "Another QC manager decided this revision. Refresh its history before continuing.", code: 409 as const };
    }
    const [event] = await tx.insert(qcWorkflowEventsTable).values({
      scope,
      operationId,
      recordId: capture.recordId,
      eventType: "recipe-review",
      relatedEventId: String(capture.id),
      actorId: req.userId!,
      payload: {
        decisionId: input.decisionId,
        status: input.status,
        resultHash: parsed.resultHash,
        expectedRevision: input.expectedRevision,
        reason: input.reason,
      },
    }).returning();
    return { event, replayed: false };
  });
  if ("error" in result && result.error) {
    res.status(result.code ?? 500).json({ error: result.error });
    return;
  }
  if (!result.event) {
    res.status(500).json({ error: "Recipe review decision was not recorded" });
    return;
  }
  res.status(result.replayed ? 200 : 201).json({
    captureId: id.data,
    status: result.event.payload.status,
    resultHash: result.event.payload.resultHash,
    decisionRevision: result.event.id,
    replayed: result.replayed,
  });
});

export default router;
