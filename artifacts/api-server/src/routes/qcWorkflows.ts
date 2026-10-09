import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { and, desc, eq, gt, gte, inArray, lt, lte, max, sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import * as z from "zod";
import {
  brandProfilesTable,
  db,
  ingredientsTable,
  qcWorkflowEventsTable,
  type QcWorkflowEventRow,
} from "@workspace/db";
import { currentScope } from "../lib/requestScope";
import { requireCapability } from "../middlewares/requireCapability";

const router: IRouter = Router();
const MAX_NOTE = 1_000;
const MAX_RUN_ID = 200;
const MAX_PROFILE_KEY = 400;
const MAX_HISTORY_PAGE = 100;
const MAX_RUN_PAGE = 200;
const MAX_EXPORT_PAGE = 500;
const UNIT = z.enum(["oz", "g", "lb", "kg"]);
const STATION = z.enum(["dough", "sauce", "frontline", "warehouse", "packaging", "other"]);
const CHECK_TYPE = z.enum(["pre-run", "30-minute"]);
const CLEANING_METHOD = z.enum(["standard", "deep", "chemical", "other"]);
const CLEANING_STATUS = z.enum(["verified", "unverified", "unknown", "not-applicable"]);
const STAGED_STATUS = z.enum(["reviewed", "not-reviewed", "unknown"]);
const FOOTPRINT_STATUS = z.enum(["complete", "incomplete", "unavailable"]);
const ALLERGEN = z.enum([
  "egg",
  "soy",
  "milk",
  "wheat",
  "peanuts",
  "tree nuts",
  "fish",
  "shellfish",
  "sesame",
]);

const operationIdSchema = z.string().uuid();
const runIdSchema = z.string().trim().min(1).max(MAX_RUN_ID);
const profileKeySchema = z.string().trim().min(1).max(MAX_PROFILE_KEY);
const ingredientIdSchema = z.string().trim().min(1).max(200);
const noteSchema = z.string().trim().max(MAX_NOTE).optional().default("");

const lotBodySchema = z.object({
  operationId: operationIdSchema,
  runId: runIdSchema,
  ingredientId: ingredientIdSchema,
  station: STATION,
  lotNumber: z.string().trim().min(1).max(200),
  note: noteSchema,
});

const weightBodySchema = z.object({
  operationId: operationIdSchema,
  runId: runIdSchema,
  profileKey: profileKeySchema,
  ingredientId: ingredientIdSchema,
  checkType: CHECK_TYPE,
  actualValue: z.number().finite().positive().max(1_000_000),
  actualUnit: UNIT,
  note: noteSchema,
});

const targetBodySchema = z.object({
  operationId: operationIdSchema,
  profileKey: profileKeySchema,
  ingredientId: ingredientIdSchema,
  targetValue: z.number().finite().positive().max(1_000_000).nullable(),
  unit: UNIT.nullable(),
  toleranceValue: z.number().finite().min(0).max(100_000).nullable(),
  reason: z.string().trim().min(1).max(500),
});

const footprintSchema = z.object({
  status: FOOTPRINT_STATUS,
  allergens: z.array(ALLERGEN).max(9),
  unknownIngredients: z.array(z.string().trim().min(1).max(200)).max(100),
  missingComponents: z.array(z.string().trim().min(1).max(100)).max(30),
});

const allergenReviewBodySchema = z.object({
  operationId: operationIdSchema,
  runId: runIdSchema,
  footprintReviewed: z.literal(true),
  footprint: footprintSchema,
  stagedIngredients: z.array(z.object({
    area: z.enum(["Dough", "Sauce", "Frontline"]),
    name: z.string().trim().min(1).max(200),
    quantity: z.string().trim().min(1).max(50),
    unit: z.string().trim().min(1).max(30),
    staged: z.boolean(),
  })).max(200),
  stagedIngredientsStatus: STAGED_STATUS,
  cleaningStatus: CLEANING_STATUS,
  note: noteSchema,
});

const cleaningBodySchema = z.object({
  operationId: operationIdSchema,
  runId: runIdSchema,
  method: CLEANING_METHOD,
  startedAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }),
  note: noteSchema,
}).superRefine((body, ctx) => {
  const start = Date.parse(body.startedAt);
  const end = Date.parse(body.endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    ctx.addIssue({ code: "custom", path: ["endedAt"], message: "End time must be after start time" });
  }
  if (end > Date.now() + 5 * 60_000) {
    ctx.addIssue({ code: "custom", path: ["endedAt"], message: "End time cannot be in the future" });
  }
});

const signoffBodySchema = z.object({
  operationId: operationIdSchema,
  runId: runIdSchema,
  note: noteSchema,
});

const correctionBodySchema = z.object({
  operationId: operationIdSchema,
  reason: z.string().trim().min(1).max(500),
  replacement: z.record(z.string(), z.unknown()).refine(
    (value) => Object.keys(value).length > 0 && Object.keys(value).length <= 8,
    "A correction must change at least one field and no more than eight fields",
  ),
});

const redactionBodySchema = z.object({
  operationId: operationIdSchema,
  reason: z.string().trim().min(1).max(500),
  fields: z.array(z.enum(["actorId", "ingredientName", "payload.note", "payload.lotNumber"]))
    .min(1)
    .max(4)
    .refine((fields) => new Set(fields).size === fields.length, "Redaction fields must be unique"),
});

type EventInsert = typeof qcWorkflowEventsTable.$inferInsert;
type EventWriter = Pick<typeof db, "insert">;

type TargetCandidate = {
  ingredientId: string;
  ingredientName: string;
  targetValue: number;
  unit: "oz";
  sourceField: string;
};

