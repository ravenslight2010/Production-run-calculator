import { desc, eq } from "drizzle-orm";
import { dataHealsTable, db } from "@workspace/db";

/** Read-only projection.  It intentionally does not import repair definitions. */
export type RepairResultRecord = Readonly<{
  id: string;
  appliedAt: Date;
  result: Record<string, unknown> | null;
}>;

type ReadExecutor = Pick<typeof db, "select">;

export async function findRepairResult(
  executor: ReadExecutor,
  id: string,
): Promise<RepairResultRecord | null> {
  const [row] = await executor.select({
    id: dataHealsTable.id, appliedAt: dataHealsTable.appliedAt, result: dataHealsTable.result,
  }).from(dataHealsTable).where(eq(dataHealsTable.id, id)).limit(1);
  return row ? { ...row, result: row.result as Record<string, unknown> | null } : null;
}

export async function listRepairResults(executor: ReadExecutor, limit = 50): Promise<RepairResultRecord[]> {
  const rows = await executor.select({
    id: dataHealsTable.id, appliedAt: dataHealsTable.appliedAt, result: dataHealsTable.result,
  }).from(dataHealsTable).orderBy(desc(dataHealsTable.appliedAt)).limit(Math.max(1, Math.min(limit, 100)));
  return rows.map((row) => ({ ...row, result: row.result as Record<string, unknown> | null }));
}