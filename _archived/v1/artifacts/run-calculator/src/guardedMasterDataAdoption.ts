import { MASTER_DATA_REFERENCE_VALUE_FIELDS } from "@workspace/factory-constants";
import type { SharedMasterDataOperation } from "./sharedMasterDataUndo";
const allowed = new Set(MASTER_DATA_REFERENCE_VALUE_FIELDS);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Never reset a live run, an unowned form, or an unrelated unsaved value. */
export function adoptGuardedPendingReferences<T extends object>(input: {
  date: string; originRunId?: string; run?: { id: string; startedAt?: unknown; endedAt?: unknown };
  original: T; current: T; canonical: Record<string, unknown>;
  operation: Pick<SharedMasterDataOperation, "status" | "affectedRunReferences">;
}): T | null {
  if (!input.run || input.run.id !== input.originRunId || input.run.startedAt || input.run.endedAt) return null;
  const original = input.original as Record<string, unknown>, current = input.current as Record<string, unknown>;
  const next = { ...current }; let changed = false;
  for (const ref of input.operation.affectedRunReferences ?? []) {
    if (ref.date !== input.date || ref.runId !== input.run.id || ref.section !== "values" || !allowed.has(ref.field)) continue;
    const expected = input.operation.status === "undone" ? ref.after : ref.before;
    if (Object.hasOwn(input.canonical, ref.field) && same(original[ref.field], expected) && same(current[ref.field], original[ref.field])
      && !same(current[ref.field], input.canonical[ref.field])) {
      next[ref.field] = input.canonical[ref.field]; changed = true;
    }
  }
  return changed ? next as T : null;
}