type QcTarget = {
  ingredientId: string;
  ingredientName: string;
  targetValue: number | null;
  unit: string | null;
  toleranceValue: number | null;
  source: "spec-import" | "qc-override" | "not-configured";
  state: "configured" | "not-evaluated";
  reason?: string;
  overrideEventId?: number;
};

function safeError(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

function profileKeyFromRequest(value: unknown): string | null {
  const parsed = profileKeySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function currentActor(req: Request): string | null {
  return typeof req.userId === "string" && req.userId.length > 0 ? req.userId : null;
}

async function insertEvent(executor: EventWriter, values: EventInsert): Promise<QcWorkflowEventRow> {
  const [row] = await executor.insert(qcWorkflowEventsTable).values(values).returning();
  return row;
}

async function appendRunEvent(
  executor: EventWriter,
  scope: string,
  actorId: string,
  input: Omit<EventInsert, "scope" | "actorId" | "createdAt">,
): Promise<QcWorkflowEventRow> {
  return insertEvent(executor, {
    ...input,
    scope,
    actorId,
  });
}

function lockRun(scope: string, runId: string) {
  return sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${scope}:${runId}`}, 0))`;
}

function lockTarget(scope: string, profileKey: string, ingredientId: string) {
  return sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${scope}:${profileKey}:${ingredientId}`}, 0))`;
}

function eventToApi(row: QcWorkflowEventRow) {
  return {
    id: row.id,
    operationId: row.operationId,
    recordId: row.recordId,
    eventType: row.eventType,
    runId: row.runId,
    profileKey: row.profileKey,
    ingredientId: row.ingredientId,
    ingredientName: row.ingredientName,
    station: row.station,
    relatedEventId: row.relatedEventId,
    actorId: row.actorId,
    payload: row.payload,
    createdAt: row.createdAt.toISOString(),
  };
}

function normalizedName(value: unknown): string {
  return typeof value === "string" ? value.trim().toLocaleLowerCase("en-US") : "";
}

function numericPositive(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1_000_000) {
    return null;
  }
  return value;
}

function numericTolerance(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100_000) {
    return null;
  }
  return value;
}

function collectImportedTargetCandidates(
  profile: Record<string, unknown>,
  ingredients: Array<{ id: string; name: string; enabled: boolean; mergedInto: string | null }>,
): TargetCandidate[] {
  const byName = new Map<string, typeof ingredients>();
  for (const ingredient of ingredients) {
    if (!ingredient.enabled || ingredient.mergedInto) continue;
    const key = normalizedName(ingredient.name);
    if (!key) continue;
    const rows = byName.get(key) ?? [];
    rows.push(ingredient);
    byName.set(key, rows);
  }
  const candidates: TargetCandidate[] = [];
  const add = (nameValue: unknown, weightValue: unknown, sourceField: string) => {
    const name = typeof nameValue === "string" ? nameValue.trim() : "";
    const targetValue = numericPositive(weightValue);
    if (!name || targetValue === null) return;
    const matches = byName.get(normalizedName(name)) ?? [];
    if (matches.length !== 1) return;
    candidates.push({
      ingredientId: matches[0]!.id,
      ingredientName: matches[0]!.name,
      targetValue,
      unit: "oz",
      sourceField,
    });
  };

  for (const slot of ["app1", "app2", "app3", "app4"]) {
    const type = profile[`${slot}Type`];
    const linkedRecipe = profile[`${slot}CheeseRecipeName`];
    const typeIsRecipe = typeof type === "string" && /^(?:cheese|mix)$/i.test(type.trim());
    add(
      typeIsRecipe ? linkedRecipe : type,
      profile[`${slot}OzPerPizza`],
      `${slot}OzPerPizza`,
    );
  }
  add(profile.pep1Type, profile.pep1OzPerPizza, "pep1OzPerPizza");
  add(profile.pep2Type, profile.pep2OzPerPizza, "pep2OzPerPizza");
  add(profile.frontlineRecipeName, profile.sauceOzPerPizza, "sauceOzPerPizza");
  // The spec importer maps the target doughball value to the named dough
  // recipe on the profile. It is only usable when that exact name resolves to
  // one active stable ingredient identity. No crust-specific target is
  // inferred: the current import contract has no explicit crust target field.
  add(profile.doughRecipeName, profile.targetDoughballWeight, "targetDoughballWeight");
  return candidates;
}

