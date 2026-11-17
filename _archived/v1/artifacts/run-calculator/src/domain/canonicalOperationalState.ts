import { COMMAND_OWNED_RUN_FIELDS, COMMAND_OWNED_VALUE_FIELDS } from "@workspace/sync-contract";
import type { RunMeta, FormValues, SyncPayload } from "../types";

/** LWW remains useful for setup, never for an acknowledged operational fact. */
export function canonicalOperationalRun(local: RunMeta, remote: Partial<RunMeta>): RunMeta {
  const result = { ...local, metaUpdatedAt: remote.metaUpdatedAt };
  for (const field of COMMAND_OWNED_RUN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(remote, field)) {
      Object.assign(result, { [field]: remote[field] });
    } else delete result[field];
  }
  return result;
}

/** Pending display values must not be smuggled into the snapshot channel. */
export function canonicalOperationalSnapshotForPublish(
  payload: SyncPayload, confirmed?: SyncPayload | null,
): SyncPayload {
  const canonical = confirmed?.dayState?.date && payload.dayState.date
    && confirmed.dayState.date !== payload.dayState.date ? undefined : confirmed;
  const runs = new Map((canonical?.dayState?.runs ?? []).map((run) => [run.id, run]));
  const values = Object.fromEntries(Object.entries(payload.runValues ?? {}).map(([id, local]) => {
    const target = { ...local } as unknown as Record<string, unknown>;
    const source = (canonical?.runValues?.[id] ?? {}) as unknown as Record<string, unknown>;
    for (const field of COMMAND_OWNED_VALUE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(source, field)) target[field] = source[field];
      else delete target[field];
    }
    return [id, target];
  }));
  const result = {
    ...payload,
    dayState: { ...payload.dayState,
      runs: payload.dayState.runs.map((run) => canonicalOperationalRun(run, runs.get(run.id) ?? {})),
    },
    runValues: values,
  } as SyncPayload;
  for (const field of ["packagingProgress", "doughTimerControls"] as const) {
    if (canonical?.[field] !== undefined) Object.assign(result, { [field]: canonical[field] });
    else delete result[field];
  }
  return result;
}

export function canonicalOperationalValues(local: FormValues, remote: FormValues): FormValues {
  const result = { ...local } as unknown as Record<string, unknown>;
  const source = remote as unknown as Record<string, unknown>;
  for (const field of COMMAND_OWNED_VALUE_FIELDS) {
    result[field] = source[field] ?? (field.endsWith("Initialized") ? false : 0);
  }
  return result as unknown as FormValues;
}
