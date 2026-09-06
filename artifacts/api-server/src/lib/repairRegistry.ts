import { eq, inArray, sql } from "drizzle-orm";
import { dataHealsTable, db } from "@workspace/db";
import { logger } from "./logger";

/**
 * The small, database-facing boundary for code-shipped repairs.  Definitions
 * are data, not startup side effects: this makes their identity and ordering
 * reviewable before anything is allowed to mutate a database.
 */
export type RepairMode = "automatic" | "manager";
export type RepairExecutionMode = "runner-transactional" | "legacy-self-transactional";
export type RepairResultOwnership = "runner-marker" | "legacy-marker";
/**
 * Marker results are release evidence, not a telemetry transport.  A number of
 * the repairs which predate the registry recorded small grouped counters and
 * reviewed detail lists, so the runner must be able to own those exact marker
 * values when those repairs are migrated.  The recursive bounds below remain
 * the authority for both old and new results.
 */
export interface RepairResultObject {
  readonly [key: string]: RepairResultValue;
}
export type RepairResultValue =
  | number
  | boolean
  | string
  | null
  /** Optional object properties are represented as undefined by TS only;
   * recursive runtime validation still rejects undefined payload values. */
  | undefined
  | readonly RepairResultValue[]
  | RepairResultObject;
export type RepairResult = RepairResultObject;
export type RepairSafety = Readonly<{
  affectedScope: string;
  excludedScope: string;
  rollback: string;
  evidence: string;
}>;
export type RepairDefinition<Tx = unknown> = Readonly<{
  id: string;
  owner: string;
  dependencies: readonly string[];
  /** Human-reviewable predicate; mutation code must enforce the row-level form. */
  eligibility: string;
  mode: RepairMode;
  executionMode: RepairExecutionMode;
  /** Identifies who persists the marker result during the compatibility period. */
  resultOwnership: RepairResultOwnership;
  managerAllowed: boolean;
  safety: RepairSafety;
  execute: (tx: Tx) => Promise<RepairResult>;
  validateResult?: (result: RepairResult) => boolean;
}>;

export type RepairRunOutcome =
  | { id: string; status: "applied"; result: RepairResult }
  | { id: string; status: "skipped" };

export class RepairExecutionError extends Error {
  constructor(
    readonly repairId: string,
    readonly category: "definition" | "dependency" | "execution" | "result",
    cause?: unknown,
  ) {
    super(`Repair ${repairId} failed (${category})`);
    this.name = "RepairExecutionError";
    if (cause !== undefined) this.cause = cause;
  }
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
}

function validId(id: string) {
  return /^[a-z0-9][a-z0-9-]{2,159}$/u.test(id);
}

/** Historical marker results predate the flat runner contract. Preserve their
 * reviewed nested count/detail shapes while preventing unbounded telemetry. */
export function isBoundedLegacyResult(value: unknown): value is Record<string, unknown> {
  let nodes = 0;
  const visit = (item: unknown, depth: number): boolean => {
    if (++nodes > 500 || depth > 6) return false;
    if (item === null || typeof item === "boolean") return true;
    if (typeof item === "number") return Number.isFinite(item) && Math.abs(item) <= 1_000_000_000;
    if (typeof item === "string") return item.length <= 256;
    if (Array.isArray(item)) return item.length <= 100 && item.every((child) => visit(child, depth + 1));
    if (!item || typeof item !== "object") return false;
    const entries = Object.entries(item);
    return entries.length <= 64 && entries.every(([key, child]) =>
      key.length <= 64 && /^[a-zA-Z][a-zA-Z0-9_:-]*$/u.test(key) && visit(child, depth + 1));
  };
  return !!value && !Array.isArray(value) && visit(value, 0);
}

function bounded(result: RepairResult): boolean {
  return isBoundedLegacyResult(result);
}

export class RepairRegistry<Tx = unknown> {
  private readonly repairs: RepairDefinition<Tx>[] = [];

  register(definition: RepairDefinition<Tx>): this {
    if (!validId(definition.id) || !definition.owner.trim() || !definition.eligibility.trim() || !definition.safety.affectedScope.trim() ||
      !definition.safety.excludedScope.trim() || !definition.safety.rollback.trim() || !definition.safety.evidence.trim()) {
      throw new RepairExecutionError(definition.id || "unknown", "definition");
    }
    if (definition.mode === "automatic" && definition.managerAllowed) {
      throw new RepairExecutionError(definition.id, "definition");
    }
    if ((definition.executionMode === "runner-transactional") !== (definition.resultOwnership === "runner-marker")) {
      throw new RepairExecutionError(definition.id, "definition");
    }
    if (this.repairs.some((repair) => repair.id === definition.id)) {
      throw new RepairExecutionError(definition.id, "definition");
    }
    this.repairs.push(freeze({
      ...definition,
      dependencies: [...definition.dependencies],
      safety: { ...definition.safety },
    }));
    this.validateOrder();
    return this;
  }

  list(mode?: RepairMode): readonly RepairDefinition<Tx>[] {
    return this.repairs.filter((repair) => !mode || repair.mode === mode);
  }