async function resolveTargets(profileKey: string): Promise<QcTarget[]> {
  const scope = currentScope();
  const [profileRow, ingredientRows, overrideRows] = await Promise.all([
    db.select().from(brandProfilesTable).where(and(
      eq(brandProfilesTable.scope, scope),
      eq(brandProfilesTable.key, profileKey),
    )).limit(1),
    db.select({
      id: ingredientsTable.id,
      name: ingredientsTable.name,
      enabled: ingredientsTable.enabled,
      mergedInto: ingredientsTable.mergedInto,
    }).from(ingredientsTable).where(eq(ingredientsTable.scope, scope)),
    db.select().from(qcWorkflowEventsTable).where(and(
      eq(qcWorkflowEventsTable.scope, scope),
      eq(qcWorkflowEventsTable.eventType, "target-setting"),
      eq(qcWorkflowEventsTable.profileKey, profileKey),
    )).orderBy(desc(qcWorkflowEventsTable.id)),
  ]);
  const imported = profileRow[0]
    ? collectImportedTargetCandidates(
      profileRow[0].values as Record<string, unknown>,
      ingredientRows,
    )
    : [];
  const importedById = new Map<string, TargetCandidate[]>();
  for (const candidate of imported) {
    const list = importedById.get(candidate.ingredientId) ?? [];
    list.push(candidate);
    importedById.set(candidate.ingredientId, list);
  }
  const latestOverrides = new Map<string, QcWorkflowEventRow>();
  for (const row of overrideRows) {
    if (row.ingredientId && !latestOverrides.has(row.ingredientId)) {
      latestOverrides.set(row.ingredientId, row);
    }
  }
  const ids = new Set<string>([
    ...importedById.keys(),
    ...latestOverrides.keys(),
  ]);
  const targets: QcTarget[] = [];
  const ingredientById = new Map(ingredientRows.map((row) => [row.id, row]));
  for (const ingredient of ingredientRows) {
    if (!ingredient.enabled || ingredient.mergedInto) continue;
    ids.add(ingredient.id);
  }
  for (const ingredientId of [...ids].sort((a, b) =>
    (ingredientById.get(a)?.name ?? "").localeCompare(ingredientById.get(b)?.name ?? ""),
  )) {
    const ingredient = ingredientById.get(ingredientId);
    if (!ingredient) continue;
    const override = latestOverrides.get(ingredientId);
    if (override?.payload.active === true) {
      const payload = override.payload;
      const targetValue = numericPositive(payload.targetValue);
      const unit = typeof payload.unit === "string" ? payload.unit : null;
      const toleranceValue = numericTolerance(payload.toleranceValue);
      targets.push({
        ingredientId,
        ingredientName: ingredient.name,
        targetValue,
        unit,
        toleranceValue,
        source: targetValue !== null ? "qc-override" : "not-configured",
        state: targetValue !== null && unit !== null && toleranceValue !== null
          ? "configured"
          : "not-evaluated",
        ...(targetValue === null ? { reason: "QC override is invalid." } : {}),
        overrideEventId: override.id,
      });
      continue;
    }
    const candidates = importedById.get(ingredientId) ?? [];
    const values = [...new Set(candidates.map((candidate) => candidate.targetValue))];
    if (values.length === 1) {
      targets.push({
        ingredientId,
        ingredientName: ingredient.name,
        targetValue: values[0]!,
        unit: "oz",
        toleranceValue: 0.1,
        source: "spec-import",
        state: "configured",
      });
    } else if (values.length > 1) {
      targets.push({
        ingredientId,
        ingredientName: ingredient.name,
        targetValue: null,
        unit: null,
        toleranceValue: null,
        source: "not-configured",
        state: "not-evaluated",
        reason: "Conflicting explicit profile targets require a reviewed QC override.",
      });
    } else {
      targets.push({
        ingredientId,
        ingredientName: ingredient.name,
        targetValue: null,
        unit: null,
        toleranceValue: null,
        source: "not-configured",
        state: "not-evaluated",
        reason: profileRow[0]
          ? "No explicit target is available from the imported profile."
          : "No saved product profile is available.",
      });
    }
  }
  return targets;
}

