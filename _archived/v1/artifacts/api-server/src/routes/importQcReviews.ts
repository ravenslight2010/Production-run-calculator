import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, importOperationsTable, qcWorkflowEventsTable } from "@workspace/db";
import { currentScope } from "../lib/requestScope";
import { requireCapability } from "../middlewares/requireCapability";
import { inspectImportUndo } from "./importOperations";

const router: IRouter = Router();
const identity = z.string().regex(/^[A-Za-z0-9_-]{16,120}$/);
const decisionSchema = z.object({
  decisionId: identity,
  expectedResultHash: z.string().regex(/^[a-f0-9]{64}$/),
  expectedRevision: z.number().int().min(0),
  status: z.enum(["verified", "rejected"]),
  reason: z.string().trim().min(1).max(1000),
}).strict();

// A committed summary is the durable source. The operation row is optional:
// factory purge/source retirement must not erase or invent QC evidence.
function projection(scope: string) {
  return sql`WITH sources AS (
    SELECT c.record_id AS id, c.id AS capture_id,
      CASE WHEN EXISTS (SELECT 1 FROM qc_workflow_events red
        WHERE red.scope = c.scope AND red.event_type = 'redaction'
          AND red.related_event_id = c.id::text
          AND red.payload->'fields' @> '["payload.summary"]'::jsonb)
        THEN c.payload - 'summary' ELSE c.payload END AS payload,
      c.created_at, COALESCE(o.status, 'source-removed') AS apply_status
    FROM qc_workflow_events c
    LEFT JOIN import_operations o ON o.id = c.record_id AND o.scope = c.scope
    WHERE c.scope = ${scope} AND c.event_type = 'import-committed'
    UNION ALL
    SELECT o.id, NULL::integer, jsonb_build_object('operationId', o.id,
      'resultHash', o.result_hash, 'importType', o.import_type),
      o.created_at, o.status
    FROM import_operations o WHERE o.scope = ${scope}
      AND o.status IN ('applied', 'undone')
      AND NOT EXISTS (SELECT 1 FROM qc_workflow_events c WHERE c.scope = o.scope
        AND c.event_type = 'import-committed' AND c.record_id = o.id)
  ), projected AS (
    SELECT s.*, COALESCE(r.id, 0) AS revision,
      COALESCE(r.payload->>'status', 'pending') AS qc_status
    FROM sources s LEFT JOIN LATERAL (
      SELECT e.id, e.payload FROM qc_workflow_events e
      WHERE e.scope = ${scope} AND e.event_type = 'import-review'
        AND e.record_id = s.id AND e.payload->>'resultHash' = s.payload->>'resultHash'
      ORDER BY e.id DESC LIMIT 1
    ) r ON true
  )`;
}
type Projection = {
  id: string; capture_id: number | null; payload: Record<string, unknown>;
  created_at: Date | string; apply_status: string; revision: number; qc_status: string;
};
function item(row: Projection) {
  return {
    operationId: row.id, resultHash: row.payload.resultHash ?? null,
    importType: row.payload.importType, createdAt: new Date(row.created_at).toISOString(),
    applyStatus: row.apply_status, qcStatus: row.qc_status,
    revision: row.revision, evidenceAvailable: row.capture_id !== null && !!row.payload.summary,
  };
}

router.get("/qc/import-review-badges", async (_req, res) => {
  const result = await db.execute<{ pending: number; rejected: number }>(sql`${projection(currentScope())}
    SELECT count(*) FILTER (WHERE qc_status = 'pending')::integer AS pending,
      count(*) FILTER (WHERE qc_status = 'rejected')::integer AS rejected FROM projected`);
  res.setHeader("Cache-Control", "no-store");
  res.json(result.rows[0]);
});

router.get("/qc/import-reviews", requireCapability("manage-qc"), async (req, res) => {
  const query = z.object({
    cursor: z.string().regex(/^[A-Za-z0-9_-]{1,120}$/).optional(),
    status: z.enum(["pending", "verified", "rejected", "all"]).default("pending"),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  }).strict().safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: "Invalid import review filters" }); return; }
  const { cursor, status, limit } = query.data;
  const result = await db.execute<Projection>(sql`${projection(currentScope())}
    SELECT * FROM projected WHERE ${cursor ? sql`id > ${cursor}` : sql`true`}
      AND ${status === "all" ? sql`true` : sql`qc_status = ${status}`}
    ORDER BY id LIMIT ${limit + 1}`);
  const page = result.rows.slice(0, limit);
  res.setHeader("Cache-Control", "no-store");
  res.json({ items: page.map(item), nextCursor: result.rows.length > limit ? page.at(-1)!.id : null });
});

