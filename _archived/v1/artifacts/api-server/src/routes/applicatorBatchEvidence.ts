import { createHash, randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, gt, gte, lte, or } from "drizzle-orm";
import * as z from "zod";
import { applicatorBatchEvidenceTable, completedRunHistoryTable, db } from "@workspace/db";
import { currentScope } from "../lib/requestScope";
import { requireCapability, requireManagerRole } from "../middlewares/requireCapability";

const router: IRouter = Router();
export function isValidApplicatorEvidenceDate(value: string): boolean {
  const parsed = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isValidApplicatorEvidenceDate, "Invalid date");
const id = z.string().min(1).max(300).regex(/^[A-Za-z0-9:_-]+$/);
const slot = z.number().int().min(1).max(4);
const total = z.number().int().min(0).max(1_000_000);

const FinalizeSchema = z.object({
  operationId: id,
  date: isoDate,
  runId: z.string().min(1).max(500),
  slot,
  finalTotal: total,
  correctionOf: id.optional(),
}).strict();
const ListSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  runId: z.string().min(1).max(500).optional(),
  // The encoded cursor contains a run id (up to 500 chars) plus timestamps and
  // the evidence id; keep enough headroom for a bounded, opaque token.
  cursor: z.string().max(4096).regex(/^[A-Za-z0-9_-]+$/).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(500),
}).refine((value) => !value.from || !value.to || value.from <= value.to);

type EvidenceCursor = { date: string; runId: string; slot: number; createdAt: string; id: string };
function decodeCursor(value: string | undefined): EvidenceCursor | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as EvidenceCursor;
    if (typeof parsed.date !== "string" || !isValidApplicatorEvidenceDate(parsed.date)
      || typeof parsed.runId !== "string" || parsed.runId.length < 1 || parsed.runId.length > 500
      || !Number.isInteger(parsed.slot) || parsed.slot < 1 || parsed.slot > 4
      || typeof parsed.createdAt !== "string" || parsed.createdAt.length > 100
      || Number.isNaN(new Date(parsed.createdAt).getTime())
      || new Date(parsed.createdAt).toISOString() !== parsed.createdAt
      || typeof parsed.id !== "string" || parsed.id.length < 1 || parsed.id.length > 300
      || !/^[A-Za-z0-9:_-]+$/.test(parsed.id)) return undefined;
    return parsed;
  } catch { return undefined; }
}
function encodeCursor(value: EvidenceCursor): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function parseApplicatorBatchFinalization(input: unknown) {
  return FinalizeSchema.safeParse(input);
}
export function classifyApplicatorSubmission(existingHash: string | undefined, incomingHash: string): "new" | "duplicate" | "conflict" {
  return existingHash === undefined ? "new" : existingHash === incomingHash ? "duplicate" : "conflict";
}
export function canCreateInitialApplicatorFinal(latestManagerOperationId: string | undefined): boolean {
  return latestManagerOperationId === undefined;
}
export function correctionTargetsLatestApplicatorFinal(
  latestManagerOperationId: string | undefined,
  correctionOf: string | undefined,
): boolean {
  return !!latestManagerOperationId && correctionOf === latestManagerOperationId;
}
export function completedRunMatchesApplicatorFinal(
  completed: { scope: string; date: string; runId: string } | undefined,
  scope: string,
  date: string,
  runId: string,
): boolean {
  return !!completed && completed.scope === scope && completed.date === date && completed.runId === runId;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
  }
  return value;
}

export function applicatorEvidenceHash(value: {
  operationId: string;
  date: string;
  runId: string;
  slot: number;
  source: string;
  observedTotal?: number | null;
  confirmedTotal?: number | null;
  correctionOf?: string | null;
}): string {
  const bounded = {
    operationId: value.operationId,
    date: value.date,
    runId: value.runId,
    slot: value.slot,
    source: value.source,
    observedTotal: value.observedTotal ?? null,
    confirmedTotal: value.confirmedTotal ?? null,
    correctionOf: value.correctionOf ?? null,
  };
  return createHash("sha256").update(JSON.stringify(stable(bounded))).digest("hex");
}