function parseDateParam(value: unknown, endOfDay = false): Date | null | undefined {
  if (value === undefined) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return undefined;
  const date = new Date(value.length === 10
    ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`
    : value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function parseHistoryFilters(req: Request, limitOverride?: number) {
  const from = parseDateParam(req.query.from);
  const to = parseDateParam(req.query.to, true);
  const limitRaw = req.query.limit === undefined ? "50" : String(req.query.limit);
  const limit = limitOverride ?? Number(limitRaw);
  const cursorRaw = req.query.cursor === undefined ? undefined : String(req.query.cursor);
  const cursor = cursorRaw === undefined ? undefined : Number(cursorRaw);
  const runId = req.query.runId === undefined ? undefined : runIdSchema.safeParse(req.query.runId);
  const ingredientId = req.query.ingredientId === undefined
    ? undefined
    : ingredientIdSchema.safeParse(req.query.ingredientId);
  const station = req.query.station === undefined ? undefined : STATION.safeParse(req.query.station);
  if (
    from === undefined ||
    to === undefined ||
    (from && to && from > to) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_HISTORY_PAGE ||
    (cursor !== undefined && (!Number.isSafeInteger(cursor) || cursor < 1)) ||
    (runId && !runId.success) ||
    (ingredientId && !ingredientId.success) ||
    (station && !station.success)
  ) return null;
  if (from && to && to.getTime() - from.getTime() > 366 * 24 * 60 * 60_000) return null;
  return {
    from: from ?? undefined,
    to: to ?? undefined,
    limit,
    cursor,
    runId: runId?.success ? runId.data : undefined,
    ingredientId: ingredientId?.success ? ingredientId.data : undefined,
    station: station?.success ? station.data : undefined,
  };
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined
    ? ""
    : typeof value === "string"
      ? value
      : JSON.stringify(value);
  return `"${text.replaceAll('"', '""')}"`;
}

async function hydrateEvents(rows: QcWorkflowEventRow[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => String(row.id));
  const overlays = await db.select().from(qcWorkflowEventsTable).where(and(
    eq(qcWorkflowEventsTable.scope, currentScope()),
    inArray(qcWorkflowEventsTable.relatedEventId, ids),
  )).orderBy(qcWorkflowEventsTable.id);
  const corrections = new Map<string, Record<string, unknown>>();
  const correctedStations = new Map<string, string>();
  const redactions = new Map<string, Set<string>>();
  for (const overlay of overlays) {
    const target = overlay.relatedEventId;
    if (!target) continue;
    if (overlay.eventType === "correction") {
      const replacement = overlay.payload.replacement;
      if (replacement && typeof replacement === "object" && !Array.isArray(replacement)) {
        corrections.set(target, {
          ...(corrections.get(target) ?? {}),
          ...(replacement as Record<string, unknown>),
        });
        if (typeof (replacement as Record<string, unknown>).station === "string") {
          correctedStations.set(target, String((replacement as Record<string, unknown>).station));
        }
      }
    }
    if (overlay.eventType === "redaction" && Array.isArray(overlay.payload.fields)) {
      const fields = redactions.get(target) ?? new Set<string>();
      for (const field of overlay.payload.fields) {
        if (typeof field === "string") fields.add(field);
      }
      redactions.set(target, fields);
    }
  }
  return rows.map((row) => {
    const output = eventToApi(row) as Omit<ReturnType<typeof eventToApi>, "actorId" | "ingredientName" | "payload"> & {
      actorId: string | null;
      ingredientName: string | null;
      payload: Record<string, unknown>;
      redactedFields?: string[];
      corrected?: boolean;
    };
    const replacement = corrections.get(String(row.id));
    if (replacement) {
      output.payload = { ...output.payload, ...replacement };
      const actualValue = numericPositive(output.payload.actualValue);
      const targetValue = numericPositive(output.payload.targetValue);
      const toleranceValue = numericTolerance(output.payload.toleranceValue);
      const unitMatches = output.payload.actualUnit === output.payload.targetUnit;
      output.payload = {
        ...output.payload,
        ...(row.eventType === "weight"
          ? {
            outcome: actualValue === null || targetValue === null ||
              toleranceValue === null || !unitMatches
              ? "not-evaluated"
              : Math.abs(actualValue - targetValue) <= toleranceValue
                ? "within-tolerance"
                : "out-of-tolerance",
          }
          : {}),
      };
      output.corrected = true;
    }
    const station = correctedStations.get(String(row.id));
    if (station) output.station = station;
    const fields = redactions.get(String(row.id));
    if (fields?.has("actorId")) output.actorId = null;
    if (fields?.has("ingredientName")) output.ingredientName = null;
    if (fields?.has("payload.note")) output.payload = { ...output.payload, note: "[redacted]" };
    if (fields?.has("payload.lotNumber")) output.payload = { ...output.payload, lotNumber: "[redacted]" };
    if (fields?.size) output.redactedFields = [...fields];
    return output;
  });
}

function validateCorrection(
  eventType: string,
  value: Record<string, unknown>,
): Record<string, unknown> | null {
  const correctionNote = z.string().trim().max(MAX_NOTE).optional();
  const schema = eventType === "lot"
    ? z.object({
      lotNumber: z.string().trim().min(1).max(200).optional(),
      note: correctionNote,
      station: STATION.optional(),
    }).strict()
    : eventType === "weight"
      ? z.object({
        actualValue: z.number().finite().positive().max(1_000_000).optional(),
        actualUnit: UNIT.optional(),
        checkType: CHECK_TYPE.optional(),
        note: correctionNote,
      }).strict()
      : eventType === "allergen-review"
        ? z.object({
          footprint: footprintSchema.optional(),
          stagedIngredients: allergenReviewBodySchema.shape.stagedIngredients.optional(),
          stagedIngredientsStatus: STAGED_STATUS.optional(),
          cleaningStatus: CLEANING_STATUS.optional(),
          note: correctionNote,
        }).strict()
        : eventType === "cleaning"
          ? z.object({
            method: CLEANING_METHOD.optional(),
            startedAt: z.string().datetime({ offset: true }).optional(),
            endedAt: z.string().datetime({ offset: true }).optional(),
            note: correctionNote,
          }).strict()
          : null;
  if (!schema) return null;
  const parsed = schema.safeParse(value);
  if (!parsed.success || Object.keys(parsed.data).length === 0) return null;
  return parsed.data as Record<string, unknown>;
}

function publicEvent(row: QcWorkflowEventRow) {
  return eventToApi(row);
}

function requireValid<T>(
  schema: z.ZodType<T>,
  body: unknown,
  res: Response,
): T | null {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    safeError(res, 400, "Invalid QC input");
    return null;
  }
  return parsed.data;
}

async function findActiveIngredient(ingredientId: string) {
  const [ingredient] = await db.select().from(ingredientsTable).where(and(
    eq(ingredientsTable.scope, currentScope()),
    eq(ingredientsTable.id, ingredientId),
    eq(ingredientsTable.enabled, true),
  )).limit(1);
  if (!ingredient || ingredient.mergedInto) return null;
  return ingredient;
}

async function findOperation(operationId: string) {
  const [existing] = await db.select().from(qcWorkflowEventsTable).where(and(
    eq(qcWorkflowEventsTable.scope, currentScope()),
    eq(qcWorkflowEventsTable.operationId, operationId),
  )).limit(1);
  return existing;
}

function reportRouteError(req: Request, res: Response, message: string, error: unknown): void {
  req.log.error({ err: error }, message);
  safeError(res, 500, "QC operation failed");
}

router.get("/qc/targets", requireCapability("record-qc"), async (req, res) => {
  const profileKey = profileKeyFromRequest(req.query.profileKey);
  if (!profileKey) {
    safeError(res, 400, "A valid profileKey is required");
    return;
  }
  try {
    res.json({ profileKey, targets: await resolveTargets(profileKey) });
  } catch (error) {
    reportRouteError(req, res, "failed to resolve QC weight targets", error);
  }
});

