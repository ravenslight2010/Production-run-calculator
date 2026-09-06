import { describe, expect, it } from "vitest";
import {
  isBoundedLegacyResult, RepairExecutionError, RepairRegistry,
  runAutomaticRepairs, runManagerRepair, runRegisteredRepair,
} from "./repairRegistry";

const safety = {
  affectedScope: "reviewed rows", excludedScope: "all other rows",
  rollback: "review marker evidence", evidence: "reviewed source",
};
const repair = (id: string, dependencies: string[] = [], mode: "automatic" | "manager" = "automatic") => ({
  id, owner: "data-owner", dependencies, eligibility: "exact reviewed predicate",
  mode, managerAllowed: mode === "manager", safety, execute: async () => ({ scanned: 0, updated: 0 }),
  executionMode: "runner-transactional" as const,
  resultOwnership: "runner-marker" as const,
});

describe("RepairRegistry", () => {
  it("keeps registrations immutable and validates dependency order", () => {
    const registry = new RepairRegistry();
    registry.register(repair("first-repair-v1")).register(repair("second-repair-v1", ["first-repair-v1"]));
    expect(Object.isFrozen(registry.list()[0])).toBe(true);
    expect(Object.isFrozen(registry.list()[0].dependencies)).toBe(true);
    expect(() => registry.register(repair("before-repair-v1", ["later-repair-v1"])))
      .toThrow(RepairExecutionError);
  });

  it("rejects duplicate ids and automatic manager exposure", () => {
    const registry = new RepairRegistry();
    registry.register(repair("unique-repair-v1"));
    expect(() => registry.register(repair("unique-repair-v1"))).toThrow(RepairExecutionError);
    expect(() => registry.register({ ...repair("unsafe-repair-v1"), managerAllowed: true })).toThrow(RepairExecutionError);
  });

  it("does not expose automatic commands to manager dispatch", async () => {
    const registry = new RepairRegistry();
    registry.register(repair("automatic-only-v1"));
    await expect(runManagerRepair(registry as any, "automatic-only-v1", memoryDatabase().database as any))
      .rejects.toMatchObject({ repairId: "automatic-only-v1", category: "definition" });
  });
});

function memoryDatabase() {
  let marker: { id: string; result?: unknown } | undefined;
  const database = {
    transaction: async (work: (tx: any) => Promise<unknown>) => {
      const before = marker && { ...marker };
      const tx = {
        execute: async () => undefined,
        insert: () => ({
          values: ({ id }: { id: string }) => ({
            onConflictDoNothing: () => ({
              returning: async () => marker ? [] : (marker = { id }, [{ id }]),
            }),
          }),
        }),
        update: () => ({
          set: ({ result }: { result: unknown }) => ({
            where: async () => { if (marker) marker.result = result; },
          }),
        }),
        select: () => ({ from: () => ({ where: async () => [] }) }),
      };
      try { return await work(tx); } catch (error) { marker = before; throw error; }
    },
  };
  return { database, marker: () => marker };
}

describe("registered repair runner", () => {
  it("claims exactly once and bounds persisted telemetry", async () => {
    const memory = memoryDatabase();
    let executions = 0;
    const definition = repair("runner-once-v1");
    (definition as any).execute = async () => { executions++; return { scanned: 1, updated: 1 }; };
    expect((await runRegisteredRepair(definition as any, memory.database as any)).status).toBe("applied");
    expect((await runRegisteredRepair(definition as any, memory.database as any)).status).toBe("skipped");
    expect(executions).toBe(1);
    expect(memory.marker()?.result).toEqual({ scanned: 1, updated: 1 });
  });

  it("rolls back marker when execution or result validation fails", async () => {
    const memory = memoryDatabase();
    const failing = repair("runner-failure-v1");
    (failing as any).execute = async () => { throw new Error("boom"); };
    await expect(runRegisteredRepair(failing as any, memory.database as any)).rejects.toMatchObject({
      repairId: "runner-failure-v1", category: "execution",
    });
    expect(memory.marker()).toBeUndefined();
    const tooLarge = repair("runner-bounds-v1");
    (tooLarge as any).execute = async () => ({ detail: "x".repeat(257) });
    await expect(runRegisteredRepair(tooLarge as any, memory.database as any)).rejects.toMatchObject({
      category: "result",
    });
    expect(memory.marker()).toBeUndefined();
  });
});

describe("legacy marker result bounds", () => {
  it("retains released nested detail results but rejects unbounded payloads", () => {
    expect(isBoundedLegacyResult({
      removedStubs: { dough: 1, sauce: 0, cheese: 2, mix: 0 },
      details: [{ profile: "bounded-id", fields: ["app1", "app2"] }],
    })).toBe(true);
    let excessive: unknown = "leaf";
    for (let i = 0; i < 7; i++) excessive = { nested: excessive };
    expect(isBoundedLegacyResult(excessive)).toBe(false);
    expect(isBoundedLegacyResult({ rows: Array.from({ length: 101 }, () => 1) })).toBe(false);
  });

  const legacyDefinition = (execute: () => Promise<Record<string, unknown> | null | undefined>) => {
    let marker: { id: string; result: unknown } | undefined;
    const definition = {
      ...repair("legacy-result-v1"),
      executionMode: "legacy-self-transactional" as const,
      resultOwnership: "legacy-marker" as const,
      execute: async () => {
        const result = await execute();
        if (result !== undefined) marker = { id: "legacy-result-v1", result };
        return {};
      },
    };
    const database = {
      transaction: async () => { throw new Error("legacy must not use outer transaction"); },
      select: () => ({
        from: () => ({
          where: () => {
            const rows = marker ? [marker] : [];
            return Object.assign(Promise.resolve(rows), { limit: async () => rows });
          },
        }),
      }),
    };
    return { definition, database };
  };

  it("does not degrade after committed null or oversized historical telemetry", async () => {
    for (const result of [
      null,
      { details: Array.from({ length: 101 }, (_, index) => ({ index })) },
    ]) {
      const legacy = legacyDefinition(async () => result);
      const registry = new RepairRegistry<any>().register(legacy.definition as any);
      await expect(runAutomaticRepairs(registry, legacy.database as any)).resolves.toEqual([
        { id: "legacy-result-v1", status: "applied", result: {} },
      ]);
    }
  });

  it("still fails when a legacy implementation returns without a marker", async () => {
    const legacy = legacyDefinition(async () => undefined);
    const registry = new RepairRegistry<any>().register(legacy.definition as any);
    await expect(runAutomaticRepairs(registry, legacy.database as any)).rejects.toMatchObject({
      repairId: "legacy-result-v1", category: "result",
    });
  });
});