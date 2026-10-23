import { db, ingredientsTable, doughRecipesTable, sauceRecipesTable, cheeseRecipesTable, mixesTable,
  brandProfilesTable, runTemplatesTable, factoryKvTable, dieTypesTable, specImportAliasesTable,
  mergeAliasesTable, mergedAwayTable, ingredientBatchWeightsTable, dailySyncTable,
  masterDataOperationsTable, masterDataUndoEpochsTable, completedRunHistoryTable, inventoryItemsTable,
  type MasterDataEntity, type MasterDataFact, type MasterDataReferenceFact } from "@workspace/db";
import { and, eq, sql, inArray, getTableColumns, getTableName } from "drizzle-orm";
import { OPERATIONAL_DIRECTORY_KEYS, MASTER_DATA_REFERENCE_VALUE_FIELDS } from "@workspace/factory-constants";
import { appendSyncOutboxEvent } from "./syncOutbox";
import { lockMasterDataScope, type MasterDataTransaction } from "./masterDataWriteFence";
import { buildMasterDataPlan, planPendingReferences, masterHash, canonicalMasterJson, masterJsonClone,
  MasterDataPlanError, type MasterDataWorld, type MasterDataCommand } from "./masterDataPlan";
import type { Scope } from "./requestScope";
import { directoryFactFingerprint, restoreDirectoryFactValue, isFreshFenceDirectory, scopedDirectoryEvidence } from "./masterDataDirectoryFacts";
import { assertMasterDataOperationActor } from "./masterDataOperationAuthorization";

type Row = Record<string, any>;
const configs: Record<MasterDataEntity, { table: any; key: string }> = {
  ingredients: { table: ingredientsTable, key: "id" },
  doughRecipes: { table: doughRecipesTable, key: "id" },
  sauceRecipes: { table: sauceRecipesTable, key: "id" },
  cheeseRecipes: { table: cheeseRecipesTable, key: "id" },
  mixes: { table: mixesTable, key: "id" },
  profiles: { table: brandProfilesTable, key: "key" },
  templates: { table: runTemplatesTable, key: "id" },
  directories: { table: factoryKvTable, key: "key" },
  dies: { table: dieTypesTable, key: "id" },
  specAliases: { table: specImportAliasesTable, key: "id" },
  mergeAliases: { table: mergeAliasesTable, key: "id" },
  mergedAway: { table: mergedAwayTable, key: "id" },
  ingredientWeights: { table: ingredientBatchWeightsTable, key: "id" },
};
const entities = Object.keys(configs) as MasterDataEntity[];
const MAX_ROWS_PER_ENTITY = 2_000;
const MAX_FACTS = 500;
const MAX_EVIDENCE_BYTES = 512 * 1024;
const MAX_REFERENCE_FACTS = 500;
const DIRECTORY_KEYS = [...OPERATIONAL_DIRECTORY_KEYS];
const stamp = () => Date.now();
const keyFor = (entity: MasterDataEntity, row: Row) => row[configs[entity].key] === undefined
  ? `new:${masterHash(row)}` : String(row[configs[entity].key]);
const equal = (a: unknown, b: unknown) => canonicalMasterJson(a) === canonicalMasterJson(b);

export class MasterDataOperationConflict extends Error {
  constructor(message = "A shared record or dependent reference changed. Refresh shared history and review the newer change; nothing was restored.") { super(message); }
}
let failureHook: ((stage: string) => void) | undefined;
export function setMasterDataOperationFailureHookForTest(hook?: (stage: string) => void): void {
  if (process.env.NODE_ENV !== "test") throw new Error("Test failure injection is unavailable.");
  failureHook = hook;
}

async function lockTables(tx: MasterDataTransaction): Promise<void> {
  await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
  await tx.execute(sql`SET LOCAL statement_timeout = '15s'`);
  // Deterministic lock order also fences legacy writers that do not yet use
  // the shared advisory lock. No external calls take place inside this lock.
  const tables = [...new Set([...entities.map((entity) => getTableName(configs[entity].table)),
    getTableName(dailySyncTable), getTableName(inventoryItemsTable), getTableName(completedRunHistoryTable)])].sort();
  for (const table of tables) await tx.execute(sql`LOCK TABLE ${sql.identifier(table)} IN SHARE ROW EXCLUSIVE MODE`);
}