router.post("/qc/targets", requireCapability("manage-qc"), async (req, res) => {
  const body = requireValid(targetBodySchema, req.body, res);
  const actorId = currentActor(req);
  if (!body || !actorId) {
    if (!actorId) safeError(res, 401, "Unauthorized");
    return;
  }
  if (
    body.targetValue === null
      ? body.unit !== null || body.toleranceValue !== null
      : body.unit === null
  ) {
    safeError(res, 400, "A target and unit are required unless clearing the complete override");
    return;
  }
  try {
    const ingredient = await findActiveIngredient(body.ingredientId);
    if (!ingredient) {
      safeError(res, 404, "Ingredient identity is unavailable");
      return;
    }
    const event = await db.transaction(async (tx) => {
      await tx.execute(lockTarget(currentScope(), body.profileKey, ingredient.id));
      return appendRunEvent(tx, currentScope(), actorId, {
      operationId: body.operationId,
      recordId: randomUUID(),
      eventType: "target-setting",
      profileKey: body.profileKey,
      ingredientId: ingredient.id,
      ingredientName: ingredient.name,
      payload: {
        active: body.targetValue !== null,
        targetValue: body.targetValue,
        unit: body.unit,
        toleranceValue: body.targetValue === null
          ? null
          : body.toleranceValue ?? 0.1,
        source: "qc-override",
        reason: body.reason,
      },
      });
    });
    res.status(201).json({ event: publicEvent(event) });
  } catch (error) {
    if (await findOperation(body.operationId)) {
      safeError(res, 409, "This operation ID was already used");
      return;
    }
    reportRouteError(req, res, "failed to save QC target override", error);
  }
});

router.post("/qc/lots", requireCapability("record-qc"), async (req, res) => {
  const body = requireValid(lotBodySchema, req.body, res);
  const actorId = currentActor(req);
  if (!body || !actorId) {
    if (!actorId) safeError(res, 401, "Unauthorized");
    return;
  }
  try {
    const ingredient = await findActiveIngredient(body.ingredientId);
    if (!ingredient) {
      safeError(res, 404, "Ingredient identity is unavailable");
      return;
    }
    const event = await db.transaction(async (tx) => {
      await tx.execute(lockRun(currentScope(), body.runId));
      return appendRunEvent(tx, currentScope(), actorId, {
        operationId: body.operationId,
        recordId: randomUUID(),
        eventType: "lot",
        runId: body.runId,
        ingredientId: ingredient.id,
        ingredientName: ingredient.name,
        station: body.station,
        payload: { lotNumber: body.lotNumber, note: body.note },
      });
    });
    res.status(201).json({ event: publicEvent(event) });
  } catch (error) {
    if (await findOperation(body.operationId)) {
      safeError(res, 409, "This operation ID was already used");
      return;
    }
    reportRouteError(req, res, "failed to record QC lot", error);
  }
});

router.post("/qc/weight-checks", requireCapability("record-qc"), async (req, res) => {
  const body = requireValid(weightBodySchema, req.body, res);
  const actorId = currentActor(req);
  if (!body || !actorId) {
    if (!actorId) safeError(res, 401, "Unauthorized");
    return;
  }
  try {
    const ingredient = await findActiveIngredient(body.ingredientId);
    if (!ingredient) {
      safeError(res, 404, "Ingredient identity is unavailable");
      return;
    }
    const targets = await resolveTargets(body.profileKey);
    const target = targets.find((candidate) => candidate.ingredientId === ingredient.id);
    const targetIsConfigured = target?.state === "configured"
      && target.targetValue !== null
      && target.toleranceValue !== null
      && target.unit !== null;
    const targetUnitMatches = targetIsConfigured && target!.unit === body.actualUnit;
    const deviation = targetUnitMatches
      ? Math.abs(body.actualValue - target.targetValue!)
      : null;
    const outcome = !targetUnitMatches
      ? "not-evaluated"
      : deviation! <= target!.toleranceValue!
        ? "within-tolerance"
        : "out-of-tolerance";
    if (outcome === "out-of-tolerance" && !body.note.trim()) {
      safeError(res, 400, "Add a reason or note for an out-of-tolerance result");
      return;
    }
    const event = await db.transaction(async (tx) => {
      await tx.execute(lockRun(currentScope(), body.runId));
      return appendRunEvent(tx, currentScope(), actorId, {
        operationId: body.operationId,
        recordId: randomUUID(),
        eventType: "weight",
        runId: body.runId,
        profileKey: body.profileKey,
        ingredientId: ingredient.id,
        ingredientName: ingredient.name,
        payload: {
          checkType: body.checkType,
          targetValue: targetIsConfigured ? target!.targetValue : null,
          targetUnit: targetIsConfigured ? target!.unit : null,
          toleranceValue: targetIsConfigured ? target!.toleranceValue : null,
          targetSource: targetIsConfigured ? target!.source : "not-configured",
          actualValue: body.actualValue,
          actualUnit: body.actualUnit,
          outcome,
          note: body.note,
        },
      });
    });
    res.status(201).json({ event: publicEvent(event) });
  } catch (error) {
    if (await findOperation(body.operationId)) {
      safeError(res, 409, "This operation ID was already used");
      return;
    }
    reportRouteError(req, res, "failed to record QC weight check", error);
  }
});

