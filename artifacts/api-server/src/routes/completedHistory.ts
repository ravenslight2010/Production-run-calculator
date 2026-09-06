import { createHash, randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import * as z from "zod";
import { completedRunHistoryTable, db } from "@workspace/db";
import { currentScope } from "../lib/requestScope";

const router: IRouter = Router();
const MAX_SNAPSHOT_BYTES = 1024 * 1024;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Invalid date");
const CompletionSchema = z.object({
  operationId: z.string().min(1).max(300).regex(/^[A-Za-z0-9:_-]+$/),
  runId: z.string().min(1).max(500),
  date: isoDate,
  completedAt: z.string().datetime({ offset: true }),
  snapshot: z.record(z.string(), z.unknown()),
}).strict();
const ListSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
}).refine((value) => !value.from || !value.to || value.from <= value.to);

export function validateCompletionBoundary(input: z.infer<typeof CompletionSchema>): boolean {
  const snapshot = input.snapshot as {
    dayState?: { date?: unknown; runs?: unknown[] };
    runValues?: Record<string, unknown>;
  };
  if (snapshot.dayState?.date !== input.date || !Array.isArray(snapshot.dayState.runs)) return false;
  const matching = snapshot.dayState.runs.filter((candidate) =>
    !!candidate && typeof candidate === "object"
    && (candidate as { id?: unknown }).id === input.runId
  );
  if (matching.length !== 1 || !snapshot.runValues
    || !Object.prototype.hasOwnProperty.call(snapshot.runValues, input.runId)) return false;
  const run = matching[0] as { startedAt?: unknown; endedAt?: unknown };
  const completedAt = Date.parse(input.completedAt);
  return typeof run.startedAt === "number" && Number.isFinite(run.startedAt)
    && typeof run.endedAt === "number" && Number.isFinite(run.endedAt)
    && run.endedAt >= run.startedAt
    && run.endedAt === completedAt;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
  }
  return value;
}
function hash(snapshot: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(snapshot))).digest("hex");
}
function sameCompletion(row: typeof completedRunHistoryTable.$inferSelect, snapshotHash: string): boolean {
  return row.snapshotHash === snapshotHash;
}

// Auth is applied to this router by routes/index. Completion intentionally has no
// delete/update endpoint; only the immutable finalization operation exists.
router.get("/completed-history", async (req: Request, res: Response): Promise<void> => {
  const parsed = ListSchema.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid history range" }); return; }
  const scope = currentScope();
  const conditions = [eq(completedRunHistoryTable.scope, scope)];
  if (parsed.data.from) conditions.push(gte(completedRunHistoryTable.date, parsed.data.from));
  if (parsed.data.to) conditions.push(lte(completedRunHistoryTable.date, parsed.data.to));
  const rows = await db.select().from(completedRunHistoryTable)
    .where(and(...conditions)).orderBy(asc(completedRunHistoryTable.date), asc(completedRunHistoryTable.runId));
  res.json({ history: rows.map((row) => ({
    operationId: row.operationId, runId: row.runId, date: row.date,
    completedAt: row.completedAt.toISOString(), snapshot: row.snapshot, snapshotHash: row.snapshotHash,
  })) });
});

router.post("/completed-history", async (req: Request, res: Response): Promise<void> => {
  const parsed = CompletionSchema.safeParse(req.body);
  if (!parsed.success || !validateCompletionBoundary(parsed.data)
    || Buffer.byteLength(JSON.stringify(req.body ?? {}), "utf8") > MAX_SNAPSHOT_BYTES) {
    res.status(400).json({ error: "Invalid or oversized completed-run snapshot" }); return;
  }
  const input = parsed.data;
  const snapshotHash = hash(input.snapshot);
  const scope = currentScope();
  // Locking the candidate rows makes same-run conflicting peer finalization
  // deterministic, while unique indexes cover first-write races.
  try {
    const result = await db.transaction(async (tx) => {
      const [operation] = await tx.select().from(completedRunHistoryTable).where(and(
        eq(completedRunHistoryTable.scope, scope), eq(completedRunHistoryTable.operationId, input.operationId),
      )).for("update");
      if (operation) return { row: operation, duplicate: sameCompletion(operation, snapshotHash), conflict: !sameCompletion(operation, snapshotHash) };
      const [canonical] = await tx.select().from(completedRunHistoryTable).where(and(
        eq(completedRunHistoryTable.scope, scope), eq(completedRunHistoryTable.date, input.date), eq(completedRunHistoryTable.runId, input.runId),
      )).for("update");
      if (canonical) return { row: canonical, duplicate: sameCompletion(canonical, snapshotHash), conflict: !sameCompletion(canonical, snapshotHash) };
      const [row] = await tx.insert(completedRunHistoryTable).values({
        id: randomUUID(), scope, operationId: input.operationId, runId: input.runId, date: input.date,
        completedAt: new Date(input.completedAt), snapshot: stable(input.snapshot) as Record<string, unknown>,
        snapshotHash, actorId: req.userId ?? "unknown",
      }).returning();
      return { row, duplicate: false, conflict: false };
    });
    if (result.conflict) {
      res.status(409).json({
        error: "A different immutable completion already exists for this run and date",
        canonical: {
          operationId: result.row.operationId,
          runId: result.row.runId,
          date: result.row.date,
          completedAt: result.row.completedAt.toISOString(),
          snapshot: result.row.snapshot,
          snapshotHash: result.row.snapshotHash,
        },
      });
      return;
    }
    res.status(result.duplicate ? 200 : 201).json({ acknowledged: true, duplicate: result.duplicate, operationId: result.row.operationId });
  } catch (error: any) {
    // A first-write unique race cannot overwrite history. Read the canonical
    // record and give the retry the same idempotent/conflict answer.
    if (error?.code === "23505" || error?.cause?.code === "23505") {
      const rows = await db.select().from(completedRunHistoryTable).where(and(
        eq(completedRunHistoryTable.scope, scope), eq(completedRunHistoryTable.date, input.date), eq(completedRunHistoryTable.runId, input.runId),
      ));
      const row = rows[0];
      if (row && sameCompletion(row, snapshotHash)) { res.json({ acknowledged: true, duplicate: true, operationId: row.operationId }); return; }
      res.status(409).json({
        error: "A different immutable completion already exists for this run and date",
        ...(row ? {
          canonical: {
            operationId: row.operationId,
            runId: row.runId,
            date: row.date,
            completedAt: row.completedAt.toISOString(),
            snapshot: row.snapshot,
            snapshotHash: row.snapshotHash,
          },
        } : {}),
      });
      return;
    }
    throw error;
  }
});

export default router;