async function readWorld(tx: MasterDataTransaction, scope: Scope): Promise<MasterDataWorld> {
  const world = {} as MasterDataWorld;
  let totalBytes = 0;
  for (const entity of entities) {
    const { table } = configs[entity];
    const predicate = entity === "directories" ? and(eq(table.scope, scope), inArray(table.key, [...DIRECTORY_KEYS])) : eq(table.scope, scope);
    const [size] = await tx.select({ count: sql<string>`count(*)::text`,
      bytes: sql<string>`coalesce(sum(octet_length(row_to_json(${table})::text)), 0)::text` }).from(table).where(predicate);
    totalBytes += Number(size?.bytes ?? 0);
    if (Number(size?.count ?? 0) > MAX_ROWS_PER_ENTITY || !Number.isSafeInteger(totalBytes) || totalBytes > 16 * 1024 * 1024) {
      throw new MasterDataPlanError("Canonical dependencies exceed the bounded transaction. No shared records were changed.");
    }
    const rows = await tx.select().from(table).where(predicate).limit(MAX_ROWS_PER_ENTITY + 1);
    if (rows.length > MAX_ROWS_PER_ENTITY) throw new MasterDataPlanError("This change exceeds the bounded history transaction. No shared records were changed.");
    world[entity] = masterJsonClone(rows).sort((a: Row, b: Row) => keyFor(entity, a) < keyFor(entity, b) ? -1 : keyFor(entity, a) > keyFor(entity, b) ? 1 : 0);
  }
  return world;
}

async function readDays(tx: MasterDataTransaction, scope: Scope) {
  const [size] = await tx.select({ count: sql<string>`count(*)::text`,
    bytes: sql<string>`coalesce(sum(octet_length(row_to_json(${dailySyncTable})::text)), 0)::text` })
    .from(dailySyncTable).where(eq(dailySyncTable.scope, scope));
  if (Number(size?.count ?? 0) > 500 || Number(size?.bytes ?? 0) > 16 * 1024 * 1024) {
    throw new MasterDataPlanError("Run dependencies exceed the safe bounded transaction. No shared records were changed.");
  }
  const days = await tx.select().from(dailySyncTable).where(eq(dailySyncTable.scope, scope)).limit(501);
  if (days.length > 500 || Buffer.byteLength(JSON.stringify(days)) > 16 * 1024 * 1024) {
    throw new MasterDataPlanError("Run dependencies exceed the safe bounded transaction. No shared records were changed.");
  }
  return days.sort((a, b) => a.date.localeCompare(b.date));
}
const referenceFields = MASTER_DATA_REFERENCE_VALUE_FIELDS;
function dayReferenceGuard(days: Awaited<ReturnType<typeof readDays>>): unknown {
  return days.map((day) => {
    const payload = day.data as Row;
    return {
      date: day.date,
      runs: (payload?.dayState?.runs ?? []).map((run: Row) => ({
        id: run.id, brand: run.brand, flavor: run.flavor, startedAt: run.startedAt, endedAt: run.endedAt,
        values: Object.fromEntries(referenceFields.filter((key) => payload.runValues?.[run.id]?.[key] !== undefined)
          .map((key) => [key, payload.runValues[run.id][key]])),
      })),
    };
  });
}
function guardHash(world: MasterDataWorld, days: Awaited<ReturnType<typeof readDays>>): string {
  return masterHash({ world, references: dayReferenceGuard(days) });
}
function affectedGuard(world: MasterDataWorld, days: Awaited<ReturnType<typeof readDays>>, facts: MasterDataFact[],
  references: MasterDataReferenceFact[], command: MasterDataCommand): string {
  const names = new Set([...command.sources, command.target].filter(Boolean).map((name) => String(name).trim().toLowerCase()));
  const ids = new Set(facts.filter((fact) => fact.entity === "ingredients").map((fact) => fact.key));
  const mentions = (value: unknown): boolean => {
    if (typeof value === "string") return names.has(value.trim().toLowerCase()) || ids.has(value);
    if (Array.isArray(value)) return value.some(mentions);
    return !!value && typeof value === "object" && Object.values(value).some(mentions);
  };
  const affectedRows = facts.map((fact) => {
    const row = world[fact.entity].find((candidate) => keyFor(fact.entity, candidate) === fact.key) ?? null;
    return { entity: fact.entity, key: fact.key, row: fact.entity === "directories" ? directoryFactFingerprint(fact, row) : row };
  });
  const dependentRows = entities.flatMap((entity) => world[entity].filter((row) => {
    if (entity === "directories") return false; // Changed directory documents already have their own exact guard.
    const valueReferences = [row.values, row.crustValues].map((values) =>
      values && typeof values === "object" && !Array.isArray(values)
        ? Object.fromEntries(referenceFields.map((key) => [key, values[key]])) : values);
    return mentions([row.name, row.brand, row.flavor, row.flavors, row.components, row.canonicalName, row.externalName,
      row.context, row.ingredientId, ...valueReferences]);
  }).map((row) => ({ entity, key: keyFor(entity, row), row })));
  const relevantDays = (dayReferenceGuard(days) as Array<{ date: string; runs: Array<Row> }>).map((day) => ({
    date: day.date, runs: day.runs.filter((run) =>
      references.some((ref) => ref.date === day.date && ref.runId === run.id) || mentions([run.brand, run.flavor, run.values])),
  })).filter((day) => day.runs.length);
  return masterHash({ affectedRows, dependentRows, references: relevantDays });
}

