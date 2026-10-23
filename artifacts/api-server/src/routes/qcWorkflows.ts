import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { isDeepStrictEqual } from "node:util";
import { and, asc, desc, eq, gt, gte, inArray, lt, lte, max, notInArray, sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import * as z from "zod";
import {
  brandProfilesTable,
  completedRunHistoryTable,
  dailySyncTable,
  db,
  ingredientsTable,
  qcWorkflowEventsTable,
  type QcWorkflowEventRow,
} from "@workspace/db";
import { facilityDate } from "../lib/facilityTime";
import {
  evaluateQcComponents,
  resolveQcExpectedComponents,
  type QcComponentObservation,
} from "../lib/qcComponentChecks";
import { evaluateQcBrixCheck } from "../lib/qcBrixChecks";
import { dateCodeObservedSchema, dateCodeReadabilitySchema, evaluateDateCodeCheck } from "../lib/qcDateCodeChecks";
import { registerDateCodeWorkflows } from "./qcDateCodeWorkflows";
import {
  evaluateQcLabelCheck,
  normalizeQcLabelObserved,
  QC_LABEL_FIELDS,
  type QcLabelField,
  type QcLabelExpectedFields,
} from "../lib/qcLabelChecks";
import { currentScope } from "../lib/requestScope";
import { requireCapability } from "../middlewares/requireCapability";
import {
  projectActivitySnapshot,
  projectAllergenReview,
  type ActivityRunSource,
  type ActivitySnapshotRun,
} from "./qcAllergenActivity";
import {
  buildQcIntelligenceReport,
  qcIntelligenceCsv,
  QcIntelligenceCsvLimitError,
  type QcReportEvent,
  type QcReportCoverage,
  type QcReportFilters,
  type QcReportView,
} from "./qcIntelligenceReport";

const router: IRouter = Router();
const MAX_NOTE = 1_000;
const MAX_RUN_ID = 200;
const MAX_PROFILE_KEY = 400;
const MAX_HISTORY_PAGE = 100;
const MAX_RUN_PAGE = 200;
const MAX_RUN_WEIGHT_CHECK_EVENTS = 5_000;
const MAX_ALLERGEN_ACTIVITY_RUNS = 600;
const MAX_ALLERGEN_ACTIVITY_EVENTS = 5_000;
const MAX_EXPORT_PAGE = 500;
const MAX_INTELLIGENCE_EVENTS = 5_000;
const MAX_INTELLIGENCE_OVERLAYS = 10_000;
const MAX_INTELLIGENCE_RUN_SOURCES = 50;
const MAX_INTELLIGENCE_SNAPSHOT_BYTES = 1_048_576;
type QcAuditDetail = {
  action: "correction" | "redaction";
  actorId: string | null;
  reason: string | null;
  recordedAt: string;
};
const UNIT = z.enum(["oz", "g", "lb", "kg"]);
const STATION = z.enum(["dough", "sauce", "frontline", "warehouse", "packaging", "other"]);
const CHECK_TYPE = z.enum(["pre-run", "30-minute"]);
const BRIX_CHECK_TYPE = z.enum(["pre-run", "interval"]);
const LABEL_CONTEXT = z.enum(["shipper-case", "carton-label"]);
const LABEL_FIELD = z.enum(QC_LABEL_FIELDS);
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
const activityDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Invalid calendar date");
const allergenActivityQuerySchema = z.object({
  date: activityDateSchema.optional(),
}).strict();
const qcPlanningQuerySchema = z.object({
  today: activityDateSchema,
  days: z.coerce.number().int().min(1).max(90).default(30),
}).strict();
const ingredientIdSchema = z.string().trim().min(1).max(200);
const qcIntelligenceQuerySchema = z.object({
  view: z.enum(["trends", "results", "traceability"]),
  from: activityDateSchema.optional(),
  to: activityDateSchema.optional(),
  ingredientId: ingredientIdSchema.optional(),
  station: STATION.optional(),
  runId: runIdSchema.optional(),
  checkType: z.enum(["pre-run", "30-minute", "interval"]).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_INTELLIGENCE_EVENTS).default(1_000),
}).strict();
const profileKeySchema = z.string().trim().min(1).max(MAX_PROFILE_KEY);
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

const brixTargetBodySchema = z.object({
  operationId: operationIdSchema,
  profileKey: profileKeySchema,
  ingredientId: ingredientIdSchema,
  targetBrix: z.number().finite().min(0).max(100).nullable(),
  toleranceBrix: z.number().finite().min(0).max(100).nullable(),
  reason: z.string().trim().min(1).max(500),
  sourceDocument: z.string().trim().max(300).optional(),
  sourceSection: z.string().trim().max(200).optional(),
}).strict().superRefine((body, ctx) => {
  if ((body.targetBrix === null) !== (body.toleranceBrix === null)) {
    ctx.addIssue({
      code: "custom",
      path: ["toleranceBrix"],
      message: "A reviewed Brix target and tolerance must be set or cleared together",
    });
  }
});

const brixCheckBodySchema = z.object({
  operationId: operationIdSchema,
  runId: runIdSchema,
  profileKey: profileKeySchema,
  ingredientId: ingredientIdSchema,
  station: STATION,
  checkType: BRIX_CHECK_TYPE,
  actualBrix: z.number().finite().min(0).max(100),
  instrument: z.string().trim().max(120).optional().default(""),
  note: noteSchema,
}).strict();

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

const componentObservationSchema = z.object({
  componentId: z.string().trim().min(1).max(80),
  observation: z.enum(["present-correct", "present-mismatch", "missing", "not-checked"]),
}).strict();

const componentCheckBodySchema = z.object({
  operationId: operationIdSchema,
  runId: runIdSchema,
  observations: z.array(componentObservationSchema).max(200),
  note: noteSchema,
}).strict().superRefine((body, ctx) => {
  if (new Set(body.observations.map((item) => item.componentId)).size !== body.observations.length) {
    ctx.addIssue({
      code: "custom",
      path: ["observations"],
      message: "Each component may be observed only once",
    });
  }
});

const labelObservedSchema = z.object({
  productName: z.string().max(200),
  lotText: z.string().max(200),
  dateText: z.string().max(100),
}).strict();

const labelCheckBodySchema = z.object({
  operationId: operationIdSchema,
  runId: runIdSchema,
  context: LABEL_CONTEXT,
  referenceId: z.string().uuid().optional(),
  observed: labelObservedSchema,
  note: noteSchema,
}).strict().superRefine((body, ctx) => {
  if (!QC_LABEL_FIELDS.some((field) => body.observed[field].trim())) {
    ctx.addIssue({
      code: "custom",
      path: ["observed"],
      message: "Enter at least one observed label field",
    });
  }
});

const labelReferenceBodySchema = z.object({
  operationId: operationIdSchema,
  referenceId: z.string().uuid().optional(),
  context: LABEL_CONTEXT,
  productKey: z.string().trim().min(1).max(120),
  expected: z.object({
    productName: z.string().trim().max(200).optional(),
    lotText: z.string().trim().max(200).optional(),
    dateText: z.string().trim().max(100).optional(),
  }).strict(),
  requiredFields: z.array(LABEL_FIELD).min(1).max(3)
    .refine((fields) => new Set(fields).size === fields.length, "Required fields must be unique"),
  sourceIdentity: z.string().trim().min(1).max(200),
  sourceDescription: z.string().trim().min(1).max(500),
}).strict();

const labelReferenceReviewBodySchema = z.object({
  operationId: operationIdSchema,
  decision: z.enum(["approved", "withdrawn"]),
  reason: z.string().trim().min(1).max(500),
}).strict();

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
  fields: z.array(z.enum([
    "actorId",
    "ingredientName",
    "payload.note",
    "payload.reason",
    "payload.summary",
    "payload.before",
    "payload.after",
    "payload.changedFields",
    "payload.instrument",
    "payload.lotNumber",
    "payload.expectedComponents",
    "payload.observed.productName",
    "payload.observed.lotText",
    "payload.observed.dateText",
    "payload.fieldResults.productName.observed",
    "payload.fieldResults.productName.expected",
    "payload.fieldResults.lotText.observed",
    "payload.fieldResults.lotText.expected",
    "payload.fieldResults.dateText.observed",
    "payload.fieldResults.dateText.expected",
    "payload.referenceSnapshot.expected.productName",
    "payload.referenceSnapshot.expected.lotText",
    "payload.referenceSnapshot.expected.dateText",
    "payload.referenceSnapshot.sourceIdentity",
    "payload.referenceSnapshot.sourceDescription",
    "payload.batchContext",
    "payload.observed.productionCode",
    "payload.observed.bestByCode",
    "payload.observed.otherCode",
    "payload.fieldResults.productionCode.observed",
    "payload.fieldResults.productionCode.expected",
    "payload.fieldResults.bestByCode.observed",
    "payload.fieldResults.bestByCode.expected",
    "payload.fieldResults.otherCode.observed",
    "payload.fieldResults.otherCode.expected",
    "payload.referenceSnapshot.expected.productionCode",
    "payload.referenceSnapshot.expected.bestByCode",
    "payload.referenceSnapshot.expected.otherCode",
    "payload.referenceSnapshot.batchContext",
    "payload.referenceSnapshot.sourceVersion",
    "payload.sourceDocument",
    "payload.sourceSection",
  ]))
    .min(1)
    .max(24)
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
  targetVersion?: string;
  targetRecordedAt?: string;
  source: "spec-import" | "qc-override" | "not-configured";
  state: "configured" | "not-evaluated";
  reason?: string;
  overrideEventId?: number;
};

type QcBrixTarget = {
  ingredientId: string;
  ingredientName: string;
  targetBrix: number | null;
  toleranceBrix: number | null;
  source: "qc-override" | "not-configured";
  state: "configured" | "not-evaluated";
  reason?: string;
  overrideEventId?: number;
  targetRecordedAt?: string;
  sourceDocument?: string;
  sourceSection?: string;
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

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, stableValue(child)]));
  }
  return value;
}

function snapshotHash(snapshot: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(snapshot))).digest("hex");
}

function recordObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

type QcExecutor = Pick<typeof db, "select">;

const MAX_LABEL_REFERENCES = 200;
const MAX_LABEL_REFERENCE_EVENTS = 5_000;

const storedLabelReferenceSchema = z.object({
  referenceId: z.string().uuid(),
  version: z.number().int().positive(),
  context: LABEL_CONTEXT,
  productKey: z.string().min(1).max(120),
  expected: z.object({
    productName: z.string().max(200).optional(),
    lotText: z.string().max(200).optional(),
    dateText: z.string().max(100).optional(),
  }).strict(),
  requiredFields: z.array(LABEL_FIELD).min(1).max(3),
  sourceIdentity: z.string().min(1).max(200),
  sourceDescription: z.string().min(1).max(500),
}).strict();

type StoredLabelReference = z.infer<typeof storedLabelReferenceSchema>;