router.get("/qc/runs/:runId", requireCapability("record-qc"), async (req, res) => {
  const parsedRunId = runIdSchema.safeParse(req.params.runId);
  if (!parsedRunId.success) {
    safeError(res, 400, "A valid runId is required");
    return;
  }
  const limit = MAX_RUN_PAGE;
  try {
    const scope = currentScope();
    const rows = await db.select().from(qcWorkflowEventsTable).where(and(
      eq(qcWorkflowEventsTable.scope, scope),
      eq(qcWorkflowEventsTable.runId, parsedRunId.data),
    )).orderBy(desc(qcWorkflowEventsTable.id)).limit(limit + 1);
    const [latestSignoff] = await db.select().from(qcWorkflowEventsTable).where(and(
      eq(qcWorkflowEventsTable.scope, scope),
      eq(qcWorkflowEventsTable.runId, parsedRunId.data),
      eq(qcWorkflowEventsTable.eventType, "run-signoff"),
    )).orderBy(desc(qcWorkflowEventsTable.id)).limit(1);
    const [latestRecord] = await db.select({ id: max(qcWorkflowEventsTable.id) })
      .from(qcWorkflowEventsTable)
      .where(and(
        eq(qcWorkflowEventsTable.scope, scope),
        eq(qcWorkflowEventsTable.runId, parsedRunId.data),
        sql`${qcWorkflowEventsTable.eventType} <> 'run-signoff'`,
        sql`${qcWorkflowEventsTable.eventType} <> 'target-setting'`,
      ));
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const items = await hydrateEvents(pageRows);
    const signoff = latestSignoff;
    const reviewedThroughId = signoff
      ? Number(signoff.payload.reviewedThroughId ?? 0)
      : 0;
    const signedOff = Boolean(signoff) && Number(latestRecord?.id ?? 0) <= reviewedThroughId;
    const [publicSignoff] = signoff ? await hydrateEvents([signoff]) : [];
    res.json({
      runId: parsedRunId.data,
      items,
      hasMore,
      nextCursor: hasMore ? pageRows[pageRows.length - 1]?.id ?? null : null,
      signoff: signoff
        ? {
          eventId: signoff.id,
          actorId: publicSignoff?.actorId ?? null,
          createdAt: signoff.createdAt.toISOString(),
          note: String(publicSignoff?.payload.note ?? ""),
          signedOff,
          reopened: !signedOff,
        }
        : null,
    });
  } catch (error) {
    reportRouteError(req, res, "failed to load QC run records", error);
  }
});

router.post("/qc/allergen-reviews", requireCapability("record-qc"), async (req, res) => {
  const body = requireValid(allergenReviewBodySchema, req.body, res);
  const actorId = currentActor(req);
  if (!body || !actorId) {
    if (!actorId) safeError(res, 401, "Unauthorized");
    return;
  }
  try {
    const event = await db.transaction(async (tx) => {
      await tx.execute(lockRun(currentScope(), body.runId));
      return appendRunEvent(tx, currentScope(), actorId, {
        operationId: body.operationId,
        recordId: randomUUID(),
        eventType: "allergen-review",
        runId: body.runId,
        payload: {
          footprintReviewed: true,
          footprint: body.footprint,
          stagedIngredients: body.stagedIngredients,
          stagedIngredientsStatus: body.stagedIngredientsStatus,
          cleaningStatus: body.cleaningStatus,
          note: body.note,
        },
      });
    });
    res.status(201).json({ event: publicEvent(event) });
  } catch (error) {
    if (await findOperation(body.operationId)) {
      safeError(res, 409, "This operation ID was already used");
      return;
    }
    reportRouteError(req, res, "failed to record allergen checklist", error);
  }
});

router.post("/qc/cleaning-records", requireCapability("record-qc"), async (req, res) => {
  const body = requireValid(cleaningBodySchema, req.body, res);
  const actorId = currentActor(req);
  if (!body || !actorId) {
    if (!actorId) safeError(res, 401, "Unauthorized");
    return;
  }
  try {
    const event = await db.transaction(async (tx) => {
      await tx.execute(lockRun(currentScope(), body.runId));
      return appendRunEvent(tx, currentScope(), actorId, {
        operationId: body.operationId,
        recordId: randomUUID(),
        eventType: "cleaning",
        runId: body.runId,
        payload: {
          method: body.method,
          startedAt: body.startedAt,
          endedAt: body.endedAt,
          note: body.note,
        },
      });
    });
    res.status(201).json({ event: publicEvent(event) });
  } catch (error) {
    if (await findOperation(body.operationId)) {
      safeError(res, 409, "This operation ID was already used");
      return;
    }
    reportRouteError(req, res, "failed to record cleaning", error);
  }
});

router.post("/qc/cleaning-records/:eventId/verification", requireCapability("record-qc"), async (req, res) => {
  const eventId = Number(req.params.eventId);
  const body = requireValid(z.object({
    operationId: operationIdSchema,
    note: noteSchema,
  }), req.body, res);
  const actorId = currentActor(req);
  if (!body || !actorId) {
    if (!actorId) safeError(res, 401, "Unauthorized");
    return;
  }
  if (!Number.isSafeInteger(eventId) || eventId < 1) {
    safeError(res, 400, "A valid cleaning record ID is required");
    return;
  }
  try {
    const [cleaning] = await db.select().from(qcWorkflowEventsTable).where(and(
      eq(qcWorkflowEventsTable.scope, currentScope()),
      eq(qcWorkflowEventsTable.eventType, "cleaning"),
      eq(qcWorkflowEventsTable.id, eventId),
    )).limit(1);
    if (!cleaning) {
      safeError(res, 404, "Cleaning record not found");
      return;
    }
    if (cleaning.actorId === actorId) {
      safeError(res, 400, "Cleaning must be verified by a different authenticated person");
      return;
    }
    const event = await db.transaction(async (tx) => {
      await tx.execute(lockRun(currentScope(), cleaning.runId ?? ""));
      const [existing] = await tx.select({ id: qcWorkflowEventsTable.id })
        .from(qcWorkflowEventsTable)
        .where(and(
          eq(qcWorkflowEventsTable.scope, currentScope()),
          eq(qcWorkflowEventsTable.eventType, "cleaning-verification"),
          eq(qcWorkflowEventsTable.relatedEventId, String(cleaning.id)),
        ))
        .limit(1);
      if (existing) throw new Error("CLEANING_ALREADY_VERIFIED");
      return appendRunEvent(tx, currentScope(), actorId, {
        operationId: body.operationId,
        recordId: cleaning.recordId,
        eventType: "cleaning-verification",
        runId: cleaning.runId,
        relatedEventId: String(cleaning.id),
        payload: { note: body.note },
      });
    });
    res.status(201).json({ event: publicEvent(event) });
  } catch (error) {
    if (error instanceof Error && error.message === "CLEANING_ALREADY_VERIFIED") {
      safeError(res, 409, "This cleaning record has already been verified");
      return;
    }
    if (await findOperation(body.operationId)) {
      safeError(res, 409, "This operation ID was already used");
      return;
    }
    reportRouteError(req, res, "failed to verify cleaning", error);
  }
});