/** Publish NEW inverse name fences, never put the old deletion clocks back. */
async function publishInverseNameFences(tx: MasterDataTransaction, scope: Scope, facts: MasterDataFact[], command: MasterDataCommand): Promise<void> {
  const restored = await tx.select().from(factoryKvTable).where(and(eq(factoryKvTable.scope, scope),
    inArray(factoryKvTable.key, ["run-calc-deleted-items", "run-calc-deleted-stamps", "run-calc-undeleted-stamps"])));
  const get = (key: string): Row => {
    const value = restored.find((row) => row.key === key)?.value;
    return value && typeof value === "object" && !Array.isArray(value) ? masterJsonClone(value) as Row : {};
  };
  const deleted = get("run-calc-deleted-items"), stamps = get("run-calc-deleted-stamps"), undeleted = get("run-calc-undeleted-stamps");
  const previousClocks = facts.filter((fact) => fact.entity === "directories" && /(?:un)?deleted-stamps$/u.test(fact.key))
    .flatMap((fact) => [fact.before?.value, fact.after?.value]);
  let time = Date.now();
  const maxClock = (value: unknown) => {
    if (typeof value === "number" && Number.isSafeInteger(value)) time = Math.max(time, value + 1);
    else if (value && typeof value === "object") Object.values(value).forEach(maxClock);
  };
  [stamps, undeleted, ...previousClocks].forEach(maxClock);
  const namespaces: Record<string, string> = {
    "run-calc-brands": "brands", "run-calc-ingredient-types": "ingredientTypes", "run-calc-pep-types": "pepTypes",
    "run-calc-die-types": "dieTypes", "run-calc-dough-ingredients": "doughIngredients", "run-calc-dough-recipe-names": "doughRecipeNames",
    "run-calc-frontline-ingredients": "frontlineIngredients", "run-calc-frontline-recipe-names": "frontlineRecipeNames",
    "run-calc-cheese-ingredients": "cheeseIngredients", "run-calc-cheese-recipe-names": "cheeseRecipeNames",
    "run-calc-mix-ingredients": "mixIngredients", "run-calc-mix-recipe-names": "mixRecipeNames",
  };
  let changed = false;
  const inverse = (namespace: string, before: unknown, after: unknown) => {
    const oldNames = Array.isArray(before) ? before.filter((name): name is string => typeof name === "string") : [];
    const newNames = Array.isArray(after) ? after.filter((name): name is string => typeof name === "string") : [];
    const oldKeys = new Set(oldNames.map((name) => name.trim().toLowerCase())), newKeys = new Set(newNames.map((name) => name.trim().toLowerCase()));
    for (const name of new Set([...oldKeys, ...newKeys])) {
      if (oldKeys.has(name) === newKeys.has(name)) continue;
      changed = true;
      const entries = Array.isArray(deleted[namespace]) ? deleted[namespace].filter((value: unknown) => typeof value === "string") as string[] : [];
      const clocks = stamps[namespace] && typeof stamps[namespace] === "object" ? stamps[namespace] : {};
      const restores = undeleted[namespace] && typeof undeleted[namespace] === "object" ? undeleted[namespace] : {};
      deleted[namespace] = entries.filter((value) => value.trim().toLowerCase() !== name);
      if (oldKeys.has(name)) restores[name] = time;
      else { deleted[namespace].push(name); clocks[name] = time; }
      stamps[namespace] = clocks; undeleted[namespace] = restores;
    }
  };
  for (const fact of facts.filter((fact) => fact.entity === "directories")) {
    if (namespaces[fact.key]) inverse(namespaces[fact.key], fact.before?.value, fact.after?.value);
    if (fact.key === "run-calc-brand-flavors") {
      const before = fact.before?.value as Row ?? {}, after = fact.after?.value as Row ?? {};
      for (const brand of new Set([...Object.keys(before), ...Object.keys(after)])) inverse(`flavors:${brand}`, before[brand], after[brand]);
    }
  }
  // A canonical pool name need not have existed in the old compatibility
  // directory. Its original row is still proof that Undo restores that name.
  const poolNamespaces: Partial<Record<MasterDataEntity, string>> = {
    doughRecipes: "doughRecipeNames", sauceRecipes: "frontlineRecipeNames", cheeseRecipes: "cheeseRecipeNames",
    mixes: "mixRecipeNames", dies: "dieTypes",
  };
  for (const fact of facts) {
    const namespace = poolNamespaces[fact.entity];
    if (!namespace) continue;
    const before = fact.before && fact.before.enabled !== false ? [fact.before.name] : [];
    const after = fact.after && fact.after.enabled !== false ? [fact.after.name] : [];
    inverse(namespace, before, after);
  }
  const ingredientNamespaces: Record<string, string> = { general: "ingredientTypes", pep: "pepTypes", dough: "doughIngredients",
    frontline: "frontlineIngredients", cheese: "cheeseIngredients", mix: "mixIngredients" };
  for (const fact of facts.filter((entry) => entry.entity === "ingredients")) {
    for (const [category, namespace] of Object.entries(ingredientNamespaces)) {
      const before = fact.before?.enabled && Array.isArray(fact.before.categories) && fact.before.categories.includes(category) ? [fact.before.name] : [];
      const after = fact.after?.enabled && Array.isArray(fact.after.categories) && fact.after.categories.includes(category) ? [fact.after.name] : [];
      inverse(namespace, before, after);
    }
  }
  if (command.category === "brand" || command.category === "flavor") {
    const namespace = command.category === "brand" ? "brands" : `flavors:${command.brand}`;
    const field = command.category === "brand" ? "brand" : "flavor";
    for (const name of command.sources) if (facts.some((fact) => String(fact.before?.[field] ?? "").trim().toLowerCase() === name.trim().toLowerCase())) {
      inverse(namespace, [name], []);
    }
  }
  if (!changed) return;
  for (const [key, value] of [["run-calc-deleted-items", deleted], ["run-calc-deleted-stamps", stamps], ["run-calc-undeleted-stamps", undeleted]] as const) {
    const updatedAt = new Date();
    await tx.insert(factoryKvTable).values({ scope, key, value, updatedAt })
      .onConflictDoUpdate({ target: [factoryKvTable.scope, factoryKvTable.key], set: { value, updatedAt } });
  }
}
function factsBetween(before: MasterDataWorld, after: MasterDataWorld): MasterDataFact[] {
  const facts: MasterDataFact[] = [];
  for (const entity of entities) {
    const old = new Map(before[entity].map((row) => [keyFor(entity, row), row]));
    const next = new Map(after[entity].map((row) => [keyFor(entity, row), row]));
    for (const key of new Set([...old.keys(), ...next.keys()])) {
      const a = old.get(key) ?? null, b = next.get(key) ?? null;
      if (!equal(a, b)) facts.push({ entity, key, before: a, after: b });
    }
  }
  return facts;
}
function validateEvidence(facts: MasterDataFact[], references: MasterDataReferenceFact[]): void {
  if (facts.length > MAX_FACTS || references.length > MAX_REFERENCE_FACTS
    || Buffer.byteLength(JSON.stringify({ facts, references })) > MAX_EVIDENCE_BYTES) {
    throw new MasterDataPlanError("This action exceeds the bounded Undo evidence limit. No shared records were changed.");
  }
  for (const fact of facts) {
    if (!Object.hasOwn(configs, fact.entity) || typeof fact.key !== "string") throw new MasterDataPlanError("Unsupported retained operation evidence.");
    if (fact.entity === "directories" && !DIRECTORY_KEYS.includes(fact.key as typeof DIRECTORY_KEYS[number])) {
      throw new MasterDataPlanError("This factory key is not eligible Undo evidence.");
    }
  }
  for (const ref of references) {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(ref.date) || typeof ref.runId !== "string" || ref.runId.length > 200
      || typeof ref.beforeExists !== "boolean" || typeof ref.afterExists !== "boolean"
      || (ref.section === "meta" ? !["brand", "flavor"].includes(ref.field) : ref.section !== "values" || !referenceFields.includes(ref.field))) {
      throw new MasterDataPlanError("Only typed pending-run setup references can be restored.");
    }
  }
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { for (const child of value) visit(child); return; }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (/^(?:pin|supervisorpin|password|passwordhash|session|sessionid|sessiontoken|sessionsecret|staffsignupcode|signupcode|authtoken|accesstoken|refreshtoken|apikey|credentials|localstorage|outbox|operationaloutbox|recoveryqueue)$/u.test(key.replace(/[_-]/gu, "").toLowerCase())) {
        throw new MasterDataPlanError("This record contains unsupported recovery or security fields. No browser or security evidence can be recorded.");
      }
      visit(child);
    }
  };
  for (const fact of facts) for (const row of [fact.before, fact.after]) {
    if (!row) continue;
    if (fact.entity !== "directories") { visit(row); continue; }
    const { value, ...metadata } = row; visit(metadata);
    if (Array.isArray(value)) {
      if (!value.every((item) => typeof item === "string")) throw new MasterDataPlanError("Unsupported name-list evidence.");
    } else if (value && typeof value === "object") {
      if (/^run-calc-(?:dough|frontline|cheese|mix)-presets$/u.test(fact.key)) {
        for (const rows of Object.values(value)) {
          if (!Array.isArray(rows)) throw new MasterDataPlanError("Unsupported recipe-preset evidence.");
          visit(rows);
        }
      } else if (fact.key === "run-calc-brand-flavors") {
        if (!Object.values(value).every((names) => Array.isArray(names) && names.every((name) => typeof name === "string"))) {
          throw new MasterDataPlanError("Unsupported brand/flavor evidence.");
        }
      } else if (isFreshFenceDirectory(fact)) {
        for (const names of Object.values(value)) {
          if (fact.key === "run-calc-deleted-items" ? !Array.isArray(names) || !names.every((name) => typeof name === "string")
            : !names || typeof names !== "object" || Array.isArray(names) || !Object.values(names).every((clock) => Number.isSafeInteger(clock) && Number(clock) >= 0)) {
            throw new MasterDataPlanError("Unsupported canonical name-fence evidence.");
          }
        }
      } else throw new MasterDataPlanError("This directory has no typed Undo representation.");
    } else throw new MasterDataPlanError("Unsupported directory evidence.");
  }
  visit(references);
}
function dbValues(entity: MasterDataEntity, row: Row): Row {
  const columns = getTableColumns(configs[entity].table) as Record<string, { dataType: string }>;
  return Object.fromEntries(Object.entries(row).filter(([key, value]) => key in columns && value !== undefined)
    .map(([key, value]) => [key, columns[key]!.dataType === "date" && value !== null ? new Date(value as string) : value]));
}
async function writeFact(tx: MasterDataTransaction, scope: Scope, fact: MasterDataFact, undo: boolean): Promise<void> {
  const { table, key } = configs[fact.entity];
  const from = undo ? fact.after : fact.before, to = undo ? fact.before : fact.after;
  const predicate = and(eq(table.scope, scope), eq(table[key], from?.[key] ?? to?.[key]));
  if (to === null) {
    // A fresh recipe tombstone preserves its identity and revision. Other
    // identities are protected from recreation by the scoped write epoch.
    if (undo && table.enabled) {
      await tx.update(table).set({ enabled: false, ...(table.updatedAt ? { updatedAt: new Date() } : {}) }).where(predicate);
    } else if (undo && fact.entity === "templates") {
      await tx.update(table).set({ deleted: true, revision: sql`${table.revision} + 1`, updatedAt: new Date() }).where(predicate);
    } else await tx.delete(table).where(predicate);
    return;
  }
  const values = dbValues(fact.entity, to);
  delete values.scope;
  if (from === null) {
    // New serial identities are assigned only by PostgreSQL, never the client.
    if (to[key] === undefined) delete values[key];
    if (table.updatedAt) values.updatedAt = new Date();
    if (table.updatedAtMs) values.updatedAtMs = Math.max(stamp(), Number(to.updatedAtMs ?? 0) + 1);
    if (table.revision) values.revision = Math.max(1, Number(to.revision ?? 0) + 1);
    const insert = tx.insert(table);
    await (typeof values[key] === "number" ? insert.overridingSystemValue() : insert).values({ ...values, scope });
    return;
  }
  const patch: Row = {};
  for (const field of Object.keys(values)) {
    if (field !== key && !["createdAt", "updatedAt", "updatedAtMs", "revision"].includes(field) && !equal(from[field], to[field])) patch[field] = values[field];
  }
  // Never write accounting quantities, even if the operation's guards prove
  // their stored value did not change.
  if (["amountAlreadyMade", "amountActualMade"].some((field) => field in patch)) throw new MasterDataPlanError("Stock quantities cannot be changed by master-data Undo.");
  if (table.updatedAt) patch.updatedAt = new Date();
  if (table.updatedAtMs) patch.updatedAtMs = Math.max(stamp(), Number(from.updatedAtMs ?? 0) + 1);
  if (table.revision) patch.revision = sql`${table.revision} + 1`;
  if (Object.keys(patch).length) await tx.update(table).set(patch).where(predicate);
}
async function writeWorld(tx: MasterDataTransaction, scope: Scope, before: MasterDataWorld, after: MasterDataWorld): Promise<void> {
  const facts = factsBetween(before, after);
  validateEvidence(facts, []);
  // Release old active-name unique keys before promoting a merge survivor.
  for (const fact of facts) {
    if (fact.entity === "ingredients" && fact.before && (fact.after?.enabled === false || fact.after?.name !== fact.before.name)) {
      await tx.update(ingredientsTable).set({ enabled: false }).where(and(eq(ingredientsTable.scope, scope), eq(ingredientsTable.id, fact.key)));
    }
  }
  for (const fact of facts) {
    if (fact.entity === "ingredients" && fact.before && fact.after?.name !== fact.before.name && fact.after?.enabled !== false) {
      // The temporary disabled state is not evidence; the final state is.
      fact.before = { ...fact.before, enabled: false };
    }
    await writeFact(tx, scope, fact, false);
  }
}
async function applyReferenceFacts(tx: MasterDataTransaction, scope: Scope, days: Awaited<ReturnType<typeof readDays>>,
  references: MasterDataReferenceFact[], undo: boolean): Promise<void> {
  for (const day of days) {
    const edits = references.filter((fact) => fact.date === day.date);
    if (!edits.length) continue;
    const data = masterJsonClone(day.data) as Row;
    const now = stamp();
    for (const edit of edits) {
      const run = data.dayState?.runs?.find((item: Row) => item.id === edit.runId);
      if (!run || run.startedAt || run.endedAt) throw new MasterDataOperationConflict("An affected run has started, finished, or disappeared. Nothing was restored.");
      const container = edit.section === "meta" ? run : data.runValues?.[edit.runId];
      const expected = undo ? edit.after : edit.before, value = undo ? edit.before : edit.after;
      const exists = undo ? edit.afterExists : edit.beforeExists;
      if (!container || Object.hasOwn(container, edit.field) !== exists || !equal(container[edit.field] ?? null, expected)) throw new MasterDataOperationConflict();
      if (!(undo ? edit.beforeExists : edit.afterExists)) delete container[edit.field]; else container[edit.field] = value;
      if (edit.section === "meta") run.metaUpdatedAt = Math.max(now, Number(run.metaUpdatedAt ?? 0) + 1);
      else {
        data.runValuesUpdatedAt ??= {};
        data.runValuesUpdatedAt[edit.runId] = Math.max(now, Number(data.runValuesUpdatedAt[edit.runId] ?? 0) + 1);
      }
    }
    const [written] = await tx.update(dailySyncTable).set({ data, canonicalRevision: sql`${dailySyncTable.canonicalRevision} + 1`, updatedAt: new Date() })
      .where(and(eq(dailySyncTable.scope, scope), eq(dailySyncTable.date, day.date))).returning();
    if (!written) throw new MasterDataOperationConflict();
    await appendSyncOutboxEvent(tx, { kind: "day-state", scope, date: day.date, canonicalRevision: written.canonicalRevision, senderId: "" });
  }
}
async function protectedDependency(tx: MasterDataTransaction, scope: Scope, command: MasterDataCommand, world: MasterDataWorld, compensating = false): Promise<boolean> {
  if (command.action === "add" && !compensating && !world.ingredients.some((row) =>
    command.sources.some((name) => String(row.name).trim().toLowerCase() === name.trim().toLowerCase()))) return false;
  if (command.category === "mix" && world.mixes.some((row) =>
    [...command.sources, command.target].some((name) => name && String(row.name).trim().toLowerCase() === name.trim().toLowerCase())
    && (Number(row.amountAlreadyMade ?? 0) > 0 || Number(row.amountActualMade ?? 0) > 0))) return true;
  // Existing domain histories are never part of this ledger's before facts.
  for (const name of command.sources) {
    const [historical] = await tx.select({ id: completedRunHistoryTable.id }).from(completedRunHistoryTable)
      .where(and(eq(completedRunHistoryTable.scope, scope), sql`EXISTS (
        SELECT 1 FROM jsonb_path_query(${completedRunHistoryTable.snapshot}, '$.**') AS node(value)
        WHERE jsonb_typeof(node.value) = 'string' AND lower(node.value #>> '{}') = lower(${name})
      )`)).limit(1);
    if (historical) return true;
  }
  const ingredientAction = ["ingredient", "doughIngredient", "sauceIngredient", "cheeseIngredient", "mixIngredient", "applicator", "pep"].includes(command.category);
  const ids = ingredientAction ? world.ingredients.filter((row) => command.sources.some((name) => name.toLowerCase() === String(row.name).toLowerCase())).map((row) => row.id) : [];
  if (ids.length) {
    const [stock] = await tx.select({ id: inventoryItemsTable.id }).from(inventoryItemsTable)
      .where(and(eq(inventoryItemsTable.scope, scope), inArray(inventoryItemsTable.productionIngredientId, ids))).limit(1);
    if (stock) return true;
  }
  return false;
}
export async function previewMasterDataOperation(scope: Scope, id: string, command: MasterDataCommand) {
  return db.transaction(async (tx) => {
    await lockMasterDataScope(tx, scope); await lockTables(tx);
    await assertMasterDataOperationActor(tx, scope, false);
    const world = await readWorld(tx, scope), days = await readDays(tx, scope);
    const plan = buildMasterDataPlan(world, command, id);
    const references = planPendingReferences(days, plan);
    validateEvidence(scopedDirectoryEvidence(factsBetween(world, plan.after)), references.references);
    const protectedFacts = references.protectedDependency || await protectedDependency(tx, scope, command, world);
    return { expectedStateHash: guardHash(world, days), description: plan.description.slice(0, 1000), eligible: !protectedFacts,
      unavailableReason: protectedFacts ? "Started/finished production, immutable history, or inventory depends on these records. The change can be recorded but cannot be undone here." : null };
  });
}
export async function commitMasterDataOperation(scope: Scope, actorId: string, id: string, command: MasterDataCommand, expectedStateHash: string) {
  const requestHash = masterHash(command);
  return db.transaction(async (tx) => {
    const epoch = await lockMasterDataScope(tx, scope); await lockTables(tx);
    await assertMasterDataOperationActor(tx, scope, true);
    const [existing] = await tx.select().from(masterDataOperationsTable).where(and(eq(masterDataOperationsTable.scope, scope), eq(masterDataOperationsTable.id, id)));
    if (existing) {
      if (existing.requestHash !== requestHash || existing.actorId !== actorId) throw new MasterDataOperationConflict("This operation ID belongs to a different command or actor. No records were changed.");
      return existing;
    }
    const before = await readWorld(tx, scope), days = await readDays(tx, scope);
    if (guardHash(before, days) !== expectedStateHash) throw new MasterDataOperationConflict("Shared records changed while this action was being prepared. Refresh and confirm the current action.");
    const plan = buildMasterDataPlan(before, command, id);
    const pending = planPendingReferences(days, plan);
    const unavailable = pending.protectedDependency || await protectedDependency(tx, scope, command, before);
    validateEvidence(scopedDirectoryEvidence(factsBetween(before, plan.after)), pending.references);
    await writeWorld(tx, scope, before, plan.after);
    await applyReferenceFacts(tx, scope, days, pending.references, false);
    failureHook?.("after-mutations");
    const after = await readWorld(tx, scope), afterDays = await readDays(tx, scope);
    const facts = scopedDirectoryEvidence(factsBetween(before, after));
    validateEvidence(facts, pending.references);
    if (!facts.length && !pending.references.length) throw new MasterDataPlanError("This action makes no canonical change. No Undo receipt was created.");
    const [record] = await tx.insert(masterDataOperationsTable).values({
      id, scope, actorId, requestHash, command, description: plan.description.slice(0, 1000),
      status: unavailable ? "unavailable" : "applied",
      unavailableReason: unavailable ? "Protected production, immutable history, or inventory references prevent compensation." : null,
      facts, references: pending.references, resultHash: masterHash({ facts, references: pending.references }),
      guardHash: affectedGuard(after, afterDays, facts, pending.references, command),
    }).returning();
    if (!record) throw new Error("Undo evidence was not recorded.");
    failureHook?.("after-evidence");
    await tx.insert(masterDataUndoEpochsTable).values({ scope, epoch: epoch + 1 })
      .onConflictDoUpdate({ target: masterDataUndoEpochsTable.scope, set: { epoch: epoch + 1 } });
    for (const family of ["master-data", "profiles", "factory-data", "die-types"] as const) await appendSyncOutboxEvent(tx, { kind: "configuration", scope, senderId: "", family });
    return record;
  });
}

