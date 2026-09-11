import type { IngredientBatchWeight } from "@workspace/db";

export type IngredientBatchWeightRepointPlan = {
  winnerId: number | null;
  winnerLbs: number | null;
  deleteIds: number[];
};

type BatchWeightRow = Pick<
  IngredientBatchWeight,
  "id" | "name" | "lbs" | "updatedAt"
>;

function weightKey(name: string): string {
  return name.trim().toLowerCase();
}

function rowRecency(row: BatchWeightRow): number {
  return row.updatedAt instanceof Date ? row.updatedAt.getTime() : 0;
}

/**
 * Plan the learned-weight side of an ingredient rename/merge.
 *
 * The surviving ingredient name is the explicit winner: a positive weight
 * already keyed by the target beats every source weight. Legacy case-variant
 * duplicates use newest-updated, then highest-id ordering. If the target has
 * no weight, the same deterministic ordering chooses among source weights.
 * Every other affected row is retired by the caller in the same transaction.
 */
export function planIngredientBatchWeightRepoint(
  rows: readonly BatchWeightRow[],
  targetName: string,
  sourceNames: readonly string[],
): IngredientBatchWeightRepointPlan {
  const targetKey = weightKey(targetName);
  if (!targetKey) return { winnerId: null, winnerLbs: null, deleteIds: [] };

  const sourceKeys = new Set(
    sourceNames
      .map(weightKey)
      .filter((key) => key.length > 0 && key !== targetKey),
  );
  const affected = rows.filter((row) => {
    const key = weightKey(row.name);
    return key === targetKey || sourceKeys.has(key);
  });

  const positive = affected.filter(
    (row) => Number.isFinite(Number(row.lbs)) && Number(row.lbs) > 0,
  );
  const newestFirst = (a: BatchWeightRow, b: BatchWeightRow) =>
    rowRecency(b) - rowRecency(a) || b.id - a.id;
  const targetRows = positive
    .filter((row) => weightKey(row.name) === targetKey)
    .sort(newestFirst);
  const sourceRows = positive
    .filter((row) => weightKey(row.name) !== targetKey)
    .sort(newestFirst);
  const winner = targetRows[0] ?? sourceRows[0];

  return {
    winnerId: winner?.id ?? null,
    winnerLbs: winner?.lbs ?? null,
    deleteIds: affected
      .filter((row) => row.id !== winner?.id)
      .map((row) => row.id),
  };
}