export function serializeApplicatorEvidence(row: typeof applicatorBatchEvidenceTable.$inferSelect) {
  return {
    id: row.id,
    operationId: row.operationId,
    date: row.date,
    runId: row.runId,
    slot: row.slot,
    source: row.source,
    ...(row.observedTotal === null ? {} : { observedTotal: row.observedTotal }),
    ...(row.confirmedTotal === null ? {} : { confirmedTotal: row.confirmedTotal }),
    ...(row.correctionOf ? { correctionOf: row.correctionOf } : {}),
    evidenceHash: row.evidenceHash,
    hashContract: row.hashContract,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Used by the auto-track transaction so accepted progress and its evidence
 * share the same commit boundary. The operation key makes retries harmless. */
export async function appendAutomaticApplicatorEvidence(
  tx: any,
  args: { scope: string; date: string; runId: string; slot: number; observedTotal: number; eventId: string },
): Promise<void> {
  // Claim event IDs are client-defined and need not be globally unique across
  // runs or slots. Derive a compact operation identity from the full boundary
  // so one valid observation cannot suppress another through a key collision.
  const operationId = `auto:${createHash("sha256").update(JSON.stringify([
    args.date, args.runId, args.slot, args.eventId,
  ])).digest("hex")}`;
  const payload = {
    operationId,
    date: args.date,
    runId: args.runId,
    slot: args.slot,
    source: "automatic-observation",
    observedTotal: args.observedTotal,
    confirmedTotal: null,
    correctionOf: null,
  };
  await tx.insert(applicatorBatchEvidenceTable).values({
    id: randomUUID(),
    scope: args.scope,
    ...payload,
    evidenceHash: applicatorEvidenceHash(payload),
  }).onConflictDoNothing({
    target: [applicatorBatchEvidenceTable.scope, applicatorBatchEvidenceTable.operationId],
  });
}

router.get("/applicator-batch-evidence", async (req: Request, res: Response): Promise<void> => {
  const parsed = ListSchema.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid evidence range" }); return; }
  const scope = currentScope();
  const conditions = [eq(applicatorBatchEvidenceTable.scope, scope)];
  if (parsed.data.from) conditions.push(gte(applicatorBatchEvidenceTable.date, parsed.data.from));
  if (parsed.data.to) conditions.push(lte(applicatorBatchEvidenceTable.date, parsed.data.to));
  if (parsed.data.runId) conditions.push(eq(applicatorBatchEvidenceTable.runId, parsed.data.runId));
  const cursor = decodeCursor(parsed.data.cursor);
  if (parsed.data.cursor && !cursor) { res.status(400).json({ error: "Invalid evidence cursor" }); return; }
  if (cursor) {
    const cursorDate = new Date(cursor.createdAt);
    conditions.push(or(
      gt(applicatorBatchEvidenceTable.date, cursor.date),
      and(eq(applicatorBatchEvidenceTable.date, cursor.date), gt(applicatorBatchEvidenceTable.runId, cursor.runId)),
      and(eq(applicatorBatchEvidenceTable.date, cursor.date), eq(applicatorBatchEvidenceTable.runId, cursor.runId), gt(applicatorBatchEvidenceTable.slot, cursor.slot)),
      and(eq(applicatorBatchEvidenceTable.date, cursor.date), eq(applicatorBatchEvidenceTable.runId, cursor.runId), eq(applicatorBatchEvidenceTable.slot, cursor.slot), gt(applicatorBatchEvidenceTable.createdAt, cursorDate)),
      and(eq(applicatorBatchEvidenceTable.date, cursor.date), eq(applicatorBatchEvidenceTable.runId, cursor.runId), eq(applicatorBatchEvidenceTable.slot, cursor.slot), eq(applicatorBatchEvidenceTable.createdAt, cursorDate), gt(applicatorBatchEvidenceTable.id, cursor.id)),
    )!);
  }
  const rows = await db.select().from(applicatorBatchEvidenceTable)
    .where(and(...conditions))
    .orderBy(asc(applicatorBatchEvidenceTable.date), asc(applicatorBatchEvidenceTable.runId),
      asc(applicatorBatchEvidenceTable.slot), asc(applicatorBatchEvidenceTable.createdAt), asc(applicatorBatchEvidenceTable.id))
    .limit(parsed.data.limit);
  const next = rows.length === parsed.data.limit && rows.length > 0
    ? encodeCursor({
      date: rows[rows.length - 1].date, runId: rows[rows.length - 1].runId, slot: rows[rows.length - 1].slot,
      createdAt: rows[rows.length - 1].createdAt.toISOString(), id: rows[rows.length - 1].id,
    })
    : undefined;
  res.json({ evidence: rows.map(serializeApplicatorEvidence), ...(next ? { nextCursor: next } : {}) });
});

// A final physical count is a literal manager attestation. Corrections append a
// new row and point at the prior manager row; no evidence row is ever updated.
router.post(
  "/applicator-batch-evidence/finalize",
  requireCapability("review-incidents"),
  requireManagerRole,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = FinalizeSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid applicator batch finalization" }); return; }
    const input = parsed.data;
    const scope = currentScope();
    const source = input.correctionOf ? "manager-correction" : "manager-finalization";
    const payload = {
      operationId: input.operationId, date: input.date, runId: input.runId, slot: input.slot,
      source, observedTotal: null, confirmedTotal: input.finalTotal,
      correctionOf: input.correctionOf ?? null,
    };
    const evidenceHash = applicatorEvidenceHash(payload);
    try {
      const result = await db.transaction(async (tx) => {
        const [operation] = await tx.select().from(applicatorBatchEvidenceTable).where(and(
          eq(applicatorBatchEvidenceTable.scope, scope),
          eq(applicatorBatchEvidenceTable.operationId, input.operationId),
        )).for("update");
        if (operation) {
          const outcome = classifyApplicatorSubmission(operation.evidenceHash, evidenceHash);
          return { row: operation, duplicate: outcome === "duplicate", conflict: outcome === "conflict" };
        }
        const [completed] = await tx.select({
          scope: completedRunHistoryTable.scope,
          date: completedRunHistoryTable.date,
          runId: completedRunHistoryTable.runId,
        })
          .from(completedRunHistoryTable).where(and(
            eq(completedRunHistoryTable.scope, scope),
            eq(completedRunHistoryTable.date, input.date),
            eq(completedRunHistoryTable.runId, input.runId),
          )).for("update");
        if (!completedRunMatchesApplicatorFinal(completed, scope, input.date, input.runId)) {
          return { row: undefined, duplicate: false, conflict: true, missingCompleted: true };
        }
        const priorManagers = await tx.select().from(applicatorBatchEvidenceTable).where(and(
          eq(applicatorBatchEvidenceTable.scope, scope),
          eq(applicatorBatchEvidenceTable.date, input.date),
          eq(applicatorBatchEvidenceTable.runId, input.runId),
          eq(applicatorBatchEvidenceTable.slot, input.slot),
        )).orderBy(desc(applicatorBatchEvidenceTable.createdAt), desc(applicatorBatchEvidenceTable.id)).for("update");
        const latestManager = priorManagers.find((row) => row.source.startsWith("manager-"));
        if (!input.correctionOf && !canCreateInitialApplicatorFinal(latestManager?.operationId)) {
          return { row: latestManager, duplicate: false, conflict: true };
        }
        if (input.correctionOf) {
          const [target] = await tx.select().from(applicatorBatchEvidenceTable).where(and(
            eq(applicatorBatchEvidenceTable.scope, scope),
            eq(applicatorBatchEvidenceTable.operationId, input.correctionOf),
          )).for("update");
          if (!target || !correctionTargetsLatestApplicatorFinal(latestManager?.operationId, input.correctionOf)
            || !target.source.startsWith("manager-")
            || target.date !== input.date || target.runId !== input.runId || target.slot !== input.slot) {
            return { row: latestManager, duplicate: false, conflict: true };
          }
        }
        const [row] = await tx.insert(applicatorBatchEvidenceTable).values({
          id: randomUUID(), scope, ...payload, evidenceHash,
        }).returning();
        return { row, duplicate: false, conflict: false };
      });
      if (result.conflict) {
        res.status(409).json({
          error: "missingCompleted" in result && result.missingCompleted
            ? "Applicator finalization requires an immutable completed run"
            : input.correctionOf
            ? "Correction does not reference the canonical applicator finalization"
            : "An immutable applicator finalization already exists for this slot",
          ...(result.row ? { canonical: serializeApplicatorEvidence(result.row) } : {}),
        });
        return;
      }
      if (!result.row) throw new Error("Applicator evidence finalization returned no record");
      res.status(result.duplicate ? 200 : 201).json({
        acknowledged: true, duplicate: result.duplicate, operationId: result.row.operationId,
        evidenceHash: result.row.evidenceHash,
        canonical: serializeApplicatorEvidence(result.row),
      });
    } catch (error: any) {
      if (error?.code === "23505" || error?.cause?.code === "23505") {
        const [row] = await db.select().from(applicatorBatchEvidenceTable).where(and(
          eq(applicatorBatchEvidenceTable.scope, scope),
          eq(applicatorBatchEvidenceTable.operationId, input.operationId),
        ));
        if (row && row.evidenceHash === evidenceHash) {
          res.json({
            acknowledged: true, duplicate: true, operationId: row.operationId, evidenceHash: row.evidenceHash,
            canonical: serializeApplicatorEvidence(row),
          });
          return;
        }
        const managerRows = await db.select().from(applicatorBatchEvidenceTable).where(and(
          eq(applicatorBatchEvidenceTable.scope, scope),
          eq(applicatorBatchEvidenceTable.date, input.date),
          eq(applicatorBatchEvidenceTable.runId, input.runId),
          eq(applicatorBatchEvidenceTable.slot, input.slot),
        )).orderBy(desc(applicatorBatchEvidenceTable.createdAt), desc(applicatorBatchEvidenceTable.id));
        const canonical = managerRows.find((candidate) => candidate.source.startsWith("manager-"));
        res.status(409).json({
          error: row ? "A different evidence record already uses this operation"
            : input.correctionOf
              ? "A correction already advances this applicator finalization"
              : "An immutable applicator finalization already exists for this slot",
          ...(row ?? canonical ? { canonical: serializeApplicatorEvidence(row ?? canonical!) } : {}),
        });
        return;
      }
      throw error;
    }
  },
);

export default router;