import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { IRouter } from "express";
import * as z from "zod";
import { db, qcWorkflowEventsTable, type QcWorkflowEventRow } from "@workspace/db";
import { currentScope } from "../lib/requestScope";
import { requireCapability } from "../middlewares/requireCapability";
import {
  dateCodeObservedSchema, dateCodeReadabilitySchema, evaluateDateCodeCheck, QC_DATE_CODE_FIELDS,
} from "../lib/qcDateCodeChecks";
import type { qcDateCodeDependencies } from "./qcWorkflows";

const operationId = z.string().uuid();
const runId = z.string().trim().min(1).max(200);
const batchContext = z.string().trim().min(1).max(200);
const context = z.enum(["shipper-case", "carton-label", "product-pack"]);
const referenceBody = z.object({
  operationId,
  referenceId: z.string().uuid().optional(),
  runId, batchContext, context,
  expected: dateCodeObservedSchema,
  requiredFields: z.array(z.enum(QC_DATE_CODE_FIELDS)).min(1).max(3)
    .refine((fields) => new Set(fields).size === fields.length),
  sourceIdentity: z.string().trim().min(1).max(200),
  sourceVersion: z.string().trim().min(1).max(120),
  sourceDescription: z.string().trim().min(1).max(500),
}).strict();
const reviewBody = z.object({
  operationId, decision: z.enum(["approved", "withdrawn"]),
  reason: z.string().trim().min(1).max(500),
}).strict();
const checkBody = z.object({
  operationId, runId, batchContext, context,
  referenceEventId: z.number().int().positive().optional(),
  labelCheckEventId: z.number().int().positive().optional(),
  observed: dateCodeObservedSchema,
  readability: dateCodeReadabilitySchema,
  note: z.string().trim().max(1000).optional().default(""),
}).strict();
const storedReference = referenceBody.omit({ operationId: true }).extend({
  referenceId: z.string().uuid(), version: z.number().int().positive(),
  productKey: z.string().max(400),
});
type Executor = Pick<typeof db, "select">;
async function latest(executor: Executor, scope: string, referenceId: string) {
  const [row] = await executor.select().from(qcWorkflowEventsTable).where(and(
    eq(qcWorkflowEventsTable.scope, scope),
    eq(qcWorkflowEventsTable.eventType, "date-code-reference"),
    sql`${qcWorkflowEventsTable.payload}->'value'->>'referenceId' = ${referenceId}`,
  )).orderBy(desc(qcWorkflowEventsTable.id)).limit(1);
  return row;
}
async function review(executor: Executor, scope: string, eventId: number) {
  const [row] = await executor.select().from(qcWorkflowEventsTable).where(and(
    eq(qcWorkflowEventsTable.scope, scope),
    eq(qcWorkflowEventsTable.eventType, "date-code-reference-review"),
    eq(qcWorkflowEventsTable.relatedEventId, String(eventId)),
  )).orderBy(desc(qcWorkflowEventsTable.id)).limit(1);
  return row;
}
async function currentReferences(executor: Executor, scope: string) {
  const rows = await executor.select().from(qcWorkflowEventsTable).where(and(
    eq(qcWorkflowEventsTable.scope, scope), eq(qcWorkflowEventsTable.eventType, "date-code-reference"),
  )).orderBy(desc(qcWorkflowEventsTable.id)).limit(5001);
  if (rows.length > 5000) throw new DateCodeError(503, "Date-code reference review limit exceeded");
  const seen = new Set<string>();
  const items: Array<{ row: QcWorkflowEventRow; value: z.infer<typeof storedReference> }> = [];
  for (const row of rows) {
    const value = storedReference.parse(row.payload.value);
    if (seen.has(value.referenceId)) continue;
    seen.add(value.referenceId);
    items.push({ row, value });
  }
  if (items.length > 200) throw new DateCodeError(503, "Date-code reference review limit exceeded");
  return items;
}
class DateCodeError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const fingerprint = (value: unknown): string => {
  const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]))
      : value;
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
};

