/**
 * Read-only changes to an explicit write set. Absence from an input is never a
 * deletion: callers must pass a delete instruction or a complete after snapshot.
 * Array indices are intentionally significant (including repeated ingredients).
 */
export type ImportFieldChange = { field: string; before: unknown; after: unknown; unit?: string };
export type ImportEntityChange = {
  entity: string;
  key: string;
  label: string;
  action: "create" | "change" | "link" | "remove";
  fields: ImportFieldChange[];
};
export type ImportSnapshot = Record<string, Record<string, unknown>[]>;
export type ImportWriteSet = Record<string, { upsert?: Record<string, unknown>[]; delete?: unknown[] }>;

const METADATA = new Set(["scope", "createdAt", "updatedAt", "updatedAtMs", "force"]);
export function importRowKey(entity: string, row: Record<string, unknown>): string {
  return entity === "specImportAliases"
    ? JSON.stringify([row.kind, row.externalName, row.context ?? null])
    : String(row.key ?? row.id ?? "");
}
function flatten(value: unknown, field: string, output: Map<string, unknown>): void {
  if (Array.isArray(value) && value.length) {
    value.forEach((child, i) => flatten(child, `${field}[${i + 1}]`, output));
  } else if (value && typeof value === "object" && Object.keys(value).length) {
    for (const [key, child] of Object.entries(value)) {
      if (!METADATA.has(key)) flatten(child, field ? `${field}.${key}` : key, output);
    }
  } else if (field) output.set(field, value);
}
export function importFieldUnit(entity: string, field: string, row: Record<string, unknown>): string | undefined {
  if (/ozPerPizza|sauceOzPerPizza|perPizza$|(?:app[1-4]|pepperoni[1-4])Oz$/i.test(field)) return "oz/pizza";
  if (/lbs$|perBatchLbs$|batchSize$/.test(field)) return "lbs/batch";
  if (/doughballWeightOz|targetDoughballWeight/.test(field)) return "oz/doughball";
  if (/daysEarly|DaysEarly/.test(field)) return "days";
  if (/cases$|plannedCases$|casesPlanned$|casesNeeded$/.test(field)) return "cases";
  if (/pizzasPerCase$/.test(field)) return "pizzas/case";
  if (/casesPerSkid$/.test(field)) return "cases/skid";
  if (/sharePct$/.test(field)) return "%";
  return undefined;
}
/** Source absence is review evidence, not an instruction to delete factory data. */
export function compareImportSourceVersions(before: ImportSnapshot, candidate: ImportSnapshot): ImportEntityChange[] {
  return compareImportSnapshots(before, candidate).map((change) => change.action === "remove" ? {
    ...change, action: "change",
    fields: [{ field: "reviewed source coverage (not a deletion)", before: "included in previous Apply", after: "not included in this reviewed candidate" }],
  } : change);
}
export function compareImportSnapshots(before: ImportSnapshot, after: ImportSnapshot): ImportEntityChange[] {
  const changes: ImportEntityChange[] = [];
  for (const entity of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (entity === "specImportAliasKeys") continue;
    const oldRows = new Map((before[entity] ?? []).map((row) => [importRowKey(entity, row), row]));
    const newRows = new Map((after[entity] ?? []).map((row) => [importRowKey(entity, row), row]));
    for (const key of new Set([...oldRows.keys(), ...newRows.keys()])) {
      const oldRow = oldRows.get(key);
      const newRow = newRows.get(key);
      const oldFields = new Map<string, unknown>();
      const newFields = new Map<string, unknown>();
      if (oldRow) flatten(oldRow, "", oldFields);
      if (newRow) flatten(newRow, "", newFields);
      const fields = [...new Set([...oldFields.keys(), ...newFields.keys()])]
        .filter((field) => JSON.stringify(oldFields.get(field)) !== JSON.stringify(newFields.get(field)))
        .map((field) => ({
          field, before: oldFields.get(field), after: newFields.get(field),
          unit: importFieldUnit(entity, field, newRow ?? oldRow ?? {}),
        }));
      if (!fields.length) continue;
      const row = newRow ?? oldRow!;
      const isLink = fields.every(({ field }) => /RecipeName|recipeName|canonicalName/.test(field));
      changes.push({
        entity, key, label: String(row.name ?? (row.brand ? `${row.brand} / ${row.flavor || "(brand default)"}` : key)),
        action: !oldRow ? "create" : !newRow ? "remove" : isLink ? "link" : "change",
        fields,
      });
    }
  }
  return changes;
}
export function projectImportWrites(before: ImportSnapshot, writes: ImportWriteSet): ImportSnapshot {
  const after: ImportSnapshot = {};
  for (const [entity, change] of Object.entries(writes)) {
    const values = new Map((before[entity] ?? []).map((row) => [importRowKey(entity, row), row]));
    for (const row of change.upsert ?? []) {
      const key = importRowKey(entity, row);
      values.set(key, { ...values.get(key), ...row });
    }
    for (const key of change.delete ?? []) {
      values.delete(typeof key === "object" && key ? importRowKey(entity, key as Record<string, unknown>) : String(key));
    }
    after[entity] = [...values.values()];
  }
  return after;
}