export async function undoMasterDataOperation(scope: Scope, actorId: string, id: string) {
  return db.transaction(async (tx) => {
    const epoch = await lockMasterDataScope(tx, scope); await lockTables(tx);
    await assertMasterDataOperationActor(tx, scope, true);
    const [record] = await tx.select().from(masterDataOperationsTable)
      .where(and(eq(masterDataOperationsTable.scope, scope), eq(masterDataOperationsTable.id, id))).for("update");
    if (!record) throw new MasterDataOperationConflict("This operation is unavailable in the current scope.");
    if (record.status === "undone") return { record, conflict: false };
    if (record.status !== "applied") throw new MasterDataOperationConflict(record.unavailableReason ?? "This operation is not eligible for Undo.");
    const world = await readWorld(tx, scope), days = await readDays(tx, scope);
    validateEvidence(record.facts, record.references);
    const command = record.command as MasterDataCommand;
    const dependencyNames = { ...command, sources: [...new Set([...command.sources, ...(command.target ? [command.target] : [])])] };
    const evidenceMatches = masterHash({ facts: record.facts, references: record.references }) === record.resultHash;
    const conflict = !evidenceMatches || affectedGuard(world, days, record.facts, record.references, command) !== record.guardHash
      || await protectedDependency(tx, scope, dependencyNames, world, true);
    if (conflict) {
      const [updated] = await tx.update(masterDataOperationsTable).set({ conflictCount: record.conflictCount + 1, lastConflictAt: new Date(),
        lastConflictBy: actorId, lastConflictReason: evidenceMatches ? "canonical-dependency-changed" : "retained-evidence-changed" })
        .where(eq(masterDataOperationsTable.sequence, record.sequence)).returning();
      return { record: updated!, conflict: true };
    }
    // Recheck the evidence shape and size before trusting stored facts. No
    // client-supplied row or pointer is accepted by this path.
    validateEvidence(record.facts, record.references);
    for (const fact of [...record.facts].reverse()) {
      if (!configs[fact.entity]) throw new MasterDataPlanError("Unsupported retained operation evidence.");
      const current = world[fact.entity].find((row) => keyFor(fact.entity, row) === fact.key) ?? null;
      if (fact.entity === "directories" ? !equal(directoryFactFingerprint(fact, current), directoryFactFingerprint(fact, fact.after))
        : !equal(current, fact.after)) throw new MasterDataOperationConflict();
    }
    // Disable ingredient name keys before restoring formerly merged sources.
    for (const fact of record.facts) if (fact.entity === "ingredients" && fact.after) {
      await tx.update(ingredientsTable).set({ enabled: false }).where(and(eq(ingredientsTable.scope, scope), eq(ingredientsTable.id, fact.key)));
    }
    for (const fact of [...record.facts].reverse()) {
      if (isFreshFenceDirectory(fact)) continue;
      if (fact.entity === "directories") {
        const current = world.directories.find((row) => row.key === fact.key) ?? null;
        const value = restoreDirectoryFactValue(fact, current);
        await tx.insert(factoryKvTable).values({ scope, key: fact.key, value, updatedAt: new Date() })
          .onConflictDoUpdate({ target: [factoryKvTable.scope, factoryKvTable.key], set: { value, updatedAt: new Date() } });
      } else await writeFact(tx, scope,
        fact.entity === "ingredients" && fact.after ? { ...fact, after: { ...fact.after, enabled: false } } : fact, true);
    }
    await applyReferenceFacts(tx, scope, days, record.references, true);
    await publishInverseNameFences(tx, scope, record.facts, command);
    failureHook?.("after-compensation");
    await tx.insert(masterDataUndoEpochsTable).values({ scope, epoch: epoch + 1 })
      .onConflictDoUpdate({ target: masterDataUndoEpochsTable.scope, set: { epoch: epoch + 1 } });
    const [undone] = await tx.update(masterDataOperationsTable).set({ status: "undone", undoneAt: new Date(), undoneBy: actorId })
      .where(eq(masterDataOperationsTable.sequence, record.sequence)).returning();
    for (const family of ["master-data", "profiles", "factory-data", "die-types"] as const) await appendSyncOutboxEvent(tx, { kind: "configuration", scope, senderId: "", family });
    failureHook?.("after-undo-evidence");
    return { record: undone!, conflict: false };
  });
}
