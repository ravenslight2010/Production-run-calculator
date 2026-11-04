import { MANUAL_SECTION_FIELDS, type ManualSection } from "@workspace/sync-contract";

export type ManualSectionAutoTrackLedgerRow = {
  canonicalRevision: number;
  commandType: string;
  outcome: string;
  snapshot: unknown;
  actionData: unknown;
};

const MAX_REBASE_HISTORY_ROWS = 100;
const APPLICATOR_SECTIONS = new Set<ManualSection>(["app1", "app2", "app3", "app4"]);

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function valueFor(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function sectionValuesFromSnapshot(
  snapshot: unknown,
  runId: string,
  fields: readonly string[],
): Record<string, number> | null {
  const runValues = object(object(snapshot).runValues);
  const values = object(runValues[runId]);
  if (!Object.keys(values).length) return null;
  return Object.fromEntries(fields.map((field) => [field, valueFor(values, field)]));
}

function matches(
  left: Record<string, number>,
  right: Record<string, number>,
  fields: readonly string[],
): boolean {
  return fields.every((field) => Math.abs(left[field] - right[field]) <= 1e-9);
}

function allowedChannels(section: ManualSection): ReadonlySet<string> {
  return new Set([`${section}-batch`, `${section}-stock`]);
}

/**
 * Proves that a manual applicator +/- adjustment may be applied to current
 * canonical values. The proof requires an exact matching prior section
 * snapshot, contiguous ledger revisions, and only accepted same-run
 * auto-track mutations to this section since that snapshot.
 */
export function canRebaseManualApplicatorAdjustment(input: {
  runId: string;
  section: ManualSection;
  baseValues: Record<string, number>;
  currentValues: Record<string, unknown>;
  currentRevision: number;
  ledgerRows: readonly ManualSectionAutoTrackLedgerRow[];
}): boolean {
  const { runId, section, baseValues, currentValues, currentRevision, ledgerRows } = input;
  if (!APPLICATOR_SECTIONS.has(section)
    || !Number.isSafeInteger(currentRevision)
    || currentRevision < 1
    || ledgerRows.length > MAX_REBASE_HISTORY_ROWS) return false;

  const fields = MANUAL_SECTION_FIELDS[section];
  if (fields.some((field) =>
    !Object.prototype.hasOwnProperty.call(baseValues, field)
    || typeof baseValues[field] !== "number"
    || !Number.isFinite(baseValues[field]))) return false;

  const currentSectionValues = Object.fromEntries(
    fields.map((field) => [field, valueFor(currentValues, field)]),
  );
  const sortedRows = [...ledgerRows].sort((a, b) => a.canonicalRevision - b.canonicalRevision);
  const baselineRows = sortedRows.filter((row) =>
    Number.isSafeInteger(row.canonicalRevision)
    && row.canonicalRevision < currentRevision
    && sectionValuesFromSnapshot(row.snapshot, runId, fields) !== null
    && matches(
      sectionValuesFromSnapshot(row.snapshot, runId, fields)!,
      baseValues,
      fields,
    ));
  const baselineRow = baselineRows.at(-1);
  if (!baselineRow) return false;

  const rowsAfterBaseline = sortedRows.filter((row) =>
    row.canonicalRevision > baselineRow.canonicalRevision
    && row.canonicalRevision <= currentRevision);
  if (rowsAfterBaseline.length !== currentRevision - baselineRow.canonicalRevision) return false;

  let previousValues = { ...baseValues };
  let expectedRevision = baselineRow.canonicalRevision + 1;
  let observedAutomaticChange = false;
  const channels = allowedChannels(section);

  for (const row of rowsAfterBaseline) {
    if (row.canonicalRevision !== expectedRevision) return false;
    expectedRevision += 1;

    const nextValues = sectionValuesFromSnapshot(row.snapshot, runId, fields);
    if (!nextValues) return false;
    const changedFields = fields.filter((field) =>
      Math.abs(previousValues[field] - nextValues[field]) > 1e-9);
    const action = object(row.actionData);

    if (row.commandType === `manual-section:${section}`
      && action.runId === runId
      && action.section === section) return false;

    if (changedFields.length) {
      if (row.commandType !== "auto-track"
        || row.outcome !== "accepted"
        || action.runId !== runId
        || typeof action.channel !== "string"
        || !channels.has(action.channel)
        || !Array.isArray(action.mutations)) return false;

      const mutations = action.mutations.map((mutation) => object(mutation));
      for (const field of changedFields) {
        const mutation = mutations.find((candidate) => candidate.field === field);
        if (!mutation
          || typeof mutation.from !== "number"
          || typeof mutation.to !== "number"
          || Math.abs(mutation.from - previousValues[field]) > 1e-9
          || Math.abs(mutation.to - nextValues[field]) > 1e-9) return false;
      }
      observedAutomaticChange = true;
    }

    previousValues = nextValues;
  }

  return observedAutomaticChange
    && matches(previousValues, currentSectionValues, fields);
}