type LabelReferenceState = {
  configuration: QcWorkflowEventRow;
  value: StoredLabelReference;
  review: QcWorkflowEventRow | null;
  decision: "approved" | "withdrawn" | null;
};

async function latestLabelReference(
  executor: QcExecutor,
  scope: string,
  referenceId: string,
): Promise<QcWorkflowEventRow | null> {
  const [row] = await executor.select().from(qcWorkflowEventsTable).where(and(
    eq(qcWorkflowEventsTable.scope, scope),
    eq(qcWorkflowEventsTable.eventType, "label-reference"),
    sql`${qcWorkflowEventsTable.payload}->>'referenceId' = ${referenceId}`,
  )).orderBy(desc(qcWorkflowEventsTable.id)).limit(1);
  return row ?? null;
}

async function labelReferenceState(
  executor: QcExecutor,
  scope: string,
  configuration: QcWorkflowEventRow,
): Promise<LabelReferenceState | null> {
  const parsed = storedLabelReferenceSchema.safeParse(configuration.payload);
  if (!parsed.success) return null;
  const [review] = await executor.select().from(qcWorkflowEventsTable).where(and(
    eq(qcWorkflowEventsTable.scope, scope),
    eq(qcWorkflowEventsTable.eventType, "label-reference-review"),
    eq(qcWorkflowEventsTable.relatedEventId, String(configuration.id)),
  )).orderBy(desc(qcWorkflowEventsTable.id)).limit(1);
  const decision = review?.payload.decision === "approved" || review?.payload.decision === "withdrawn"
    ? review.payload.decision
    : null;
  return { configuration, value: parsed.data, review: review ?? null, decision };
}

async function currentLabelReferences(
  executor: QcExecutor,
  scope: string,
): Promise<{ items: LabelReferenceState[]; overflow: boolean }> {
  const rows = await executor.select().from(qcWorkflowEventsTable).where(and(
    eq(qcWorkflowEventsTable.scope, scope),
    eq(qcWorkflowEventsTable.eventType, "label-reference"),
  )).orderBy(desc(qcWorkflowEventsTable.id)).limit(MAX_LABEL_REFERENCE_EVENTS + 1);
  if (rows.length > MAX_LABEL_REFERENCE_EVENTS) return { items: [], overflow: true };
  const latestById = new Map<string, QcWorkflowEventRow>();
  for (const row of rows) {
    const parsed = storedLabelReferenceSchema.safeParse(row.payload);
    if (parsed.success && !latestById.has(parsed.data.referenceId)) {
      latestById.set(parsed.data.referenceId, row);
    }
  }
  if (latestById.size > MAX_LABEL_REFERENCES) return { items: [], overflow: true };
  const states = await Promise.all(
    [...latestById.values()].map((row) => labelReferenceState(executor, scope, row)),
  );
  return {
    items: states.flatMap((state) => state ? [state] : []),
    overflow: false,
  };
}

function labelReferenceApi(state: LabelReferenceState, includeReviewReason: boolean) {
  const { configuration, value, review, decision } = state;
  return {
    ...value,
    configurationEventId: configuration.id,
    state: decision ?? "draft",
    reviewedBy: review?.actorId ?? null,
    reviewedAt: review?.createdAt.toISOString() ?? null,
    ...(includeReviewReason
      ? { reviewReason: typeof review?.payload.reason === "string" ? review.payload.reason : null }
      : {}),
  };
}

function labelReferenceSnapshot(state: LabelReferenceState) {
  const reviewPayload = state.review?.payload ?? {};
  return {
    referenceId: state.value.referenceId,
    version: state.value.version,
    context: state.value.context,
    productKey: state.value.productKey,
    expected: state.value.expected,
    requiredFields: state.value.requiredFields,
    sourceIdentity: state.value.sourceIdentity,
    sourceDescription: state.value.sourceDescription,
    configurationEventId: state.configuration.id,
    approvalEventId: state.review?.id ?? null,
    approvedBy: state.review?.actorId ?? null,
    approvedAt: state.review?.createdAt.toISOString() ?? null,
    approvalReason: typeof reviewPayload.reason === "string" ? reviewPayload.reason : null,
  };
}

function evaluateStoredLabelCheck(payload: Record<string, unknown>) {
  const observedObject = recordObject(payload.observed);
  const observed = {
    productName: typeof observedObject?.productName === "string" ? observedObject.productName : "",
    lotText: typeof observedObject?.lotText === "string" ? observedObject.lotText : "",
    dateText: typeof observedObject?.dateText === "string" ? observedObject.dateText : "",
  };
  const snapshot = recordObject(payload.referenceSnapshot);
  const expected = recordObject(snapshot?.expected);
  const requiredFields = Array.isArray(snapshot?.requiredFields)
    ? snapshot.requiredFields.filter((field): field is QcLabelField =>
      QC_LABEL_FIELDS.includes(field as QcLabelField))
    : [];
  const hasApprovedSnapshot = typeof snapshot?.approvalEventId === "number"
    && snapshot.approvalEventId > 0
    && requiredFields.length > 0;
  const comparison = evaluateQcLabelCheck({
    observed,
    reference: hasApprovedSnapshot
      ? {
        expected: Object.fromEntries(QC_LABEL_FIELDS.flatMap((field) =>
          typeof expected?.[field] === "string" ? [[field, expected[field] as string]] : [],
        )) as QcLabelExpectedFields,
        requiredFields,
      }
      : null,
    ...(typeof payload.referenceUnavailableReason === "string"
      ? { referenceUnavailableReason: payload.referenceUnavailableReason }
      : {}),
  });
  return { ...payload, observed, fieldResults: comparison.fields, outcome: comparison.outcome };
}

function redactPayloadPath(payload: Record<string, unknown>, fieldPath: string): Record<string, unknown> {
  const parts = fieldPath.replace(/^payload\./, "").split(".");
  if (!parts.length || parts.some((part) => !part)) return payload;
  const result = { ...payload };
  let current: Record<string, unknown> = result;
  for (const part of parts.slice(0, -1)) {
    const nested = recordObject(current[part]);
    if (!nested) return result;
    const copy = { ...nested };
    current[part] = copy;
    current = copy;
  }
  current[parts[parts.length - 1]!] = "[redacted]";
  return result;
}

type CanonicalRunSource = {
  kind: "completed-run-snapshot" | "current-day-canonical-settings";
  date: string;
  revision: string;
  values: unknown;
  substitutions: unknown;
  runSubTab?: unknown;
  profileKey?: string;
};

type CanonicalRunLookup =
  | { state: "found"; source: CanonicalRunSource }
  | { state: "unavailable"; reason: string }
  | { state: "not-found" };