  validateOrder(): void {
    const positions = new Map(this.repairs.map((repair, index) => [repair.id, index]));
    for (const [index, repair] of this.repairs.entries()) {
      for (const dependency of repair.dependencies) {
        const position = positions.get(dependency);
        if (position === undefined || position >= index) throw new RepairExecutionError(repair.id, "dependency");
      }
    }
  }
}

type Database = Pick<typeof db, "transaction" | "select">;
export type RepairTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function runLegacySelfTransactionalRepair(
  repair: RepairDefinition<RepairTransaction>,
  database: Database,
): Promise<RepairRunOutcome> {
  const prior = await database.select({ id: dataHealsTable.id, result: dataHealsTable.result })
    .from(dataHealsTable).where(eq(dataHealsTable.id, repair.id)).limit(1);
  if (prior[0]) return { id: repair.id, status: "skipped" };
  if (repair.dependencies.length) {
    const completed = await database.select({ id: dataHealsTable.id }).from(dataHealsTable)
      .where(inArray(dataHealsTable.id, [...repair.dependencies]));
    if (completed.length !== repair.dependencies.length) {
      throw new RepairExecutionError(repair.id, "dependency");
    }
  }
  try {
    await repair.execute(undefined as unknown as RepairTransaction);
    const after = await database.select({ result: dataHealsTable.result }).from(dataHealsTable)
      .where(eq(dataHealsTable.id, repair.id)).limit(1);
    if (!after[0]) throw new RepairExecutionError(repair.id, "result");
    const stored = after[0].result;
    const result = isBoundedLegacyResult(stored) ? stored as RepairResult : {};
    logger.info({
      repair: repair.id,
      owner: repair.owner,
      resultTelemetry: isBoundedLegacyResult(stored) ? "valid" : "omitted",
      safeCounts: {
        topLevelKeys: stored && typeof stored === "object" && !Array.isArray(stored)
          ? Math.min(Object.keys(stored).length, 64) : 0,
      },
    }, "Legacy data repair applied");
    return { id: repair.id, status: "applied", result };
  } catch (cause) {
    if (cause instanceof RepairExecutionError) throw cause;
    throw new RepairExecutionError(repair.id, "execution", cause);
  }
}

/** Runs one registered command.  Marker claim and marker result are deliberately
 * in the same transaction as mutations, so a failure rolls all three back. */
export async function runRegisteredRepair(
  repair: RepairDefinition<RepairTransaction>,
  database: Database = db,
): Promise<RepairRunOutcome> {
  if (repair.executionMode === "legacy-self-transactional") {
    return runLegacySelfTransactionalRepair(repair, database);
  }
  try {
    return await database.transaction(async (tx) => {
      // Serialize marker claims across app instances without holding a
      // process-local lock. hashtext is stable for the repair's immutable id.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${repair.id}))`);
      const claimed = await tx.insert(dataHealsTable).values({ id: repair.id })
        .onConflictDoNothing({ target: dataHealsTable.id }).returning({ id: dataHealsTable.id });
      if (claimed.length === 0) return { id: repair.id, status: "skipped" } as const;
      if (repair.dependencies.length) {
        const completed = await tx.select({ id: dataHealsTable.id }).from(dataHealsTable)
          .where(inArray(dataHealsTable.id, [...repair.dependencies]));
        if (completed.length !== repair.dependencies.length) {
          throw new RepairExecutionError(repair.id, "dependency");
        }
      }
      let result: RepairResult;
      try {
        result = await repair.execute(tx);
      } catch (error) {
        throw new RepairExecutionError(repair.id, "execution", error);
      }
      if (!bounded(result) || (repair.validateResult && !repair.validateResult(result))) {
        throw new RepairExecutionError(repair.id, "result");
      }
      await tx.update(dataHealsTable).set({ result }).where(eq(dataHealsTable.id, repair.id));
      logger.info({ repair: repair.id, owner: repair.owner, result }, "Data repair applied");
      return { id: repair.id, status: "applied", result } as const;
    });
  } catch (error) {
    if (error instanceof RepairExecutionError) throw error;
    throw new RepairExecutionError(repair.id, "execution", error);
  }
}

export async function runAutomaticRepairs(
  registry: RepairRegistry<RepairTransaction>,
  database: Database = db,
): Promise<RepairRunOutcome[]> {
  registry.validateOrder();
  const results: RepairRunOutcome[] = [];
  for (const repair of registry.list("automatic")) {
    results.push(await runRegisteredRepair(repair, database));
  }
  return results;
}

/** Manager endpoints must call this instead of accepting an arbitrary repair id. */
export async function runManagerRepair(
  registry: RepairRegistry<RepairTransaction>,
  id: string,
  database: Database = db,
): Promise<RepairRunOutcome> {
  const repair = registry.list("manager").find((candidate) => candidate.id === id);
  if (!repair || !repair.managerAllowed) throw new RepairExecutionError(id, "definition");
  return runRegisteredRepair(repair, database);
}