router.post("/qc/run-signoffs", requireCapability("manage-qc"), async (req, res) => {
  const body = requireValid(signoffBodySchema, req.body, res);
  const actorId = currentActor(req);
  if (!body || !actorId) {
    if (!actorId) safeError(res, 401, "Unauthorized");
    return;
  }
  try {
    const event = await db.transaction(async (tx) => {
      await tx.execute(lockRun(currentScope(), body.runId));
      const [lastRecord] = await tx.select({ id: max(qcWorkflowEventsTable.id) })
        .from(qcWorkflowEventsTable)
        .where(and(
          eq(qcWorkflowEventsTable.scope, currentScope()),
          eq(qcWorkflowEventsTable.runId, body.runId),
          // A prior sign-off is not a new QC record, but correction and
          // redaction events do reopen the reviewed snapshot.
          sql`${qcWorkflowEventsTable.eventType} <> 'run-signoff'`,
          sql`${qcWorkflowEventsTable.eventType} <> 'target-setting'`,
        ));
      const [previousSignoff] = await tx.select().from(qcWorkflowEventsTable).where(and(
        eq(qcWorkflowEventsTable.scope, currentScope()),
        eq(qcWorkflowEventsTable.runId, body.runId),
        eq(qcWorkflowEventsTable.eventType, "run-signoff"),
      )).orderBy(desc(qcWorkflowEventsTable.id)).limit(1);
      if (
        previousSignoff &&
        Number(lastRecord?.id ?? 0) <= Number(previousSignoff.payload.reviewedThroughId ?? 0)
      ) {
        throw new Error("RUN_ALREADY_SIGNED_OFF");
      }
      return appendRunEvent(tx, currentScope(), actorId, {
        operationId: body.operationId,
        recordId: randomUUID(),
        eventType: "run-signoff",
        runId: body.runId,
        payload: {
          reviewedThroughId: Number(lastRecord?.id ?? 0),
          note: body.note,
        },
      });
    });
    res.status(201).json({ event: publicEvent(event) });
  } catch (error) {
    if (error instanceof Error && error.message === "RUN_ALREADY_SIGNED_OFF") {
      safeError(res, 409, "This run already has an active QC sign-off");
      return;
    }
    if (await findOperation(body.operationId)) {
      safeError(res, 409, "This operation ID was already used");
      return;
    }
    reportRouteError(req, res, "failed to sign off QC run", error);
  }
});

router.get("/qc/history", requireCapability("record-qc"), async (req, res) => {
  const filters = parseHistoryFilters(req);
  if (!filters) {
    safeError(res, 400, "Invalid or out-of-range QC history filters");
    return;
  }
  try {
    const conditions = [eq(qcWorkflowEventsTable.scope, currentScope())];
    if (filters.runId) conditions.push(eq(qcWorkflowEventsTable.runId, filters.runId));
    if (filters.ingredientId) conditions.push(eq(qcWorkflowEventsTable.ingredientId, filters.ingredientId));
    if (filters.station) conditions.push(eq(qcWorkflowEventsTable.station, filters.station));
    if (filters.from) conditions.push(gte(qcWorkflowEventsTable.createdAt, filters.from));
    if (filters.to) conditions.push(lte(qcWorkflowEventsTable.createdAt, filters.to));
    if (filters.cursor) conditions.push(lt(qcWorkflowEventsTable.id, filters.cursor));
    const rows = await db.select().from(qcWorkflowEventsTable)
      .where(and(...conditions))
      .orderBy(desc(qcWorkflowEventsTable.id))
      .limit(filters.limit + 1);
    const hasMore = rows.length > filters.limit;
    const pageRows = rows.slice(0, filters.limit);
    res.json({
      items: await hydrateEvents(pageRows),
      hasMore,
      nextCursor: hasMore ? pageRows[pageRows.length - 1]?.id ?? null : null,
    });
  } catch (error) {
    reportRouteError(req, res, "failed to load QC history", error);
  }
});