async function resolveCanonicalRunSource(
  executor: QcExecutor,
  scope: string,
  runId: string,
): Promise<CanonicalRunLookup> {
  const completedRows = await executor.select().from(completedRunHistoryTable).where(and(
    eq(completedRunHistoryTable.scope, scope),
    eq(completedRunHistoryTable.runId, runId),
  )).limit(2).for("update");
  if (completedRows.length > 1) {
    return { state: "unavailable", reason: "More than one completed snapshot matches this run." };
  }
  const completed = completedRows[0];
  if (completed) {
    const snapshot = recordObject(completed.snapshot);
    const dayState = recordObject(snapshot?.dayState);
    const runValues = recordObject(snapshot?.runValues);
    const runs = Array.isArray(dayState?.runs) ? dayState.runs : [];
    const matches = runs.filter((item) => recordObject(item)?.id === runId);
    if (
      !snapshot
      || snapshotHash(snapshot) !== completed.snapshotHash
      || dayState?.date !== completed.date
      || matches.length !== 1
      || !runValues
    ) {
      return { state: "unavailable", reason: "The completed run snapshot is incomplete or invalid." };
    }
    const run = recordObject(matches[0]);
    const identity = run
      ? `${String(run.brand ?? "").trim().toLocaleLowerCase("en-US")}__${String(run.flavor ?? "").trim().toLocaleLowerCase("en-US")}`
      : "";
    return {
      state: "found",
      source: {
        kind: "completed-run-snapshot",
        date: completed.date,
        revision: completed.snapshotHash,
        values: runValues[runId],
        substitutions: dayState.substitutions,
        runSubTab: run?.subTab,
        ...(identity && identity !== "__" ? { profileKey: identity } : {}),
      },
    };
  }

  const today = facilityDate();
  const [daily] = await executor.select().from(dailySyncTable).where(and(
    eq(dailySyncTable.scope, scope),
    eq(dailySyncTable.date, today),
  )).limit(1).for("update");
  if (!daily) return { state: "not-found" };
  const data = recordObject(daily.data);
  const dayState = recordObject(data?.dayState);
  const runValues = recordObject(data?.runValues);
  const runs = Array.isArray(dayState?.runs) ? dayState.runs : [];
  const matches = runs.filter((item) => recordObject(item)?.id === runId);
  if (matches.length === 0) return { state: "not-found" };
  if (matches.length !== 1 || !dayState || !runValues) {
    return { state: "unavailable", reason: "The current run snapshot is incomplete or ambiguous." };
  }
  const run = recordObject(matches[0]);
  const identity = run
    ? `${String(run.brand ?? "").trim().toLocaleLowerCase("en-US")}__${String(run.flavor ?? "").trim().toLocaleLowerCase("en-US")}`
    : "";
  return {
    state: "found",
    source: {
      kind: "current-day-canonical-settings",
      date: daily.date,
      revision: String(daily.canonicalRevision),
      values: runValues[runId],
      substitutions: dayState.substitutions,
      runSubTab: run?.subTab,
      ...(identity && identity !== "__" ? { profileKey: identity } : {}),
    },
  };
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

function unavailableRun(runId: string, source: ActivityRunSource = "unavailable"): ActivitySnapshotRun {
  return {
    runId,
    label: "Production run",
    source,
    manualAllergen: { status: "unavailable", value: null },
    ended: source === "completed-snapshot",
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
    if (
      row.payload.measurementKind !== "brix"
      && row.ingredientId
      && !latestOverrides.has(row.ingredientId)
    ) {
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
        targetVersion: `qc-override:${override.id}`,
        targetRecordedAt: override.createdAt.toISOString(),
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
        targetVersion: `profile:${profileRow[0]!.updatedAtMs}`,
        targetRecordedAt: new Date(profileRow[0]!.updatedAtMs).toISOString(),
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

async function resolveBrixTargets(profileKey: string): Promise<QcBrixTarget[]> {
  const scope = currentScope();
  const [ingredientRows, brixTargetRows] = await Promise.all([
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
      sql`${qcWorkflowEventsTable.payload}->>'measurementKind' = 'brix'`,
    )).orderBy(desc(qcWorkflowEventsTable.id)),
  ]);
  const latestByIngredient = new Map<string, QcWorkflowEventRow>();
  for (const row of brixTargetRows) {
    if (row.ingredientId && !latestByIngredient.has(row.ingredientId)) {
      latestByIngredient.set(row.ingredientId, row);
    }
  }
  const projectedTargetRows = await hydrateEvents([...latestByIngredient.values()]);
  const projectedByIngredient = new Map<string, (typeof projectedTargetRows)[number]>();
  for (const row of projectedTargetRows) {
    if (row.ingredientId) projectedByIngredient.set(row.ingredientId, row);
  }
  return ingredientRows
    .filter((ingredient) => ingredient.enabled && !ingredient.mergedInto)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((ingredient): QcBrixTarget => {
      const override = projectedByIngredient.get(ingredient.id);
      const targetBrix = override?.payload.active === true
        ? numericBrix(override.payload.targetBrix)
        : null;
      const toleranceBrix = override?.payload.active === true
        ? numericBrix(override.payload.toleranceBrix)
        : null;
      const configured = targetBrix !== null && toleranceBrix !== null;
      return {
        ingredientId: ingredient.id,
        ingredientName: ingredient.name,
        targetBrix,
        toleranceBrix,
        source: configured ? "qc-override" : "not-configured",
        state: configured ? "configured" : "not-evaluated",
        ...(!configured
          ? {
            reason: override?.payload.active === true
              ? "The reviewed Brix target or tolerance is invalid."
              : override
                ? "No reviewed Brix target is configured."
                : "No manager-reviewed Brix target is configured.",
          }
          : {}),
        ...(override ? { overrideEventId: override.id } : {}),
        ...(override ? { targetRecordedAt: override.createdAt } : {}),
        ...(typeof override?.payload.sourceDocument === "string"
          && !override.redactedFields?.includes("payload.sourceDocument")
          ? { sourceDocument: override.payload.sourceDocument }
          : {}),
        ...(typeof override?.payload.sourceSection === "string"
          && !override.redactedFields?.includes("payload.sourceSection")
          ? { sourceSection: override.payload.sourceSection }
          : {}),
      };
    });
}

async function resolveBrixTarget(
  executor: QcExecutor,
  scope: string,
  profileKey: string,
  ingredientId: string,
): Promise<QcBrixTarget | null> {
  const [ingredient] = await executor.select({
    id: ingredientsTable.id,
    name: ingredientsTable.name,
  }).from(ingredientsTable).where(and(
    eq(ingredientsTable.scope, scope),
    eq(ingredientsTable.id, ingredientId),
    eq(ingredientsTable.enabled, true),
  )).limit(1);
  if (!ingredient) return null;
  const [override] = await executor.select().from(qcWorkflowEventsTable).where(and(
    eq(qcWorkflowEventsTable.scope, scope),
    eq(qcWorkflowEventsTable.eventType, "target-setting"),
    eq(qcWorkflowEventsTable.profileKey, profileKey),
    eq(qcWorkflowEventsTable.ingredientId, ingredientId),
    sql`${qcWorkflowEventsTable.payload}->>'measurementKind' = 'brix'`,
  )).orderBy(desc(qcWorkflowEventsTable.id)).limit(1);
  const targetBrix = override?.payload.active === true
    ? numericBrix(override.payload.targetBrix)
    : null;
  const toleranceBrix = override?.payload.active === true
    ? numericBrix(override.payload.toleranceBrix)
    : null;
  const configured = targetBrix !== null && toleranceBrix !== null;
  return {
    ingredientId: ingredient.id,
    ingredientName: ingredient.name,
    targetBrix,
    toleranceBrix,
    source: configured ? "qc-override" : "not-configured",
    state: configured ? "configured" : "not-evaluated",
    ...(!configured
      ? {
        reason: override?.payload.active === true
          ? "The reviewed Brix target or tolerance is invalid."
          : override
            ? "No reviewed Brix target is configured."
            : "No manager-reviewed Brix target is configured.",
      }
      : {}),
    ...(override ? { overrideEventId: override.id } : {}),
    ...(override ? { targetRecordedAt: override.createdAt.toISOString() } : {}),
    ...(typeof override?.payload.sourceDocument === "string" ? { sourceDocument: override.payload.sourceDocument } : {}),
    ...(typeof override?.payload.sourceSection === "string" ? { sourceSection: override.payload.sourceSection } : {}),
  };
}

function numericBrix(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : null;
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
  const rawText = value === null || value === undefined
    ? ""
    : typeof value === "string"
      ? value
      : JSON.stringify(value);
  const text = /^[\s]*[=+\-@]/.test(rawText) ? `'${rawText}` : rawText;
  return `"${text.replaceAll('"', '""')}"`;
}

function projectAuditActionForReader<
  T extends { eventType: string; actorId: string | null; payload: Record<string, unknown> },
>(event: T, includeAuditDetails: boolean): T {
  if (event.eventType !== "correction" && event.eventType !== "redaction") return event;
  if (!includeAuditDetails) {
    return { ...event, actorId: null, payload: {} } as T;
  }
  return {
    ...event,
    payload: typeof event.payload.reason === "string"
      ? { reason: event.payload.reason }
      : {},
  } as T;
}

async function hydrateEvents(
  rows: QcWorkflowEventRow[],
  includeAuditDetails = false,
  boundedOverlayRows?: QcWorkflowEventRow[],
) {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => String(row.id));
  const rowTypes = new Map(rows.map((row) => [String(row.id), row.eventType]));
  const overlays = boundedOverlayRows ?? await db.select().from(qcWorkflowEventsTable).where(and(
    eq(qcWorkflowEventsTable.scope, currentScope()),
    inArray(qcWorkflowEventsTable.relatedEventId, ids),
  )).orderBy(qcWorkflowEventsTable.id);
  const corrections = new Map<string, Record<string, unknown>>();
  const correctedStations = new Map<string, string>();
  const redactions = new Map<string, Set<string>>();
  const auditDetails = new Map<string, QcAuditDetail[]>();
  for (const overlay of overlays) {
    const target = overlay.relatedEventId;
    if (!target) continue;
    if (
      includeAuditDetails &&
      (overlay.eventType === "correction" || overlay.eventType === "redaction")
    ) {
      const details = auditDetails.get(target) ?? [];
      details.push({
        action: overlay.eventType,
        actorId: overlay.actorId,
        reason: typeof overlay.payload.reason === "string" ? overlay.payload.reason : null,
        recordedAt: overlay.createdAt.toISOString(),
      });
      auditDetails.set(target, details);
    }
    if (overlay.eventType === "correction") {
      const replacement = overlay.payload.replacement;
      if (replacement && typeof replacement === "object" && !Array.isArray(replacement)) {
        const replacementFields = replacement as Record<string, unknown>;
        const prior = corrections.get(target) ?? {};
        if (["label-check", "date-code-check"].includes(rowTypes.get(target) ?? "") && recordObject(replacementFields.observed)) {
          corrections.set(target, {
            ...prior,
            ...replacementFields,
            observed: {
              ...(recordObject(prior.observed) ?? {}),
              ...recordObject(replacementFields.observed),
            },
          });
        } else if (rowTypes.get(target) === "component-check" && Array.isArray(replacementFields.observations)) {
          const merged = new Map<string, unknown>();
          if (Array.isArray(prior.observations)) {
            for (const observation of prior.observations) {
              if (observation && typeof observation === "object"
                && typeof (observation as Record<string, unknown>).componentId === "string") {
                merged.set(
                  (observation as Record<string, unknown>).componentId as string,
                  observation,
                );
              }
            }
          }
          for (const observation of replacementFields.observations) {
            if (observation && typeof observation === "object"
              && typeof (observation as Record<string, unknown>).componentId === "string") {
              merged.set(
                (observation as Record<string, unknown>).componentId as string,
                observation,
              );
            }
          }
          corrections.set(target, {
            ...prior,
            ...replacementFields,
            observations: [...merged.values()],
          });
        } else {
          corrections.set(target, { ...prior, ...replacementFields });
        }
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
      auditDetails?: QcAuditDetail[];
    };
    const replacement = corrections.get(String(row.id));
    if (replacement) {
      output.payload = ["label-check", "date-code-check"].includes(row.eventType) && recordObject(replacement.observed)
        ? {
          ...output.payload,
          ...replacement,
          observed: {
            ...(recordObject(output.payload.observed) ?? {}),
            ...recordObject(replacement.observed),
          },
        }
        : { ...output.payload, ...replacement };
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
        ...(row.eventType === "brix-check"
          ? {
            outcome: evaluateQcBrixCheck({
              actualBrix: Number(output.payload.actualBrix),
              targetBrix: numericBrix(output.payload.targetBrix),
              toleranceBrix: numericBrix(output.payload.toleranceBrix),
            }),
          }
          : {}),
      };
      if (row.eventType === "component-check" && Array.isArray(replacement.observations)) {
        const expectedComponents = Array.isArray(output.payload.expectedComponents)
          ? output.payload.expectedComponents.flatMap((candidate) => {
            const item = recordObject(candidate);
            if (
              !item
              || typeof item.componentId !== "string"
              || typeof item.group !== "string"
              || typeof item.name !== "string"
            ) return [];
            return [{
              componentId: item.componentId,
              group: item.group,
              name: item.name,
              ...(typeof item.ingredientId === "string" ? { ingredientId: item.ingredientId } : {}),
            }];
          })
          : [];
        const observations = new Map<string, QcComponentObservation>();
        if (Array.isArray(output.payload.results)) {
          for (const candidate of output.payload.results) {
            const item = recordObject(candidate);
            if (
              item
              && typeof item.componentId === "string"
              && ["present-correct", "present-mismatch", "missing", "not-checked"].includes(String(item.observation))
            ) observations.set(item.componentId, item.observation as QcComponentObservation);
          }
        }
        for (const candidate of replacement.observations) {
          const item = recordObject(candidate);
          if (item && typeof item.componentId === "string"
            && ["present-correct", "present-mismatch", "missing", "not-checked"].includes(String(item.observation))) {
            observations.set(item.componentId, item.observation as QcComponentObservation);
          }
        }
        const evaluation = evaluateQcComponents({
          status: output.payload.expectedStatus === "complete" ? "complete" : "incomplete",
          ...(typeof output.payload.expectedReason === "string"
            ? { reason: output.payload.expectedReason }
            : {}),
          issues: [],
          components: expectedComponents,
        }, observations);
        output.payload = {
          ...output.payload,
          results: evaluation.items.map(({ componentId, observation, outcome }) => ({
            componentId,
            observation,
            outcome,
          })),
          outcome: evaluation.outcome,
        };
      }
      if (row.eventType === "label-check") {
        output.payload = evaluateStoredLabelCheck(output.payload);
      }
      if (row.eventType === "date-code-check") {
        // Readability corrections are a complete map, while observed text may
        // be patched field by field. Always compare with the original snapshot.
        output.payload = evaluateDateCodeCheck(output.payload);
      }
      output.corrected = true;
    }
    const station = correctedStations.get(String(row.id));
    if (station) output.station = station;
    const fields = redactions.get(String(row.id));
    if (fields?.has("actorId")) output.actorId = null;
    if (fields?.has("ingredientName")) output.ingredientName = null;
    for (const field of fields ?? []) {
      if (field.startsWith("payload.")) {
        output.payload = redactPayloadPath(output.payload, field);
      }
    }
    if (fields?.size) output.redactedFields = [...fields];
    const details = auditDetails.get(String(row.id));
    if (details?.length) output.auditDetails = details;
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
      : eventType === "brix-check"
        ? z.object({
          actualBrix: z.number().finite().min(0).max(100).optional(),
          checkType: BRIX_CHECK_TYPE.optional(),
          instrument: z.string().trim().max(120).optional(),
          note: correctionNote,
          station: STATION.optional(),
        }).strict()
        : eventType === "component-check"
          ? z.object({
            observations: z.array(componentObservationSchema).max(200).optional(),
            note: correctionNote,
          }).strict().superRefine((replacement, ctx) => {
            if (replacement.observations
              && new Set(replacement.observations.map((item) => item.componentId)).size
                !== replacement.observations.length) {
              ctx.addIssue({
                code: "custom",
                path: ["observations"],
                message: "Each component may be corrected only once",
              });
            }
          })
        : eventType === "date-code-check"
          ? z.object({
            observed: dateCodeObservedSchema.partial().optional(),
            readability: dateCodeReadabilitySchema.optional(),
            note: correctionNote,
          }).strict().refine((replacement) =>
            Boolean(replacement.readability || replacement.note !== undefined || Object.keys(replacement.observed ?? {}).length),
          "Change observed text, readability or note")
        : eventType === "label-check"
          ? z.object({
            observed: labelObservedSchema.partial().optional(),
            note: correctionNote,
          }).strict().superRefine((replacement, ctx) => {
            if (
              (!replacement.observed || Object.keys(replacement.observed).length === 0)
              && replacement.note === undefined
            ) {
              ctx.addIssue({ code: "custom", message: "A correction must change observed text or the note" });
            }
          })
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

async function findOperation(operationId: string, executor: QcExecutor = db) {
  const [existing] = await executor.select().from(qcWorkflowEventsTable).where(and(
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
    const [targets, brixTargets] = await Promise.all([
      resolveTargets(profileKey),
      resolveBrixTargets(profileKey),
    ]);
    res.json({ profileKey, targets, brixTargets });
  } catch (error) {
    reportRouteError(req, res, "failed to resolve QC weight targets", error);
  }
});

router.post("/qc/brix-targets", requireCapability("manage-qc"), async (req, res) => {
  const body = requireValid(brixTargetBodySchema, req.body, res);
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
    const result = await db.transaction(async (tx) => {
      const scope = currentScope();
      await tx.execute(lockTarget(scope, body.profileKey, ingredient.id));
      const existing = await findOperation(body.operationId, tx);
      if (existing) {
        const sameRequest = existing.eventType === "target-setting"
          && existing.profileKey === body.profileKey
          && existing.ingredientId === ingredient.id
          && existing.payload.measurementKind === "brix"
          && existing.payload.active === (body.targetBrix !== null)
          && existing.payload.targetBrix === body.targetBrix
          && existing.payload.toleranceBrix === body.toleranceBrix
          && existing.payload.reason === body.reason
          && (existing.payload.sourceDocument ?? "") === (body.sourceDocument ?? "")
          && (existing.payload.sourceSection ?? "") === (body.sourceSection ?? "");
        return sameRequest ? { event: existing, replayed: true } : { conflict: true as const };
      }
      const event = await appendRunEvent(tx, scope, actorId, {
        operationId: body.operationId,
        recordId: randomUUID(),
        eventType: "target-setting",
        profileKey: body.profileKey,
        ingredientId: ingredient.id,
        ingredientName: ingredient.name,
        payload: {
          measurementKind: "brix",
          active: body.targetBrix !== null,
          targetBrix: body.targetBrix,
          toleranceBrix: body.toleranceBrix,
          unit: "brix",
          source: "qc-override",
          reason: body.reason,
          ...(body.sourceDocument ? { sourceDocument: body.sourceDocument } : {}),
          ...(body.sourceSection ? { sourceSection: body.sourceSection } : {}),
        },
      });
      return { event, replayed: false };
    });
    if ("conflict" in result) {
      safeError(res, 409, "This operation ID was already used for another request");
      return;
    }
    res.status(result.replayed ? 200 : 201).json({ event: publicEvent(result.event) });
  } catch (error) {
    reportRouteError(req, res, "failed to save QC Brix target override", error);
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
          targetVersion: targetIsConfigured ? target!.targetVersion ?? null : null,
          targetRecordedAt: targetIsConfigured ? target!.targetRecordedAt ?? null : null,
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

router.post("/qc/brix-checks", requireCapability("record-qc"), async (req, res) => {
  const body = requireValid(brixCheckBodySchema, req.body, res);
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
    const result = await db.transaction(async (tx) => {
      const scope = currentScope();
      await tx.execute(lockRun(scope, body.runId));
      await tx.execute(lockTarget(scope, body.profileKey, ingredient.id));
      const existing = await findOperation(body.operationId, tx);
      if (existing) {
        const sameRequest = existing.eventType === "brix-check"
          && existing.runId === body.runId
          && existing.profileKey === body.profileKey
          && existing.ingredientId === ingredient.id
          && existing.station === body.station
          && existing.payload.checkType === body.checkType
          && existing.payload.actualBrix === body.actualBrix
          && existing.payload.instrument === body.instrument
          && existing.payload.note === body.note;
        return sameRequest ? { event: existing, replayed: true } : { conflict: true as const };
      }
      const sourceLookup = await resolveCanonicalRunSource(tx, scope, body.runId);
      if (sourceLookup.state !== "found") return { source: sourceLookup } as const;
      if (sourceLookup.source.profileKey !== body.profileKey) {
        return { profileMismatch: true as const };
      }
      const target = await resolveBrixTarget(tx, scope, body.profileKey, ingredient.id);
      const configured = target?.state === "configured"
        && target.targetBrix !== null
        && target.toleranceBrix !== null;
      const targetBrix = configured ? target!.targetBrix : null;
      const toleranceBrix = configured ? target!.toleranceBrix : null;
      const outcome = evaluateQcBrixCheck({
        actualBrix: body.actualBrix,
        targetBrix,
        toleranceBrix,
      });
      const event = await appendRunEvent(tx, scope, actorId, {
        operationId: body.operationId,
        recordId: randomUUID(),
        eventType: "brix-check",
        runId: body.runId,
        profileKey: body.profileKey,
        ingredientId: ingredient.id,
        ingredientName: ingredient.name,
        station: body.station,
        payload: {
          measurementKind: "brix",
          unit: "brix",
          checkType: body.checkType,
          actualBrix: body.actualBrix,
          targetBrix,
          toleranceBrix,
          targetSource: configured ? "qc-override" : "not-configured",
          targetVersion: configured ? target!.overrideEventId ?? null : null,
          targetRecordedAt: configured ? target!.targetRecordedAt ?? null : null,
          runSourceKind: sourceLookup.source.kind,
          runSourceDate: sourceLookup.source.date,
          runSourceRevision: sourceLookup.source.revision,
          outcome,
          instrument: body.instrument,
          note: body.note,
        },
      });
      return { event, replayed: false };
    });
    if ("conflict" in result) {
      safeError(res, 409, "This operation ID was already used for another request");
      return;
    }
    if ("profileMismatch" in result) {
      safeError(res, 409, "The selected profile does not match this run");
      return;
    }
    if (result.source !== undefined) {
      if (result.source.state === "not-found") {
        safeError(res, 404, "Run is not available in this facility scope");
      } else {
        safeError(res, 409, "Canonical run settings are unavailable");
      }
      return;
    }
    res.status(result.replayed ? 200 : 201).json({ event: publicEvent(result.event) });
  } catch (error) {
    reportRouteError(req, res, "failed to record QC Brix check", error);
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
    const sourceLookup = await resolveCanonicalRunSource(db, scope, parsedRunId.data);
    const componentResolution = sourceLookup.state === "found"
      ? resolveQcExpectedComponents(
        sourceLookup.source.values,
        sourceLookup.source.substitutions,
        sourceLookup.source.runSubTab,
      )
      : {
        status: "incomplete" as const,
        reason: sourceLookup.state === "unavailable"
          ? sourceLookup.reason
          : "Expected components are unavailable for this run.",
        issues: [{
          setting: "Canonical run settings",
          message: sourceLookup.state === "unavailable"
            ? sourceLookup.reason
            : "Confirm that this run has saved canonical component settings.",
        }],
        components: [],
      };
    const rows = await db.select().from(qcWorkflowEventsTable).where(and(
      eq(qcWorkflowEventsTable.scope, scope),
      eq(qcWorkflowEventsTable.runId, parsedRunId.data),
    )).orderBy(desc(qcWorkflowEventsTable.id)).limit(limit + 1);
    const weightRows = await db.select().from(qcWorkflowEventsTable).where(and(
      eq(qcWorkflowEventsTable.scope, scope),
      eq(qcWorkflowEventsTable.runId, parsedRunId.data),
      eq(qcWorkflowEventsTable.eventType, "weight"),
    )).orderBy(desc(qcWorkflowEventsTable.id)).limit(MAX_RUN_WEIGHT_CHECK_EVENTS + 1);
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
    const includeAuditRows =
      scope === "live" && req.capabilities?.includes("manage-qc") === true;
    const items = (await hydrateEvents(pageRows)).map((event) =>
      projectAuditActionForReader(event, includeAuditRows),
    );
    const weightCheckEventsComplete = weightRows.length <= MAX_RUN_WEIGHT_CHECK_EVENTS;
    const hydratedWeightRows = await hydrateEvents(weightRows.slice(0, MAX_RUN_WEIGHT_CHECK_EVENTS));
    const weightCheckEvents = hydratedWeightRows.flatMap((event) => {
      const checkType = event.payload.checkType;
      return event.ingredientId && (checkType === "pre-run" || checkType === "30-minute")
        ? [{
          ingredientId: event.ingredientId,
          checkType,
          createdAt: event.createdAt,
        }]
        : [];
    });
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
      weightCheckEvents,
      weightCheckEventsComplete,
      componentChecklist: {
        status: componentResolution.status,
        ...(componentResolution.reason ? { reason: componentResolution.reason } : {}),
        issues: componentResolution.issues,
        expectedComponents: componentResolution.components,
        source: sourceLookup.state === "found"
          ? {
            kind: sourceLookup.source.kind,
            date: sourceLookup.source.date,
            revision: sourceLookup.source.revision,
          }
          : null,
      },
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

router.get("/qc/allergen-activity", requireCapability("record-qc"), async (req, res) => {
  const parsed = allergenActivityQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    safeError(res, 400, "A valid production date is required");
    return;
  }
  const date = parsed.data.date ?? facilityDate();
  const today = facilityDate();
  const scope = currentScope();
  const includeAuditDetails = scope === "live" && req.capabilities?.includes("manage-qc") === true;
  try {
    const [completionRows, activeRows] = await Promise.all([
      db.select().from(completedRunHistoryTable).where(and(
        eq(completedRunHistoryTable.scope, scope),
        eq(completedRunHistoryTable.date, date),
      )).orderBy(completedRunHistoryTable.completedAt).limit(MAX_ALLERGEN_ACTIVITY_RUNS + 1),
      date === today
        ? db.select().from(dailySyncTable).where(and(
          eq(dailySyncTable.scope, scope),
          eq(dailySyncTable.date, date),
        )).limit(2)
        : Promise.resolve([]),
    ]);

    const completionRunIds = new Set(completionRows.map((row) => row.runId));
    const endedRuns: ActivitySnapshotRun[] = [];
    let endedStatus: "available" | "unavailable" = "available";
    let endedReason: string | null = null;
    if (completionRows.length > MAX_ALLERGEN_ACTIVITY_RUNS) {
      endedStatus = "unavailable";
      endedReason = "run-limit-exceeded";
    } else if (completionRows.length === 0) {
      endedStatus = "unavailable";
      endedReason = "no-completed-run-snapshots";
    } else if (completionRunIds.size !== completionRows.length) {
      endedStatus = "unavailable";
      endedReason = "duplicate-completed-run";
    } else {
      const projected = completionRows.map((row) => {
        const result = projectActivitySnapshot(row.snapshot, date, "completed-snapshot");
        if (result.status !== "available") return null;
        const match = result.runs.find((run) => run.runId === row.runId);
        return match ? { ...match, ended: true } : null;
      });
      if (projected.some((run) => run === null)) {
        endedStatus = "unavailable";
        endedReason = "invalid-completed-run-snapshot";
      } else {
        endedRuns.push(...projected.filter((run): run is ActivitySnapshotRun => run !== null));
      }
    }
    if (endedStatus === "unavailable" && completionRows.length <= MAX_ALLERGEN_ACTIVITY_RUNS) {
      endedRuns.push(...completionRows.map((row) => unavailableRun(row.runId, "unavailable")));
    }

    let activeStatus: "available" | "unavailable" | "not-applicable" =
      date === today ? "unavailable" : "not-applicable";
    let activeReason: string | null = date === today ? "missing-current-day-snapshot" : null;
    const activeRuns: ActivitySnapshotRun[] = [];
    if (date === today) {
      if (activeRows.length > 1) {
        activeReason = "ambiguous-current-day-snapshot";
      } else if (activeRows.length === 1) {
        const projected = projectActivitySnapshot(activeRows[0]!.data, date, "active-day-state");
        if (projected.status !== "available") {
          activeReason = `invalid-current-day-${projected.reason}`;
        } else {
          activeStatus = "available";
          activeReason = null;
          for (const run of projected.runs) {
            if (completionRunIds.has(run.runId)) continue;
            if (run.ended) {
              activeStatus = "unavailable";
              activeReason = "ended-run-snapshot-missing";
              activeRuns.push(unavailableRun(run.runId, "unavailable"));
            } else {
              activeRuns.push(run);
            }
          }
        }
      }
    }

    const projectedRuns = [...endedRuns, ...activeRuns];
    const runIds = [...new Set(projectedRuns.map((run) => run.runId))];
    let eventsStatus: "available" | "unavailable" = "available";
    let eventsReason: string | null = null;
    let activityEvents: Awaited<ReturnType<typeof hydrateEvents>> = [];
    if (runIds.length === 0) {
      eventsStatus = "unavailable";
      eventsReason = "run-identities-unavailable";
    } else {
      const eventRows = await db.select().from(qcWorkflowEventsTable).where(and(
        eq(qcWorkflowEventsTable.scope, scope),
        inArray(qcWorkflowEventsTable.runId, runIds),
        inArray(qcWorkflowEventsTable.eventType, [
          "allergen-review", "cleaning", "cleaning-verification",
        ]),
      )).orderBy(qcWorkflowEventsTable.id).limit(MAX_ALLERGEN_ACTIVITY_EVENTS + 1);
      if (eventRows.length > MAX_ALLERGEN_ACTIVITY_EVENTS) {
        eventsStatus = "unavailable";
        eventsReason = "event-limit-exceeded";
      } else {
        activityEvents = await hydrateEvents(eventRows, includeAuditDetails);
      }
    }

    const runs = projectedRuns.map((run) => {
      const runEvents = activityEvents.filter((event) => event.runId === run.runId);
      const reviews = eventsStatus === "available"
        ? runEvents.filter((event) => event.eventType === "allergen-review").map((event) => {
          const review = projectAllergenReview(event.payload);
          return {
            eventId: event.id,
            recordedAt: event.createdAt,
            ...review,
            corrected: event.corrected === true,
            redactedFields: event.redactedFields ?? [],
            ...(event.auditDetails ? { auditDetails: event.auditDetails } : {}),
          };
        })
        : [];
      const cleaningEvents = eventsStatus === "available"
        ? runEvents.filter((event) => event.eventType === "cleaning").map((event) => {
          const verification = runEvents.find((candidate) =>
            candidate.eventType === "cleaning-verification"
            && candidate.relatedEventId === String(event.id),
          );
          return {
            eventId: event.id,
            recordedAt: event.createdAt,
            method: typeof event.payload.method === "string" ? event.payload.method : null,
            startedAt: typeof event.payload.startedAt === "string" ? event.payload.startedAt : null,
            endedAt: typeof event.payload.endedAt === "string" ? event.payload.endedAt : null,
            note: typeof event.payload.note === "string" ? event.payload.note : null,
            verification: {
              status: verification ? "recorded" as const : "not-recorded" as const,
              recordedAt: verification?.createdAt ?? null,
              note: typeof verification?.payload.note === "string" ? verification.payload.note : null,
              ...(verification?.auditDetails ? { auditDetails: verification.auditDetails } : {}),
            },
            corrected: event.corrected === true,
            redactedFields: event.redactedFields ?? [],
            ...(event.auditDetails ? { auditDetails: event.auditDetails } : {}),
          };
        })
        : [];
      const latestReview = reviews[reviews.length - 1];
      return {
        runId: run.runId,
        label: run.label,
        source: run.source,
        manualAllergen: run.manualAllergen,
        derivedReviewState: eventsStatus === "unavailable"
          ? "unavailable"
          : latestReview?.state ?? "no-review",
        allergenReviews: reviews,
        cleaningEvents,
      };
    });
    res.json({
      date,
      sources: {
        endedRuns: { status: endedStatus, reason: endedReason, count: endedStatus === "available" ? endedRuns.length : null },
        activeRuns: {
          status: activeStatus,
          reason: activeReason,
          count: activeStatus === "available" ? activeRuns.length : null,
        },
        qcEvents: {
          status: eventsStatus,
          reason: eventsReason,
          count: eventsStatus === "available" ? activityEvents.length : null,
        },
      },
      runs,
    });
  } catch (error) {
    reportRouteError(req, res, "failed to load daily allergen activity", error);
  }
});

const MAX_QC_PLANNING_DAYS = 90;
let qcPlanningReadFailureHookForTest: (() => void) | undefined;

/** Test-only seam for verifying the endpoint reports source failures distinctly. */
export function setQcPlanningReadFailureHookForTest(hook?: () => void): void {
  qcPlanningReadFailureHookForTest = hook;
}

function addCalendarDays(date: string, count: number): string {
  // This is calendar arithmetic on the client-provided production date. UTC is
  // only used to avoid process-timezone/DST effects while adding whole days.
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
}

function nullablePlanningText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function projectQcPlanningDay(row: { date: string; data: unknown }) {
  const data = recordObject(row.data);
  const dayState = recordObject(data?.dayState);
  const runValues = recordObject(data?.runValues);
  if (!dayState || !Array.isArray(dayState.runs)) {
    return { date: row.date, status: "unknown" as const, runs: [] };
  }

  const runs = dayState.runs.map((rawRun) => {
    const run = recordObject(rawRun);
    const runId = nullablePlanningText(run?.id);
    const values = runId ? recordObject(runValues?.[runId]) : null;
    const casesNeeded = values?.casesNeeded;
    return {
      runId,
      brand: nullablePlanningText(run?.brand),
      flavor: nullablePlanningText(run?.flavor),
      casesNeeded:
        typeof casesNeeded === "number" && Number.isFinite(casesNeeded) && casesNeeded >= 0
          ? casesNeeded
          : null,
    };
  });

  return {
    date: row.date,
    status: runs.length > 0 ? "scheduled" as const : "empty" as const,
    runs,
  };
}

router.get("/qc/planning", requireCapability("record-qc"), async (req, res) => {
  const parsed = qcPlanningQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    safeError(res, 400, "A valid client production date and a range of 1 to 90 days are required");
    return;
  }

  const { today, days } = parsed.data;
  const through = addCalendarDays(today, days - 1);
  try {
    qcPlanningReadFailureHookForTest?.();
    const rows = await db.select({
      date: dailySyncTable.date,
      data: dailySyncTable.data,
    }).from(dailySyncTable).where(and(
      eq(dailySyncTable.scope, currentScope()),
      gte(dailySyncTable.date, today),
      lte(dailySyncTable.date, through),
    )).orderBy(asc(dailySyncTable.date)).limit(MAX_QC_PLANNING_DAYS);

    res.setHeader("Cache-Control", "no-store");
    res.json({
      range: { from: today, through, days },
      maxDays: MAX_QC_PLANNING_DAYS,
      days: rows.map(projectQcPlanningDay),
    });
  } catch (error) {
    req.log.warn({ err: error, scope: currentScope(), from: today, through }, "failed to read QC planning schedule");
    safeError(res, 503, "Upcoming production schedule is unavailable. Retry the request.");
  }
});

router.get("/qc/label-references", requireCapability("record-qc"), async (req, res) => {
  try {
    const scope = currentScope();
    const references = await currentLabelReferences(db, scope);
    if (references.overflow) {
      safeError(res, 503, "The label reference list is over its review limit. Ask a QC manager to review the configuration.");
      return;
    }
    const canManage = req.capabilities?.includes("manage-qc") === true;
    res.json({
      items: references.items
        .filter((item) => canManage || item.decision === "approved")
        .map((item) => labelReferenceApi(item, canManage)),
    });
  } catch (error) {
    reportRouteError(req, res, "failed to load label references", error);
  }
});

router.post("/qc/label-references", requireCapability("manage-qc"), async (req, res) => {
  const body = requireValid(labelReferenceBodySchema, req.body, res);
  const actorId = currentActor(req);
  if (!body || !actorId) {
    if (!actorId) safeError(res, 401, "Unauthorized");
    return;
  }
  try {
    const result = await db.transaction(async (tx) => {
      const scope = currentScope();
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"qc-label-references:" + scope}, 0))`);
      const prior = await findOperation(body.operationId, tx);
      const matchesPrior = (event: QcWorkflowEventRow) => {
        const value = storedLabelReferenceSchema.safeParse(event.payload);
        return event.eventType === "label-reference"
          && value.success
          && (!body.referenceId || value.data.referenceId === body.referenceId)
          && value.data.context === body.context
          && value.data.productKey === body.productKey
          && isDeepStrictEqual(value.data.expected, body.expected)
          && JSON.stringify(value.data.requiredFields) === JSON.stringify(body.requiredFields)
          && value.data.sourceIdentity === body.sourceIdentity
          && value.data.sourceDescription === body.sourceDescription;
      };
      if (prior) return matchesPrior(prior)
        ? { kind: "duplicate" as const, event: prior }
        : { kind: "conflict" as const };

      const referenceId = body.referenceId ?? randomUUID();
      const previous = await latestLabelReference(tx, scope, referenceId);
      if (body.referenceId && !previous) return { kind: "not-found" as const };
      const current = await currentLabelReferences(tx, scope);
      if (current.overflow) return { kind: "overflow" as const };
      const conflict = current.items.some((item) =>
        item.value.referenceId !== referenceId
        && item.value.context === body.context
        && item.value.productKey.normalize("NFC").trim().toLocaleLowerCase("en-US") === body.productKey.normalize("NFC").trim().toLocaleLowerCase("en-US"),
      );
      if (conflict) return { kind: "duplicate-key" as const };

      const previousValue = previous
        ? storedLabelReferenceSchema.safeParse(previous.payload)
        : null;
      if (previous && !previousValue?.success) return { kind: "invalid-prior" as const };
      const value: StoredLabelReference = {
        referenceId,
        version: (previousValue?.success ? previousValue.data.version : 0) + 1,
        context: body.context,
        productKey: body.productKey,
        expected: body.expected,
        requiredFields: body.requiredFields,
        sourceIdentity: body.sourceIdentity,
        sourceDescription: body.sourceDescription,
      };
      const event = await appendRunEvent(tx, scope, actorId, {
        operationId: body.operationId,
        recordId: referenceId,
        eventType: "label-reference",
        runId: null,
        profileKey: null,
        ingredientId: null,
        ingredientName: null,
        station: "packaging",
        relatedEventId: previous ? String(previous.id) : null,
        payload: value,
      });
      return { kind: "created" as const, event };
    });
    if (result.kind === "not-found") {
      safeError(res, 404, "Label reference was not found in this facility scope");
      return;
    }
    if (result.kind === "duplicate-key") {
      safeError(res, 409, "A label reference already exists for this product and packaging context");
      return;
    }
    if (result.kind === "invalid-prior") {
      safeError(res, 409, "The current label reference cannot be versioned safely");
      return;
    }
    if (result.kind === "overflow") {
      safeError(res, 503, "The label reference list is over its review limit. Ask a QC manager to review the configuration.");
      return;
    }
    if (result.kind === "conflict") {
      safeError(res, 409, "This operation ID was already used for another request");
      return;
    }
    res.status(result.kind === "duplicate" ? 200 : 201).json({
      event: publicEvent(result.event),
      duplicate: result.kind === "duplicate",
    });
  } catch (error) {
    const existing = await findOperation(body.operationId);
    if (existing) {
      const value = storedLabelReferenceSchema.safeParse(existing.payload);
      const matches = existing.eventType === "label-reference"
        && value.success
        && (!body.referenceId || value.data.referenceId === body.referenceId)
        && value.data.context === body.context
        && value.data.productKey === body.productKey
        && isDeepStrictEqual(value.data.expected, body.expected)
        && JSON.stringify(value.data.requiredFields) === JSON.stringify(body.requiredFields)
        && value.data.sourceIdentity === body.sourceIdentity
        && value.data.sourceDescription === body.sourceDescription;
      if (matches) {
        res.status(200).json({ event: publicEvent(existing), duplicate: true });
      } else {
        safeError(res, 409, "This operation ID was already used for another request");
      }
      return;
    }
    reportRouteError(req, res, "failed to save label reference", error);
  }
});

router.post("/qc/label-references/:eventId/review", requireCapability("manage-qc"), async (req, res) => {
  const eventId = Number(req.params.eventId);
  const body = requireValid(labelReferenceReviewBodySchema, req.body, res);
  const actorId = currentActor(req);
  if (!body || !actorId) {
    if (!actorId) safeError(res, 401, "Unauthorized");
    return;
  }
  if (!Number.isSafeInteger(eventId) || eventId < 1) {
    safeError(res, 400, "A valid label reference version ID is required");
    return;
  }
  try {
    const result = await db.transaction(async (tx) => {
      const scope = currentScope();
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"qc-label-references:" + scope}, 0))`);
      const prior = await findOperation(body.operationId, tx);
      if (prior) {
        const matches = prior.eventType === "label-reference-review"
          && prior.relatedEventId === String(eventId)
          && prior.payload.decision === body.decision
          && prior.payload.reason === body.reason;
        return matches
          ? { kind: "duplicate" as const, event: prior }
          : { kind: "operation-conflict" as const };
      }
      const [configuration] = await tx.select().from(qcWorkflowEventsTable).where(and(
        eq(qcWorkflowEventsTable.scope, scope),
        eq(qcWorkflowEventsTable.id, eventId),
        eq(qcWorkflowEventsTable.eventType, "label-reference"),
      )).limit(1);
      if (!configuration) return { kind: "not-found" as const };
      const parsed = storedLabelReferenceSchema.safeParse(configuration.payload);
      if (!parsed.success) return { kind: "invalid-reference" as const };
      const latest = await latestLabelReference(tx, scope, parsed.data.referenceId);
      if (!latest || latest.id !== configuration.id) return { kind: "stale-version" as const };
      const state = await labelReferenceState(tx, scope, configuration);
      if (!state) return { kind: "invalid-reference" as const };

      if (body.decision === "approved") {
        if (state.decision === "approved") return { kind: "already-approved" as const };
        const missingRequired = parsed.data.requiredFields.some((field) =>
          typeof parsed.data.expected[field] !== "string" || !parsed.data.expected[field]?.trim(),
        );
        if (missingRequired) return { kind: "incomplete-reference" as const };
        const current = await currentLabelReferences(tx, scope);
        if (current.overflow) return { kind: "overflow" as const };
        const ambiguous = current.items.some((item) =>
          item.value.referenceId !== parsed.data.referenceId
          && item.value.context === parsed.data.context
          && item.value.productKey.normalize("NFC").trim().toLocaleLowerCase("en-US") === parsed.data.productKey.normalize("NFC").trim().toLocaleLowerCase("en-US")
          && item.decision === "approved",
        );
        if (ambiguous) return { kind: "duplicate-key" as const };
      } else if (state.decision !== "approved") {
        return { kind: "not-approved" as const };
      }

      const event = await appendRunEvent(tx, scope, actorId, {
        operationId: body.operationId,
        recordId: configuration.recordId,
        eventType: "label-reference-review",
        runId: null,
        profileKey: null,
        ingredientId: null,
        ingredientName: null,
        station: "packaging",
        relatedEventId: String(configuration.id),
        payload: {
          referenceId: parsed.data.referenceId,
          version: parsed.data.version,
          configurationEventId: configuration.id,
          decision: body.decision,
          reason: body.reason,
        },
      });
      return { kind: "created" as const, event };
    });
    const conflicts: Record<string, { status: number; message: string }> = {
      "not-found": { status: 404, message: "Label reference version was not found in this facility scope" },
      "invalid-reference": { status: 409, message: "The label reference version cannot be reviewed safely" },
      "stale-version": { status: 409, message: "A newer label reference version must be reviewed instead" },
      "already-approved": { status: 409, message: "This label reference version is already approved" },
      "incomplete-reference": { status: 400, message: "Every required field needs an expected text value before approval" },
      "duplicate-key": { status: 409, message: "Another approved reference already uses this product and packaging context" },
      "not-approved": { status: 409, message: "Only an approved label reference can be withdrawn" },
      overflow: { status: 503, message: "The label reference list is over its review limit. Ask a QC manager to review the configuration." },
      "operation-conflict": { status: 409, message: "This operation ID was already used for another request" },
    };
    if (result.kind === "created" || result.kind === "duplicate") {
      res.status(result.kind === "duplicate" ? 200 : 201).json({
        event: publicEvent(result.event),
        duplicate: result.kind === "duplicate",
      });
      return;
    }
    const conflict = conflicts[result.kind];
    if (conflict) {
      safeError(res, conflict.status, conflict.message);
      return;
    }
    throw new Error(`Unhandled label reference review result: ${result.kind}`);
  } catch (error) {
    const existing = await findOperation(body.operationId);
    if (existing) {
      const matches = existing.eventType === "label-reference-review"
        && existing.relatedEventId === String(eventId)
        && existing.payload.decision === body.decision
        && existing.payload.reason === body.reason;
      if (matches) {
        res.status(200).json({ event: publicEvent(existing), duplicate: true });
      } else {
        safeError(res, 409, "This operation ID was already used for another request");
      }
      return;
    }
    reportRouteError(req, res, "failed to review label reference", error);
  }
});

router.post("/qc/label-checks", requireCapability("record-qc"), async (req, res) => {
  const body = requireValid(labelCheckBodySchema, req.body, res);
  const actorId = currentActor(req);
  if (!body || !actorId) {
    if (!actorId) safeError(res, 401, "Unauthorized");
    return;
  }
  const observed = normalizeQcLabelObserved(body.observed);
  const matchesPriorOperation = (event: QcWorkflowEventRow) => {
    const payload = event.payload;
    const priorObserved = labelObservedSchema.safeParse(payload.observed);
    return event.eventType === "label-check"
      && event.runId === body.runId
      && payload.context === body.context
      && (payload.referenceId ?? null) === (body.referenceId ?? null)
      && priorObserved.success
      && QC_LABEL_FIELDS.every((field) => priorObserved.data[field] === observed[field])
      && payload.note === body.note;
  };
  try {
    const result = await db.transaction(async (tx) => {
      const scope = currentScope();
      await tx.execute(lockRun(scope, body.runId));
      const prior = await findOperation(body.operationId, tx);
      if (prior) return matchesPriorOperation(prior)
        ? { kind: "duplicate" as const, event: prior }
        : { kind: "operation-conflict" as const };

      const canonical = await resolveCanonicalRunSource(tx, scope, body.runId);
      if (canonical.state === "not-found") return { kind: "run-not-found" as const };
      if (canonical.state === "unavailable") return { kind: "run-unavailable" as const };

      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"qc-label-references:" + scope}, 0))`);
      const runProductKey = canonical.source.profileKey?.normalize("NFC").trim().toLocaleLowerCase("en-US");
      const productIdentityKnown = Boolean(runProductKey && runProductKey.split("__").length === 2
        && !runProductKey.startsWith("__") && !runProductKey.endsWith("__"));
      let approvedReference: LabelReferenceState | null = null;
      let referenceSnapshot: Record<string, unknown> | null = null;
      let referenceUnavailableReason: string | undefined;
      if (!body.referenceId) {
        referenceUnavailableReason = "No approved reference was selected.";
      } else {
        const configuration = await latestLabelReference(tx, scope, body.referenceId);
        const state = configuration
          ? await labelReferenceState(tx, scope, configuration)
          : null;
        if (!state) {
          referenceUnavailableReason = "No approved applicable reference is available.";
        } else if (!productIdentityKnown
          || state.value.productKey.normalize("NFC").trim().toLocaleLowerCase("en-US") !== runProductKey) {
          referenceSnapshot = {
            referenceId: state.value.referenceId,
            version: state.value.version,
            productKey: state.value.productKey,
            context: state.value.context,
            configurationEventId: state.configuration.id,
            state: "inapplicable",
          };
          referenceUnavailableReason = productIdentityKnown
            ? "The selected reference is for a different product than the canonical run."
            : "The canonical run product identity is incomplete or ambiguous; reference applicability cannot be established.";
        } else if (state.value.context !== body.context) {
          referenceSnapshot = {
            referenceId: state.value.referenceId,
            version: state.value.version,
            context: state.value.context,
            configurationEventId: state.configuration.id,
            state: state.decision ?? "draft",
          };
          referenceUnavailableReason = "The selected reference is for a different packaging context.";
        } else if (state.decision !== "approved" || !state.review) {
          referenceSnapshot = {
            referenceId: state.value.referenceId,
            version: state.value.version,
            context: state.value.context,
            configurationEventId: state.configuration.id,
            state: state.decision ?? "draft",
          };
          referenceUnavailableReason = "The selected reference version has not been approved.";
        } else {
          const current = await currentLabelReferences(tx, scope);
          const matches = current.items.filter((item) =>
            item.decision === "approved"
            && item.value.context === state.value.context
            && item.value.productKey.normalize("NFC").trim().toLocaleLowerCase("en-US") === runProductKey,
          );
          if (current.overflow || matches.length !== 1 || matches[0]?.value.referenceId !== state.value.referenceId) {
            referenceUnavailableReason = current.overflow
              ? "Approved reference availability could not be verified."
              : "More than one approved reference matches this product and packaging context.";
            referenceSnapshot = {
              referenceId: state.value.referenceId,
              version: state.value.version,
              context: state.value.context,
              configurationEventId: state.configuration.id,
              state: "ambiguous",
            };
          } else {
            approvedReference = state;
            referenceSnapshot = {
              state: "approved",
              ...labelReferenceSnapshot(state),
            };
          }
        }
      }

      const comparison = evaluateQcLabelCheck({
        observed,
        reference: approvedReference
          ? { expected: approvedReference.value.expected, requiredFields: approvedReference.value.requiredFields }
          : null,
        ...(referenceUnavailableReason ? { referenceUnavailableReason } : {}),
      });
      const event = await appendRunEvent(tx, scope, actorId, {
        operationId: body.operationId,
        recordId: randomUUID(),
        eventType: "label-check",
        runId: body.runId,
        profileKey: canonical.source.profileKey ?? null,
        ingredientId: null,
        ingredientName: null,
        station: "packaging",
        relatedEventId: null,
        payload: {
          context: body.context,
          runProductKey: productIdentityKnown ? runProductKey : null,
          referenceId: body.referenceId ?? null,
          referenceSnapshot,
          ...(referenceUnavailableReason ? { referenceUnavailableReason } : {}),
          observed,
          fieldResults: comparison.fields,
          outcome: comparison.outcome,
          note: body.note,
        },
      });
      return { kind: "created" as const, event };
    });
    if (result.kind === "run-not-found") {
      safeError(res, 404, "Run was not found in this facility scope");
      return;
    }
    if (result.kind === "run-unavailable") {
      safeError(res, 409, "Canonical run records are unavailable; the label check was not saved");
      return;
    }
    if (result.kind === "operation-conflict") {
      safeError(res, 409, "This operation ID was already used for another request");
      return;
    }
    res.status(result.kind === "duplicate" ? 200 : 201).json({
      event: publicEvent(result.event),
      duplicate: result.kind === "duplicate",
    });
  } catch (error) {
    const existing = await findOperation(body.operationId);
    if (existing) {
      if (matchesPriorOperation(existing)) {
        res.status(200).json({ event: publicEvent(existing), duplicate: true });
      } else {
        safeError(res, 409, "This operation ID was already used for another request");
      }
      return;
    }
    reportRouteError(req, res, "failed to record label check", error);
  }
});

router.post("/qc/component-checks", requireCapability("record-qc"), async (req, res) => {
  const body = requireValid(componentCheckBodySchema, req.body, res);
  const actorId = currentActor(req);
  if (!body || !actorId) {
    if (!actorId) safeError(res, 401, "Unauthorized");
    return;
  }
  const normalizedObservations = [...body.observations]
    .sort((a, b) => a.componentId.localeCompare(b.componentId));
  const matchesPriorOperation = (event: QcWorkflowEventRow) => {
    const payload = event.payload;
    return event.eventType === "component-check"
      && event.runId === body.runId
      && payload.note === body.note
      && isDeepStrictEqual(payload.requestedObservations, normalizedObservations);
  };
  try {
    const result = await db.transaction(async (tx) => {
      const scope = currentScope();
      await tx.execute(lockRun(scope, body.runId));
      const prior = await findOperation(body.operationId, tx);
      if (prior) {
        return matchesPriorOperation(prior)
          ? { kind: "duplicate" as const, event: prior }
          : { kind: "conflict" as const };
      }

      const sourceLookup = await resolveCanonicalRunSource(tx, scope, body.runId);
      if (sourceLookup.state === "not-found") return { kind: "not-found" as const };
      const resolution = sourceLookup.state === "found"
        ? resolveQcExpectedComponents(
          sourceLookup.source.values,
          sourceLookup.source.substitutions,
          sourceLookup.source.runSubTab,
        )
        : {
          status: "incomplete" as const,
          reason: sourceLookup.reason,
          issues: [{
            setting: "Canonical run settings",
            message: sourceLookup.reason,
          }],
          components: [],
        };
      const componentIds = new Set(resolution.components.map((item) => item.componentId));
      if (normalizedObservations.some((item) => !componentIds.has(item.componentId))) {
        return { kind: "invalid-observation" as const };
      }
      const observationMap = new Map<string, QcComponentObservation>(
        normalizedObservations.map((item) => [item.componentId, item.observation]),
      );
      const evaluation = evaluateQcComponents(resolution, observationMap);
      const event = await appendRunEvent(tx, scope, actorId, {
        operationId: body.operationId,
        recordId: randomUUID(),
        eventType: "component-check",
        runId: body.runId,
        profileKey: sourceLookup.state === "found" ? sourceLookup.source.profileKey ?? null : null,
        payload: {
          expectedSource: sourceLookup.state === "found"
            ? {
              kind: sourceLookup.source.kind,
              date: sourceLookup.source.date,
              revision: sourceLookup.source.revision,
            }
            : null,
          expectedStatus: resolution.status,
          ...(resolution.reason ? { expectedReason: resolution.reason } : {}),
          expectedIssues: resolution.issues,
          expectedComponents: resolution.components,
          results: evaluation.items.map(({ componentId, observation, outcome }) => ({
            componentId,
            observation,
            outcome,
          })),
          outcome: evaluation.outcome,
          requestedObservations: normalizedObservations,
          note: body.note,
        },
      });
      return { kind: "created" as const, event };
    });
    if (result.kind === "not-found") {
      safeError(res, 404, "Run not found in the canonical production records");
      return;
    }
    if (result.kind === "invalid-observation") {
      safeError(res, 400, "An observation does not match a server-resolved component");
      return;
    }
    if (result.kind === "conflict") {
      safeError(res, 409, "This operation ID was already used");
      return;
    }
    if (result.kind === "duplicate") {
      res.status(200).json({ event: publicEvent(result.event), duplicate: true });
      return;
    }
    res.status(201).json({ event: publicEvent(result.event), duplicate: false });
  } catch (error) {
    const existing = await findOperation(body.operationId);
    if (existing) {
      if (matchesPriorOperation(existing)) {
        res.status(200).json({ event: publicEvent(existing), duplicate: true });
      } else {
        safeError(res, 409, "This operation ID was already used");
      }
      return;
    }
    reportRouteError(req, res, "failed to record QC component check", error);
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
    const scope = currentScope();
    const conditions = [eq(qcWorkflowEventsTable.scope, scope)];
    // Reference administration is manager-only. Operators see approved
    // references through the approved list and immutable applied check snapshots,
    // never draft/version/review payloads through the general ledger.
    if (req.capabilities?.includes("manage-qc") !== true) {
      conditions.push(notInArray(qcWorkflowEventsTable.eventType, [
        "date-code-reference", "date-code-reference-review",
        "import-committed", "import-review",
        "recipe-committed", "recipe-review",
      ]));
    }
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
    const hydratedEvents = await hydrateEvents(pageRows);
    const includeAuditRows =
      scope === "live" && req.capabilities?.includes("manage-qc") === true;
    res.json({
      items: hydratedEvents.map((event) =>
        projectAuditActionForReader(event, includeAuditRows),
      ),
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
      "sourceDocument",
      "sourceSection",
    ].join(",") + "\r\n");
    let cursor: number | undefined;
    const includeAuditDetails =
      currentScope() === "live" && req.capabilities?.includes("manage-qc") === true;
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
      for (const hydratedEvent of hydrated) {
        const event = projectAuditActionForReader(hydratedEvent, includeAuditDetails);
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
          event.eventType === "target-setting"
            && event.payload.measurementKind === "brix"
            && !event.redactedFields?.includes("payload.sourceDocument")
            ? event.payload.sourceDocument
            : "",
          event.eventType === "target-setting"
            && event.payload.measurementKind === "brix"
            && !event.redactedFields?.includes("payload.sourceSection")
            ? event.payload.sourceSection
            : "",
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

function reportDateBoundary(date: string, endOfDay: boolean): Date {
  return new Date(`${date}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
}

function parseQcIntelligenceQuery(value: unknown): {
  view: QcReportView;
  filters: QcReportFilters;
  from: Date;
  to: Date;
  limit: number;
} | null {
  const parsed = qcIntelligenceQuerySchema.safeParse(value);
  if (!parsed.success) return null;
  const today = new Date().toISOString().slice(0, 10);
  const defaultFrom = new Date(`${today}T12:00:00.000Z`);
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 29);
  const fromDateText = parsed.data.from ?? defaultFrom.toISOString().slice(0, 10);
  const toDateText = parsed.data.to ?? today;
  const from = reportDateBoundary(fromDateText, false);
  const to = reportDateBoundary(toDateText, true);
  if (from > to || to.getTime() - from.getTime() >= 366 * 24 * 60 * 60_000) return null;
  return {
    view: parsed.data.view,
    filters: {
      from: from.toISOString(),
      to: to.toISOString(),
      ingredientId: parsed.data.ingredientId ?? null,
      station: parsed.data.station ?? null,
      runId: parsed.data.runId ?? null,
      checkType: parsed.data.checkType ?? null,
    },
    from,
    to,
    limit: parsed.data.limit,
  };
}

async function resolveReportRunIdentities(
  scope: string,
  runIds: string[],
): Promise<{ runs: Map<string, {
  runId: string;
  status: "available" | "unavailable";
  source: "completed-run-snapshot" | "active-day-state" | null;
  productionDate: string | null;
  label: string | null;
}>; overflow: boolean }> {
  const runs = new Map<string, {
    runId: string;
    status: "available" | "unavailable";
    source: "completed-run-snapshot" | "active-day-state" | null;
    productionDate: string | null;
    label: string | null;
  }>();
  if (runIds.length === 0) return { runs, overflow: false };
  let overflow = runIds.length > MAX_INTELLIGENCE_RUN_SOURCES;
  const boundedIds = runIds.slice(0, MAX_INTELLIGENCE_RUN_SOURCES);
  const rows = await db.select({
    runId: completedRunHistoryTable.runId,
    date: completedRunHistoryTable.date,
    snapshotHash: completedRunHistoryTable.snapshotHash,
    snapshot: sql<unknown>`CASE WHEN octet_length(${completedRunHistoryTable.snapshot}::text) <= ${MAX_INTELLIGENCE_SNAPSHOT_BYTES} THEN ${completedRunHistoryTable.snapshot} ELSE NULL END`,
  }).from(completedRunHistoryTable).where(and(
    eq(completedRunHistoryTable.scope, scope),
    inArray(completedRunHistoryTable.runId, boundedIds),
  )).orderBy(asc(completedRunHistoryTable.completedAt))
    .limit(MAX_INTELLIGENCE_RUN_SOURCES + 1);
  if (rows.length > MAX_INTELLIGENCE_RUN_SOURCES) return { runs, overflow: true };
  const seenCompleted = new Set<string>();
  for (const row of rows) {
    const runId = row.runId;
    if (seenCompleted.has(runId)) {
      runs.set(runId, {
        runId, status: "unavailable", source: null, productionDate: null, label: null,
      });
      continue;
    }
    seenCompleted.add(runId);
    if (row.snapshot === null) overflow = true;
    const projected = projectActivitySnapshot(row.snapshot, row.date, "completed-snapshot");
    const exactRun = projected.status === "available"
      ? projected.runs.find((candidate) => candidate.runId === runId)
      : null;
    if (!exactRun || snapshotHash(row.snapshot) !== row.snapshotHash) {
      runs.set(runId, {
        runId, status: "unavailable", source: null, productionDate: null, label: null,
      });
      continue;
    }
    runs.set(runId, {
      runId,
      status: "available",
      source: "completed-run-snapshot",
      productionDate: row.date,
      label: exactRun.label,
    });
  }
  const missingIds = boundedIds.filter((runId) => !runs.has(runId));
  const today = facilityDate();
  if (missingIds.length > 0) {
    const currentRows = await db.select({
      data: sql<unknown>`CASE WHEN octet_length(${dailySyncTable.data}::text) <= ${MAX_INTELLIGENCE_SNAPSHOT_BYTES} THEN ${dailySyncTable.data} ELSE NULL END`,
    }).from(dailySyncTable).where(and(
      eq(dailySyncTable.scope, scope),
      eq(dailySyncTable.date, today),
    )).limit(2);
    if (currentRows.length === 1) {
      if (currentRows[0]!.data === null) overflow = true;
      const projected = projectActivitySnapshot(currentRows[0]!.data, today, "active-day-state");
      if (projected.status === "available") {
        for (const runId of missingIds) {
          const exactRun = projected.runs.find((candidate) => candidate.runId === runId);
          if (exactRun && !exactRun.ended) {
            runs.set(runId, {
              runId,
              status: "available",
              source: "active-day-state",
              productionDate: today,
              label: exactRun.label,
            });
          }
        }
      }
    }
  }
  return { runs, overflow };
}

async function loadQcIntelligenceReport(
  req: Request,
): Promise<ReturnType<typeof buildQcIntelligenceReport> | null> {
  const parsed = parseQcIntelligenceQuery(req.query);
  if (!parsed) return null;
  const scope = currentScope();
  const types: Array<typeof qcWorkflowEventsTable.$inferSelect.eventType> = parsed.view === "trends"
    ? ["weight", "brix-check"]
    : parsed.view === "results"
      ? ["weight", "brix-check", "component-check", "label-check", "date-code-check"]
      : ["lot"];
  const conditions = [
    eq(qcWorkflowEventsTable.scope, scope),
    inArray(qcWorkflowEventsTable.eventType, types),
    gte(qcWorkflowEventsTable.createdAt, parsed.from),
    lte(qcWorkflowEventsTable.createdAt, parsed.to),
  ];
  if (parsed.filters.ingredientId) {
    conditions.push(eq(qcWorkflowEventsTable.ingredientId, parsed.filters.ingredientId));
  }
  if (parsed.filters.runId) {
    conditions.push(eq(qcWorkflowEventsTable.runId, parsed.filters.runId));
  }
  const rows = await db.select().from(qcWorkflowEventsTable)
    .where(and(...conditions))
    .orderBy(asc(qcWorkflowEventsTable.createdAt), asc(qcWorkflowEventsTable.id))
    .limit(parsed.limit + 1);
  const moreAvailable = rows.length > parsed.limit;
  const sourceRows = rows.slice(0, parsed.limit);
  let coverage: QcReportCoverage = {
    status: moreAvailable ? "partial" as const : "complete" as const,
    sampledEvents: sourceRows.length,
    includedEvents: 0,
    maxEvents: parsed.limit,
    moreAvailable,
    reason: moreAvailable ? "event-limit" as const : null,
  };
  const ids = sourceRows.map((row) => String(row.id));
  let events: QcReportEvent[] = [];
  if (ids.length > 0) {
    const overlayRows = await db.select().from(qcWorkflowEventsTable).where(and(
      eq(qcWorkflowEventsTable.scope, scope),
      inArray(qcWorkflowEventsTable.relatedEventId, ids),
      inArray(qcWorkflowEventsTable.eventType, ["correction", "redaction"]),
    )).orderBy(asc(qcWorkflowEventsTable.id))
      .limit(MAX_INTELLIGENCE_OVERLAYS + 1);
    if (overlayRows.length > MAX_INTELLIGENCE_OVERLAYS) {
      coverage = {
        ...coverage,
        status: "partial",
        moreAvailable: true,
        reason: "overlay-limit",
      };
    } else {
      const hydrated = await hydrateEvents(sourceRows, false, overlayRows);
      events = hydrated.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        runId: event.runId,
        profileKey: event.profileKey,
        ingredientId: event.ingredientId,
        ingredientName: event.ingredientName,
        station: event.station,
        createdAt: event.createdAt,
        payload: event.payload,
        ...(event.redactedFields ? { redactedFields: event.redactedFields } : {}),
      })).filter((event) =>
        (!parsed.filters.station || event.station === parsed.filters.station)
        && (!parsed.filters.checkType || event.payload.checkType === parsed.filters.checkType),
      );
      coverage = { ...coverage, includedEvents: events.length };
    }
  }
  if (coverage.reason === "overlay-limit") {
    return buildQcIntelligenceReport(parsed.view, [], parsed.filters, coverage);
  }
  let canonicalRuns = new Map<string, {
    runId: string;
    status: "available" | "unavailable";
    source: "completed-run-snapshot" | "active-day-state" | null;
    productionDate: string | null;
    label: string | null;
  }>();
  if (parsed.view === "traceability") {
    const resolved = await resolveReportRunIdentities(scope, [
      ...new Set(events.flatMap((event) => event.runId ? [event.runId] : [])),
    ]);
    canonicalRuns = resolved.runs;
    if (resolved.overflow) {
      coverage = {
        ...coverage,
        status: "partial",
        moreAvailable: true,
        reason: "canonical-source-limit",
      };
    }
  }
  return buildQcIntelligenceReport(parsed.view, events, parsed.filters, coverage, canonicalRuns);
}