router.get("/qc/import-reviews/:operationId", requireCapability("manage-qc"), async (req, res) => {
  const id = identity.safeParse(req.params.operationId);
  if (!id.success) { res.status(400).json({ error: "Invalid import operation identity" }); return; }
  const result = await db.execute<Projection>(sql`${projection(currentScope())}
    SELECT * FROM projected WHERE id = ${id.data} LIMIT 1`);
  const row = result.rows[0];
  if (!row) { res.status(404).json({ error: "Import review not found" }); return; }
  const decisions = await db.select().from(qcWorkflowEventsTable).where(and(
    eq(qcWorkflowEventsTable.scope, currentScope()),
    eq(qcWorkflowEventsTable.recordId, id.data),
    eq(qcWorkflowEventsTable.eventType, "import-review"),
  )).orderBy(desc(qcWorkflowEventsTable.id)).limit(20);
  const overlays: Array<{ related_event_id: string; payload: Record<string, unknown> }> = decisions.length ? (await db.execute<{ related_event_id: string; payload: Record<string, unknown> }>(sql`
    SELECT related_event_id, payload FROM qc_workflow_events
    WHERE scope = ${currentScope()} AND event_type = 'redaction'
      AND related_event_id IN (${sql.join(decisions.map((event) => sql`${String(event.id)}`), sql`, `)})
    ORDER BY id`)).rows : [];
  res.setHeader("Cache-Control", "no-store");
  res.json({
    ...item(row), summary: row.payload.summary ?? null,
    summaryLimitation: "Bounded normalized change summary, not the workbook. At most 30 changed rows, 40 field names and 24 safe scalar values per side are retained; text is capped at 120 characters. Notes and raw source are not retained. Omitted or unrepresented details are unknown, not confirmed unchanged.",
    decisions: decisions.map((event) => {
      const redacted = overlays.filter((overlay) => overlay.related_event_id === String(event.id))
        .flatMap((overlay) => Array.isArray(overlay.payload.fields) ? overlay.payload.fields : []);
      return {
        id: event.id, status: event.payload.status, resultHash: event.payload.resultHash,
        reason: redacted.includes("payload.reason") ? "[redacted]" : event.payload.reason,
        actorId: redacted.includes("actorId") ? "[redacted]" : event.actorId,
        createdAt: event.createdAt.toISOString(),
      };
    }),
    undo: {
      available: await inspectImportUndo(id.data, req.capabilities ?? []),
      guidance: row.apply_status === "applied"
        ? "Rejection does not undo Apply. An authorized importer may request existing guarded Undo; it will conflict if affected rows changed. QC access does not grant Undo permission."
        : "Guarded Undo is unavailable because the original applied operation is no longer active. No data is restored by this review.",
    },
  });
});

router.post("/qc/import-reviews/:operationId/decisions", requireCapability("manage-qc"), async (req, res) => {
  const id = identity.safeParse(req.params.operationId);
  const body = decisionSchema.safeParse(req.body);
  if (!id.success || !body.success) { res.status(400).json({ error: "Invalid import QC decision; include a rationale" }); return; }
  const scope = currentScope(), input = body.data;
  const result = await db.transaction(async (tx) => {
    // Share the Apply/Undo lock so a decision never crosses a concurrent Undo.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"import-operation:" + scope}, 0))`);
    const [prior] = await tx.select().from(qcWorkflowEventsTable).where(and(
      eq(qcWorkflowEventsTable.scope, scope),
      eq(qcWorkflowEventsTable.operationId, `import-review:${input.decisionId}`),
    )).limit(1);
    if (prior) {
      const matches = prior.actorId === req.userId && prior.eventType === "import-review" && prior.recordId === id.data &&
        prior.payload.resultHash === input.expectedResultHash && prior.payload.expectedRevision === input.expectedRevision &&
        prior.payload.status === input.status && prior.payload.reason === input.reason;
      return matches ? { event: prior, replayed: true } : { error: "This retry identity belongs to a different decision", code: 409 };
    }
    const [operation] = await tx.select().from(importOperationsTable).where(and(
      eq(importOperationsTable.scope, scope), eq(importOperationsTable.id, id.data),
    )).limit(1);
    if (!operation) return { error: "The committed operation is no longer available for a new review", code: 409 };
    if (operation.status !== "applied" || operation.resultHash !== input.expectedResultHash) {
      return { error: "Apply state or result changed. Refresh and inspect the exact committed result.", code: 409 };
    }
    const [capture] = await tx.select().from(qcWorkflowEventsTable).where(and(
      eq(qcWorkflowEventsTable.scope, scope), eq(qcWorkflowEventsTable.recordId, id.data),
      eq(qcWorkflowEventsTable.eventType, "import-committed"),
    )).limit(1);
    if (!capture || capture.payload.resultHash !== input.expectedResultHash) {
      return { error: "Legacy or missing review evidence: this operation remains unreviewed", code: 409 };
    }
    const redacted = await tx.execute(sql`SELECT id FROM qc_workflow_events WHERE scope = ${scope}
      AND event_type = 'redaction' AND related_event_id = ${String(capture.id)}
      AND payload->'fields' @> '["payload.summary"]'::jsonb LIMIT 1`);
    if (redacted.rows.length) return { error: "The retained summary was redacted and cannot support a new decision", code: 409 };
    const [latest] = await tx.select().from(qcWorkflowEventsTable).where(and(
      eq(qcWorkflowEventsTable.scope, scope), eq(qcWorkflowEventsTable.recordId, id.data),
      eq(qcWorkflowEventsTable.eventType, "import-review"),
    )).orderBy(desc(qcWorkflowEventsTable.id)).limit(1);
    if ((latest?.id ?? 0) !== input.expectedRevision) return { error: "Another reviewer changed this review. Refresh before deciding again.", code: 409 };
    const [event] = await tx.insert(qcWorkflowEventsTable).values({
      scope, operationId: `import-review:${input.decisionId}`, recordId: id.data,
      eventType: "import-review", relatedEventId: String(capture.id), actorId: req.userId!,
      payload: { operationId: id.data, resultHash: input.expectedResultHash, expectedRevision: input.expectedRevision, status: input.status, reason: input.reason },
    }).returning();
    return { event: event!, replayed: false };
  });
  if ("error" in result) { res.status(result.code!).json({ error: result.error }); return; }
  res.status(result.replayed ? 200 : 201).json({
    operationId: id.data, resultHash: result.event.payload.resultHash,
    qcStatus: result.event.payload.status, revision: result.event.id, replayed: result.replayed,
  });
});

export default router;
