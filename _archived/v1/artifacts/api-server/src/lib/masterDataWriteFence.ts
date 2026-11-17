import type { Request, Response, NextFunction } from "express";
import { db, masterDataUndoEpochsTable, runInRequestDatabaseTransaction } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { currentScope } from "./requestScope";

export type MasterDataTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class MasterDataWriteConflict extends Error {
  readonly status = 409;
  constructor() {
    super("Shared data changed after this edit was prepared. Refresh canonical records and review the pending edit before retrying; it has not been applied.");
  }
}

export async function lockMasterDataScope(tx: MasterDataTransaction, scope: string): Promise<number> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('guarded-master-data'), hashtext(${scope}))`);
  const [row] = await tx.select().from(masterDataUndoEpochsTable)
    .where(eq(masterDataUndoEpochsTable.scope, scope));
  return row?.epoch ?? 0;
}

/** Must wrap the mutation itself, not a preflight check outside its transaction. */
export function withMasterDataWrite<T>(
  req: Request,
  write: (tx: MasterDataTransaction) => Promise<T>,
): Promise<T> {
  const scope = currentScope();
  const epoch = req.header("x-master-data-epoch");
  return db.transaction(async (tx) => {
    const current = await lockMasterDataScope(tx, scope);
    if (current > 0 && epoch !== String(current)) throw new MasterDataWriteConflict();
    return write(tx);
  });
}

export function respondMasterDataWriteConflict(error: unknown, res: Response): boolean {
  if (!(error instanceof MasterDataWriteConflict)) return false;
  res.status(409).json({ error: error.message });
  return true;
}

const canonicalReadPaths = new Set([
  "/master-data/bootstrap", "/ingredients", "/mixes", "/cheese-recipes", "/dough-recipes",
  "/sauce-recipes", "/brand-profiles", "/run-templates", "/factory-data", "/factory-data/operational",
  "/die-types", "/merged-away", "/spec-import-aliases", "/merge-aliases", "/ingredient-batch-weights",
]);
const masterMutationPaths = /^(?:\/(?:ingredients|mixes|cheese-recipes|dough-recipes|sauce-recipes|brand-profiles|run-templates|factory-data|die-types|merged-away|spec-import-aliases|merge-aliases|ingredient-batch-weights))(?:\/|$)/u;
class RolledBackResponse extends Error {}

/**
 * Legacy/direct writers use the SAME scope lock and epoch as compensation.
 * Database calls (including nested transactions) remain on one pooled client.
 * Buffer the final response until commit; a failed commit cannot report success.
 */
export async function masterDataMutationFence(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method) || !masterMutationPaths.test(req.path)) { next(); return; }
  const originalEnd = res.end;
  let endArguments: Parameters<Response["end"]> | undefined;
  let completed: (() => void) | undefined;
  let aborted: ((error: Error) => void) | undefined;
  const closed = () => aborted?.(new Error("Shared mutation connection closed before confirmation."));
  const timer = setTimeout(() => aborted?.(new Error("Shared mutation exceeded its bounded transaction.")), 25_000);
  timer.unref();
  try {
    await runInRequestDatabaseTransaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '20s'`);
      const epoch = await lockMasterDataScope(tx, currentScope());
      if (epoch > 0 && req.header("x-master-data-epoch") !== String(epoch)) throw new MasterDataWriteConflict();
      const response = new Promise<void>((resolve, reject) => { completed = resolve; aborted = reject; });
      res.once("close", closed);
      res.end = function (...args: Parameters<Response["end"]>): Response {
        if (!endArguments) { endArguments = args; completed?.(); }
        return res;
      } as Response["end"];
      next();
      await response;
      if (res.statusCode >= 400) throw new RolledBackResponse();
    });
  } catch (error) {
    if (!(error instanceof RolledBackResponse)) {
      endArguments = undefined;
      res.end = originalEnd;
      res.removeHeader("Content-Length");
      res.removeHeader("Content-Encoding");
      res.removeHeader("ETag");
      if (!res.destroyed && !respondMasterDataWriteConflict(error, res)) {
        res.status(503).json({ error: "Shared records could not be committed. No success has been confirmed; refresh and retry." });
      }
    }
  } finally {
    clearTimeout(timer);
    res.removeListener("close", closed);
    res.end = originalEnd;
  }
  if (endArguments && !res.destroyed) originalEnd.apply(res, endArguments);
}

/**
 * Read the epoch BEFORE the representation is read. Reading it afterward could
 * attach a new epoch to old data when Undo races with a GET.
 */
export async function masterDataReadEpoch(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.method !== "GET" || !canonicalReadPaths.has(req.path)) { next(); return; }
  try {
    const [row] = await db.select().from(masterDataUndoEpochsTable)
      .where(eq(masterDataUndoEpochsTable.scope, currentScope()));
    res.setHeader("X-Master-Data-Epoch", String(row?.epoch ?? 0));
    next();
  } catch (error) { next(error); }
}