export function registerDateCodeWorkflows(router: IRouter, deps: typeof qcDateCodeDependencies) {
  const { requireValid, currentActor, safeError, publicEvent, reportRouteError, resolveCanonicalRunSource } = deps;
  // Shared lock serializes configuration, approvals and checks so provenance is
  // from one committed version. Run locks retain existing sign-off ordering.
  const lock = (scope: string) => sql`SELECT pg_advisory_xact_lock(hashtextextended(${"qc-date-code:" + scope}, 0))`;
  async function append(
    actorId: string, input: { operationId: string }, request: unknown,
    create: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0], scope: string) => Promise<typeof qcWorkflowEventsTable.$inferInsert>,
  ) {
    return db.transaction(async (tx) => {
      const scope = currentScope();
      await tx.execute(lock(scope));
      const [prior] = await tx.select().from(qcWorkflowEventsTable).where(and(
        eq(qcWorkflowEventsTable.scope, scope), eq(qcWorkflowEventsTable.operationId, input.operationId),
      )).limit(1);
      if (prior) {
        if (prior.actorId !== actorId || prior.payload.requestFingerprint !== fingerprint(request))
          throw new DateCodeError(409, "Operation ID was already used for another request");
        return { event: prior, duplicate: true };
      }
      const values = await create(tx, scope);
      const [event] = await tx.insert(qcWorkflowEventsTable).values({
        ...values, scope, actorId, payload: { ...values.payload, requestFingerprint: fingerprint(request) },
      }).returning();
      return { event, duplicate: false };
    });
  }
  function handleError(req: Parameters<typeof reportRouteError>[0], res: Parameters<typeof safeError>[0], error: unknown) {
    if (error instanceof DateCodeError) safeError(res, error.status, error.message);
    else reportRouteError(req, res, "Date-code evidence could not be saved or loaded", error);
  }
  const canonicalProduct = async (tx: Executor, scope: string, id: string) => {
    const canonical = await resolveCanonicalRunSource(tx, scope, id);
    if (canonical.state !== "found") {
      throw new DateCodeError(canonical.state === "not-found" ? 404 : 409, "Canonical run is unavailable in this scope");
    }
    return canonical.source.profileKey ?? "";
  };
  const knownProduct = (key: string) => key.split("__").length === 2 && !key.startsWith("__") && !key.endsWith("__");
  router.get("/qc/date-code-references", requireCapability("record-qc"), async (req, res) => {
    try {
      const scope = currentScope();
      const references = await currentReferences(db, scope);
      const items = [];
      for (const { row, value } of references) {
        const reviewed = await review(db, scope, row.id);
        const state = reviewed?.payload.decision ?? "draft";
        if (state !== "approved" && !req.capabilities?.includes("manage-qc")) continue;
        items.push({ ...value, configurationEventId: row.id, state,
          reviewedBy: reviewed?.actorId ?? null, reviewedAt: reviewed?.createdAt.toISOString() ?? null });
      }
      res.json({ items });
    } catch (error) { handleError(req, res, error); }
  });
  router.post("/qc/date-code-references", requireCapability("manage-qc"), async (req, res) => {
    const body = requireValid(referenceBody, req.body, res);
    const actorId = currentActor(req);
    if (!body || !actorId) return;
    try {
      const result = await append(actorId, body, { kind: "date-code-reference", ...body }, async (tx, scope) => {
        const productKey = await canonicalProduct(tx, scope, body.runId);
        const previous = body.referenceId ? await latest(tx, scope, body.referenceId) : null;
        if (body.referenceId && !previous) throw new DateCodeError(404, "Reference not found in this scope");
        const previousValue = previous ? storedReference.parse(previous.payload.value) : null;
        const current = await currentReferences(tx, scope);
        if (!previous && current.length >= 200) throw new DateCodeError(503, "Date-code reference review limit exceeded");
        if (current.some(({ value }) => value.referenceId !== body.referenceId
          && value.runId === body.runId && value.context === body.context && value.batchContext === body.batchContext)) {
          throw new DateCodeError(409, "A reference already exists for this run, batch and packaging context; create a new version");
        }
        const { operationId: _, ...configuration } = body;
        const value = { ...configuration, referenceId: body.referenceId ?? randomUUID(),
          version: (previousValue?.version ?? 0) + 1, productKey };
        return { operationId: body.operationId, recordId: value.referenceId, eventType: "date-code-reference",
          runId: null, actorId, scope, station: "packaging", payload: { value } };
      });
      res.status(result.duplicate ? 200 : 201).json({ ...result, event: publicEvent(result.event) });
    } catch (error) { handleError(req, res, error); }
  });
  router.post("/qc/date-code-references/:eventId/review", requireCapability("manage-qc"), async (req, res) => {
    const body = requireValid(reviewBody, req.body, res);
    const actorId = currentActor(req);
    const eventId = Number(req.params.eventId);
    if (!body || !actorId) return;
    if (!Number.isSafeInteger(eventId) || eventId < 1) { safeError(res, 400, "Invalid reference version ID"); return; }
    try {
      const result = await append(actorId, body, { kind: "date-code-reference-review", eventId, ...body }, async (tx, scope) => {
        const [configuration] = await tx.select().from(qcWorkflowEventsTable).where(and(
          eq(qcWorkflowEventsTable.scope, scope), eq(qcWorkflowEventsTable.id, eventId),
          eq(qcWorkflowEventsTable.eventType, "date-code-reference"),
        )).limit(1);
        if (!configuration) throw new DateCodeError(404, "Reference version not found");
        const value = storedReference.parse(configuration.payload.value);
        if ((await latest(tx, scope, value.referenceId))?.id !== eventId) throw new DateCodeError(409, "Review the latest reference version");
        if (body.decision === "approved" && (!knownProduct(value.productKey)
          || value.requiredFields.some((field) => !value.expected[field].trim()))) {
          throw new DateCodeError(400, "Approval requires canonical product identity and all required expected text");
        }
        const previous = await review(tx, scope, eventId);
        if (previous?.payload.decision === body.decision || (body.decision === "withdrawn" && previous?.payload.decision !== "approved"))
          throw new DateCodeError(409, "Reference review state changed; reload before reviewing");
        return { operationId: body.operationId, recordId: value.referenceId, eventType: "date-code-reference-review",
          scope, actorId, runId: null, relatedEventId: String(eventId), station: "packaging",
          payload: { decision: body.decision, reason: body.reason, version: value.version } };
      });
      res.status(result.duplicate ? 200 : 201).json({ ...result, event: publicEvent(result.event) });
    } catch (error) { handleError(req, res, error); }
  });
  router.post("/qc/date-code-checks", requireCapability("record-qc"), async (req, res) => {
    const body = requireValid(checkBody, req.body, res);
    const actorId = currentActor(req);
    if (!body || !actorId) return;
    try {
      const result = await append(actorId, body, { kind: "date-code-check", ...body }, async (tx, scope) => {
        await tx.execute(deps.lockRun(scope, body.runId));
        const productKey = await canonicalProduct(tx, scope, body.runId);
        let labelSnapshot = null;
        if (body.labelCheckEventId) {
          const [label] = await tx.select().from(qcWorkflowEventsTable).where(and(
            eq(qcWorkflowEventsTable.scope, scope), eq(qcWorkflowEventsTable.id, body.labelCheckEventId),
            eq(qcWorkflowEventsTable.runId, body.runId), eq(qcWorkflowEventsTable.eventType, "label-check"),
          )).limit(1);
          if (!label) throw new DateCodeError(404, "Label check is unavailable in this run and scope");
          labelSnapshot = { eventId: label.id, recordId: label.recordId, context: label.payload.context };
        }
        let referenceSnapshot: Record<string, unknown> | null = null;
        let referenceUnavailableReason = "No approved reference was selected.";
        if (body.referenceEventId) {
          // Guessed IDs must not expose draft, withdrawn or inapplicable
          // configuration contents (or reveal which unavailable state exists).
          referenceUnavailableReason = "Selected reference is unavailable or not applicable.";
          const [configuration] = await tx.select().from(qcWorkflowEventsTable).where(and(
            eq(qcWorkflowEventsTable.scope, scope), eq(qcWorkflowEventsTable.id, body.referenceEventId),
            eq(qcWorkflowEventsTable.eventType, "date-code-reference"),
          )).limit(1);
          if (configuration) {
            const value = storedReference.parse(configuration.payload.value);
            const reviewed = await review(tx, scope, configuration.id);
            const current = await latest(tx, scope, value.referenceId);
            const applicable = value.runId === body.runId && value.batchContext === body.batchContext
              && value.context === body.context && knownProduct(productKey) && value.productKey === productKey;
            const candidates = await currentReferences(tx, scope);
            let approvedCount = 0;
            for (const candidate of candidates) {
              if (candidate.value.runId === body.runId && candidate.value.batchContext === body.batchContext
                && candidate.value.context === body.context
                && (await review(tx, scope, candidate.row.id))?.payload.decision === "approved") approvedCount++;
            }
            const state = approvedCount > 1 ? "ambiguous" : current?.id !== configuration.id ? "stale"
              : !applicable ? "inapplicable" : reviewed?.payload.decision ?? "draft";
            if (state === "approved") {
              referenceSnapshot = { ...value, configurationEventId: configuration.id, state,
                approvalEventId: reviewed?.id,
                configuredBy: configuration.actorId, configuredAt: configuration.createdAt.toISOString(),
                approvedBy: reviewed?.actorId ?? null, approvedAt: reviewed?.createdAt.toISOString() ?? null,
                approvalReason: reviewed?.payload.reason ?? null };
              referenceUnavailableReason = "";
            }
          }
        }
        const { operationId: _, ...observations } = body;
        return { operationId: body.operationId, recordId: randomUUID(), eventType: "date-code-check",
          scope, actorId, runId: body.runId, profileKey: productKey || null, station: "packaging",
          relatedEventId: body.labelCheckEventId ? String(body.labelCheckEventId) : null,
          payload: evaluateDateCodeCheck({ ...observations, referenceSnapshot, referenceUnavailableReason, labelSnapshot }) };
      });
      res.status(result.duplicate ? 200 : 201).json({ ...result, event: publicEvent(result.event) });
    } catch (error) { handleError(req, res, error); }
  });
}