router.get("/qc/history.csv", requireCapability("manage-qc"), async (req, res) => {
  const filters = parseHistoryFilters(req, 100);
  if (!filters) {
    safeError(res, 400, "Invalid or out-of-range QC history filters");
    return;
  }
  try {
    res.status(200);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="qc-history.csv"');
    res.write([
      "id",
      "eventType",
      "recordId",
      "runId",
      "profileKey",
      "ingredientId",
      "ingredientName",
      "station",
      "actorId",
      "createdAt",
      "payload",
    ].join(",") + "\r\n");
    let cursor: number | undefined;
    for (;;) {
      const conditions = [eq(qcWorkflowEventsTable.scope, currentScope())];
      if (filters.runId) conditions.push(eq(qcWorkflowEventsTable.runId, filters.runId));
      if (filters.ingredientId) conditions.push(eq(qcWorkflowEventsTable.ingredientId, filters.ingredientId));
      if (filters.station) conditions.push(eq(qcWorkflowEventsTable.station, filters.station));
      if (filters.from) conditions.push(gte(qcWorkflowEventsTable.createdAt, filters.from));
      if (filters.to) conditions.push(lte(qcWorkflowEventsTable.createdAt, filters.to));
      if (cursor) conditions.push(gt(qcWorkflowEventsTable.id, cursor));
      const rows = await db.select().from(qcWorkflowEventsTable)
        .where(and(...conditions))
        .orderBy(qcWorkflowEventsTable.id)
        .limit(MAX_EXPORT_PAGE);
      if (rows.length === 0) break;
      const hydrated = await hydrateEvents(rows);
      for (const event of hydrated) {
        res.write([
          event.id,
          event.eventType,
          event.recordId,
          event.runId,
          event.profileKey,
          event.ingredientId,
          event.ingredientName,
          event.station,
          event.actorId,
          event.createdAt,
          event.payload,
        ].map(csvCell).join(",") + "\r\n");
      }
      cursor = rows[rows.length - 1]!.id;
      if (rows.length < MAX_EXPORT_PAGE) break;
      if (res.writableNeedDrain) await once(res, "drain");
    }
    res.end();
  } catch (error) {
    reportRouteError(req, res, "failed to export QC history", error);
  }
});

router.post("/qc/events/:eventId/corrections", requireCapability("manage-qc"), async (req, res) => {
  const eventId = Number(req.params.eventId);
  const body = requireValid(correctionBodySchema, req.body, res);
  const actorId = currentActor(req);
  if (!body || !actorId) {
    if (!actorId) safeError(res, 401, "Unauthorized");
    return;
  }
  if (!Number.isSafeInteger(eventId) || eventId < 1) {
    safeError(res, 400, "A valid QC event ID is required");
    return;
  }
  try {
    const [target] = await db.select().from(qcWorkflowEventsTable).where(and(
      eq(qcWorkflowEventsTable.scope, currentScope()),
      eq(qcWorkflowEventsTable.id, eventId),
    )).limit(1);
    if (!target || !["lot", "weight", "allergen-review", "cleaning"].includes(target.eventType)) {
      safeError(res, 404, "Correctable QC record not found");
      return;
    }
    const replacement = validateCorrection(target.eventType, body.replacement);
    if (!replacement) {
      safeError(res, 400, "Correction contains invalid or unsupported fields");
      return;
    }
    if (target.eventType === "cleaning") {
      const start = Date.parse(String(replacement.startedAt ?? target.payload.startedAt ?? ""));
      const end = Date.parse(String(replacement.endedAt ?? target.payload.endedAt ?? ""));
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        safeError(res, 400, "Corrected cleaning end time must be after its start time");
        return;
      }
    }
    if (target.eventType === "weight") {
      const corrected = { ...target.payload, ...replacement };
      const actual = numericPositive(corrected.actualValue);
      const targetValue = numericPositive(corrected.targetValue);
      const tolerance = numericTolerance(corrected.toleranceValue);
      if (
        actual !== null &&
        targetValue !== null &&
        tolerance !== null &&
        corrected.actualUnit === corrected.targetUnit &&
        Math.abs(actual - targetValue) > tolerance &&
        !(typeof replacement.note === "string" && replacement.note.trim())
      ) {
        replacement.note = body.reason;
      }
    }
    const event = await db.transaction(async (tx) => {
      if (target.runId) await tx.execute(lockRun(currentScope(), target.runId));
      return appendRunEvent(tx, currentScope(), actorId, {
        operationId: body.operationId,
        recordId: target.recordId,
        eventType: "correction",
        runId: target.runId,
        profileKey: target.profileKey,
        ingredientId: target.ingredientId,
        ingredientName: target.ingredientName,
        station: target.station,
        relatedEventId: String(target.id),
        payload: { reason: body.reason, replacement },
      });
    });
    res.status(201).json({ event: publicEvent(event) });
  } catch (error) {
    if (await findOperation(body.operationId)) {
      safeError(res, 409, "This operation ID was already used");
      return;
    }
    reportRouteError(req, res, "failed to record QC correction", error);
  }
});

router.post("/qc/events/:eventId/redactions", requireCapability("manage-qc"), async (req, res) => {
  const eventId = Number(req.params.eventId);
  const body = requireValid(redactionBodySchema, req.body, res);
  const actorId = currentActor(req);
  if (!body || !actorId) {
    if (!actorId) safeError(res, 401, "Unauthorized");
    return;
  }
  if (!Number.isSafeInteger(eventId) || eventId < 1) {
    safeError(res, 400, "A valid QC event ID is required");
    return;
  }
  try {
    const [target] = await db.select().from(qcWorkflowEventsTable).where(and(
      eq(qcWorkflowEventsTable.scope, currentScope()),
      eq(qcWorkflowEventsTable.id, eventId),
    )).limit(1);
    if (!target) {
      safeError(res, 404, "QC event not found");
      return;
    }
    const event = await db.transaction(async (tx) => {
      if (target.runId) await tx.execute(lockRun(currentScope(), target.runId));
      return appendRunEvent(tx, currentScope(), actorId, {
        operationId: body.operationId,
        recordId: target.recordId,
        eventType: "redaction",
        runId: target.runId,
        profileKey: target.profileKey,
        ingredientId: target.ingredientId,
        ingredientName: target.ingredientName,
        station: target.station,
        relatedEventId: String(target.id),
        payload: { reason: body.reason, fields: body.fields },
      });
    });
    res.status(201).json({ event: publicEvent(event) });
  } catch (error) {
    if (await findOperation(body.operationId)) {
      safeError(res, 409, "This operation ID was already used");
      return;
    }
    reportRouteError(req, res, "failed to record QC redaction", error);
  }
});

export default router;