router.get("/qc/intelligence", requireCapability("manage-qc"), async (req, res) => {
  if (!parseQcIntelligenceQuery(req.query)) {
    safeError(res, 400, "Invalid or out-of-range QC intelligence report filters");
    return;
  }
  try {
    const report = await loadQcIntelligenceReport(req);
    if (!report) {
      safeError(res, 400, "Invalid or out-of-range QC intelligence report filters");
      return;
    }
    res.json(report);
  } catch (error) {
    reportRouteError(req, res, "failed to load QC intelligence report", error);
  }
});

router.get("/qc/intelligence.csv", requireCapability("manage-qc"), async (req, res) => {
  if (!parseQcIntelligenceQuery(req.query)) {
    safeError(res, 400, "Invalid or out-of-range QC intelligence export filters");
    return;
  }
  try {
    const report = await loadQcIntelligenceReport(req);
    if (!report) {
      safeError(res, 400, "Invalid or out-of-range QC intelligence export filters");
      return;
    }
    const csv = qcIntelligenceCsv(report);
    res.status(200);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="qc-${report.view}-${report.filters.from.slice(0, 10)}-to-${report.filters.to.slice(0, 10)}.csv"`,
    );
    res.send(csv);
  } catch (error) {
    if (error instanceof QcIntelligenceCsvLimitError) {
      safeError(res, 413, "QC export exceeds its size bound. Narrow the date range or filters.");
      return;
    }
    reportRouteError(req, res, "failed to export QC intelligence report", error);
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
    if (!target || !["lot", "weight", "brix-check", "component-check", "label-check", "date-code-check", "allergen-review", "cleaning"].includes(target.eventType)) {
      safeError(res, 404, "Correctable QC record not found");
      return;
    }
    const replacement = validateCorrection(target.eventType, body.replacement);
    if (!replacement) {
      safeError(res, 400, "Correction contains invalid or unsupported fields");
      return;
    }
    if (target.eventType === "component-check" && Array.isArray(replacement.observations)) {
      const expectedIds = new Set(
        (Array.isArray(target.payload.expectedComponents) ? target.payload.expectedComponents : [])
          .flatMap((item) => {
            const component = recordObject(item);
            return typeof component?.componentId === "string" ? [component.componentId] : [];
          }),
      );
      if (replacement.observations.some((item) => !expectedIds.has(item.componentId))) {
        safeError(res, 400, "Correction contains an unknown component");
        return;
      }
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
      if (target.eventType === "import-committed" || target.eventType === "import-review") {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"import-operation:" + currentScope()}, 0))`);
      }
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

export const qcDateCodeDependencies = {
  requireValid, currentActor, safeError, publicEvent, reportRouteError,
  resolveCanonicalRunSource, lockRun,
};
registerDateCodeWorkflows(router, qcDateCodeDependencies);

export default router;
