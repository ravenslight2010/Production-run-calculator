// @vitest-environment node
import { readFileSync } from "node:fs";
import ts from "@workspace/typescript-api-v6";
import { afterEach, describe, expect, it, vi } from "vitest";

// Execute the production handlers and queue, not a copied implementation.
// React's eventual ref effect is deliberately absent: an event must publish
// its new snapshot before schedulePush performs the synchronous no-op check.
const source = ts.createSourceFile(
  "home.tsx",
  readFileSync(new URL("./pages/home.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

// The source file is immutable for this test process. Cache compilation only,
// never bound functions: each scenario must keep its own refs, mocks and timers.
const compiledExpressions = new Map<string, string>();

function compileFunction(name: string): string {
  const cached = compiledExpressions.get(name);
  if (cached !== undefined) return cached;
  let implementation: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      implementation = node;
    }
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === name
      && node.initializer
      && ts.isCallExpression(node.initializer)
      && ts.isIdentifier(node.initializer.expression)
      && node.initializer.expression.text === "useEvent"
    ) {
      implementation = node.initializer.arguments[0];
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!implementation) throw new Error(`Missing production handler: ${name}`);
  const javascript = ts.transpileModule(implementation.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  // Compiler directives/module markers are statements, not part of the
  // function expression. Select the emitted implementation structurally.
  const emitted = ts.createSourceFile(
    "handler.js", javascript, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS,
  );
  const statement = emitted.statements.find((node) =>
    ts.isFunctionDeclaration(node)
    || (ts.isExpressionStatement(node) && ts.isArrowFunction(node.expression)),
  );
  if (!statement) throw new Error(`Missing emitted handler: ${name}`);
  const expression = ts.isExpressionStatement(statement)
    ? statement.expression.getText(emitted)
    : statement.getText(emitted);
  compiledExpressions.set(name, expression);
  return expression;
}

function loadFunction(name: string, bindings: Record<string, unknown>): Function {
  const expression = compileFunction(name);
  return new Function(...Object.keys(bindings), `return (${expression});`)(
    ...Object.values(bindings),
  );
}

function harness() {
  vi.useFakeTimers();
  const initial = {
    date: "2026-11-01",
    currentIndex: 0,
    runs: [
      { id: "run-a", brand: "Synthetic", casesDone: 0 },
      { id: "run-b", brand: "Peer", casesDone: 0 },
    ],
    stagedItems: { "run-b::Other__lbs": true } as Record<string, boolean>,
    substitutions: [] as unknown[],
    substitutionLog: [{ id: "prior", kind: "added" }],
    resetAt: 123,
  };
  const dayStateRef = { current: structuredClone(initial) };
  const setDayState = vi.fn();
  const saveDayState = vi.fn();
  const setActiveSubstitutions = vi.fn();
  const doFetch = vi.fn();
  const pending = vi.fn();
  const bindings: Record<string, unknown> = {
    dayStateRef,
    setDayState,
    saveDayState,
    setActiveSubstitutions,
    lastLocalEditRef: { current: 0 },
    screenMode: null,
    document: { hidden: false },
    foregroundPushPendingRef: { current: false },
    foregroundSyncBarrierRef: { current: false },
    operationalAdoptionInFlightRef: { current: 0 },
    isSyncApplyingRef: { current: false },
    syncApplyPushPendingRef: { current: false },
    formHandoffRef: { current: false },
    requestBaselinePush: () => true,
    // Payload construction is a separate boundary; preserve the complete day
    // here so the real queue compares and dispatches the selected snapshot.
    buildSyncPayload: (day: typeof initial) => structuredClone(day),
    pushAcknowledgedRef: { current: true },
    lastSyncSigRef: { current: JSON.stringify(initial) },
    pushTimerRef: { current: null },
    syncPushTimingRef: { current: null },
    syncPushTriggerRef: { current: "edit" },
    syncPushGenerationRef: { current: 1 },
    setSyncPendingCount: pending,
    recordSyncEvent: vi.fn(),
    SYNC_EDIT_DEBOUNCE_MS: 120,
    todayStr: () => initial.date,
    doFetch,
  };
  bindings.schedulePush = loadFunction("schedulePush", bindings);
  return {
    initial,
    dayStateRef,
    setDayState,
    saveDayState,
    setActiveSubstitutions,
    doFetch,
    pending,
    bindings,
    toggle: loadFunction("toggleStagedItem", bindings) as (
      runId: string, rowKey: string,
    ) => void,
    substitute: loadFunction("persistSubstitutions", bindings) as (
      substitutions: unknown[], log?: unknown[],
    ) => void,
  };
}

afterEach(() => vi.useRealTimers());

function orderHarness() {
  const h = harness();
  const toast = vi.fn();
  h.bindings.dayState = h.dayStateRef.current;
  h.bindings.toast = toast;
  h.bindings.operationalRevisionScopeRef = { current: "live:fixture:2026-11-01:123" };
  return {
    ...h,
    toast,
    move: loadFunction("moveRun", h.bindings) as (from: number, to: number) => void,
    suggest: loadFunction("applyScheduleOrder", h.bindings) as (
      ids: string[],
    ) => { ok: boolean; message: string; undo?: () => void },
  };
}

function acknowledgeSuggestedOrder(h: ReturnType<typeof orderHarness>) {
  const result = h.suggest(["run-b", "run-a"]);
  if (!result.undo) throw new Error("Expected an order Undo");
  // Adopt the rendered state explicitly to isolate Undo from the forward
  // producer's separate synchronous-reference regression.
  h.dayStateRef.current = h.setDayState.mock.lastCall?.[0];
  vi.runAllTimers();
  (h.bindings.lastSyncSigRef as { current: string }).current =
    JSON.stringify(h.dayStateRef.current);
  h.doFetch.mockClear();
  h.setDayState.mockClear();
  h.saveDayState.mockClear();
  return result.undo;
}

describe("Home day-overlay edits reach the real sync queue before React effects", () => {
  it("dispatches a Warehouse edit even when the previous snapshot was acknowledged", () => {
    const h = harness();
    h.toggle("run-a", "Material__lbs");
    vi.runAllTimers();
    expect(h.doFetch).toHaveBeenCalledTimes(1);
    expect(h.doFetch.mock.calls[0][0].stagedItems).toEqual({
      "run-b::Other__lbs": true,
      "run-a::Material__lbs": true,
    });
    expect(h.pending).toHaveBeenCalledWith(1);
    expect(h.saveDayState).toHaveBeenCalledWith(h.dayStateRef.current);
    expect(h.dayStateRef.current.runs).toEqual(h.initial.runs);
    expect(h.initial.stagedItems).toEqual({ "run-b::Other__lbs": true });
  });

  it("preserves two rapid row checks in one queued snapshot", () => {
    const h = harness();
    h.toggle("run-a", "First__lbs");
    h.toggle("run-a", "Second__cases");
    vi.runAllTimers();
    expect(h.doFetch).toHaveBeenCalledTimes(1);
    expect(h.doFetch.mock.calls[0][0].stagedItems).toEqual({
      "run-b::Other__lbs": true,
      "run-a::First__lbs": true,
      "run-a::Second__cases": true,
    });
  });

describe("Run-order edits and order-only Undo use the current snapshot", () => {
  it("manual ordering retains the latest rows and selected run before React catches up", () => {
    const h = orderHarness();
    const latest = structuredClone(h.dayStateRef.current);
    latest.runs[0].brand = "Latest";
    latest.runs[0].casesDone = 4;
    latest.currentIndex = 1;
    h.dayStateRef.current = latest;
    h.move(0, 1);
    vi.runAllTimers();
    expect(h.dayStateRef.current.runs[1]).toMatchObject({
      id: "run-a", brand: "Latest", casesDone: 4,
    });
    expect(h.dayStateRef.current.currentIndex).toBe(0);
    expect(h.doFetch.mock.calls[0][0]).toEqual(h.dayStateRef.current);
  });

  it("suggested ordering retains a new run and later fields instead of restoring rendered rows", () => {
    const h = orderHarness();
    const latest = structuredClone(h.dayStateRef.current);
    latest.runs[0].casesDone = 4;
    latest.runs.push({ id: "run-c", brand: "New", casesDone: 2 });
    latest.currentIndex = 2;
    h.dayStateRef.current = latest;
    const result = h.suggest(["run-b", "run-a"]);
    vi.runAllTimers();
    expect(h.dayStateRef.current.runs.map((run) => run.id))
      .toEqual(["run-b", "run-a", "run-c"]);
    expect(h.dayStateRef.current.runs[1].casesDone).toBe(4);
    expect(h.dayStateRef.current.currentIndex).toBe(2);
    result.undo?.();
    vi.runAllTimers();
    expect(h.dayStateRef.current.runs.map((run) => run.id))
      .toEqual(["run-a", "run-b", "run-c"]);
    expect(h.dayStateRef.current.runs[0].casesDone).toBe(4);
    expect(h.dayStateRef.current.currentIndex).toBe(2);
  });

  it("refuses stale positional moves rather than moving a different run", () => {
    const h = orderHarness();
    const latest = structuredClone(h.dayStateRef.current);
    latest.runs.reverse();
    h.dayStateRef.current = latest;
    h.move(0, 1);
    vi.runAllTimers();
    expect(h.dayStateRef.current).toEqual(latest);
    expect(h.setDayState).not.toHaveBeenCalled();
    expect(h.saveDayState).not.toHaveBeenCalled();
    expect(h.doFetch).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledTimes(1);
  });

  it.each(["date", "reset"] as const)(
    "forward ordering cannot restore an older %s boundary",
    (boundary) => {
      const h = orderHarness();
      const latest = structuredClone(h.dayStateRef.current);
      if (boundary === "date") latest.date = "2026-11-02";
      if (boundary === "reset") latest.resetAt = 456;
      h.dayStateRef.current = latest;
      h.move(0, 1);
      expect(h.suggest(["run-b", "run-a"]).ok).toBe(false);
      vi.runAllTimers();
      expect(h.dayStateRef.current).toEqual(latest);
      expect(h.saveDayState).not.toHaveBeenCalled();
      expect(h.doFetch).not.toHaveBeenCalled();
    },
  );

  it("dispatches a manual move while preserving the selected run", () => {
    const h = orderHarness();
    h.move(0, 1);
    vi.runAllTimers();
    expect(h.doFetch).toHaveBeenCalledTimes(1);
    expect(h.doFetch.mock.calls[0][0].runs.map((run: { id: string }) => run.id))
      .toEqual(["run-b", "run-a"]);
    expect(h.dayStateRef.current.currentIndex).toBe(1);
    expect(h.dayStateRef.current.runs[1].id).toBe("run-a");
    expect(h.initial.runs.map((run) => run.id)).toEqual(["run-a", "run-b"]);
  });

  it("dispatches a suggested order without relying on a later render or edit", () => {
    const h = orderHarness();
    expect(h.suggest(["run-b", "run-a"]).ok).toBe(true);
    vi.runAllTimers();
    expect(h.doFetch).toHaveBeenCalledTimes(1);
    expect(h.dayStateRef.current.runs.map((run) => run.id))
      .toEqual(["run-b", "run-a"]);
    expect(h.dayStateRef.current.currentIndex).toBe(1);
  });

  it("dispatches Undo after the suggested order was acknowledged", () => {
    const h = orderHarness();
    const undo = acknowledgeSuggestedOrder(h);
    undo();
    vi.runAllTimers();
    expect(h.doFetch).toHaveBeenCalledTimes(1);
    expect(h.doFetch.mock.calls[0][0].runs.map((run: { id: string }) => run.id))
      .toEqual(["run-a", "run-b"]);
    expect(h.dayStateRef.current.currentIndex).toBe(0);
    expect(h.toast).not.toHaveBeenCalled();
  });

  it("Undo changes order only, retaining later values and the currently selected run", () => {
    const h = orderHarness();
    const undo = acknowledgeSuggestedOrder(h);
    h.dayStateRef.current.runs[0] = {
      ...h.dayStateRef.current.runs[0], casesDone: 7, brand: "Updated",
    };
    h.dayStateRef.current.currentIndex = 0; // The operator now selected run-b.
    undo();
    vi.runAllTimers();
    const restored = h.dayStateRef.current;
    expect(restored.runs.map((run) => run.id)).toEqual(["run-a", "run-b"]);
    expect(restored.runs[1]).toMatchObject({
      id: "run-b", casesDone: 7, brand: "Updated",
    });
    expect(restored.currentIndex).toBe(1);
    expect(restored.resetAt).toBe(h.initial.resetAt);
    expect(h.doFetch.mock.calls[0][0]).toEqual(restored);
  });

  it.each(["added", "removed", "replaced", "renamed"] as const)(
    "refuses Undo after a run was %s, without partially saving",
    (change) => {
      const h = orderHarness();
      const undo = acknowledgeSuggestedOrder(h);
      const third = { id: "run-c", brand: "New", casesDone: 0 };
      if (change === "added") h.dayStateRef.current.runs.push(third);
      if (change === "removed") h.dayStateRef.current.runs.splice(0, 1);
      if (change === "replaced") h.dayStateRef.current.runs[0] = third;
      if (change === "renamed") h.dayStateRef.current.runs[0].id = third.id;
      h.dayStateRef.current.currentIndex = 0;
      const latest = structuredClone(h.dayStateRef.current);
      undo();
      vi.runAllTimers();
      expect(h.dayStateRef.current).toEqual(latest);
      expect(h.setDayState).not.toHaveBeenCalled();
      expect(h.saveDayState).not.toHaveBeenCalled();
      expect(h.doFetch).not.toHaveBeenCalled();
      expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({
        title: "Run order changed",
      }));
    },
  );

  it("refuses Undo after another reorder instead of overwriting newer work", () => {
    const h = orderHarness();
    const undo = acknowledgeSuggestedOrder(h);
    h.dayStateRef.current.runs.reverse();
    h.dayStateRef.current.currentIndex = 0;
    const latest = structuredClone(h.dayStateRef.current);
    undo();
    vi.runAllTimers();
    expect(h.dayStateRef.current).toEqual(latest);
    expect(h.saveDayState).not.toHaveBeenCalled();
    expect(h.doFetch).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledTimes(1);
  });

  it("does not publish an unchanged suggested order or an out-of-bounds move", () => {
    const h = orderHarness();
    expect(h.suggest(["run-a", "run-b"]).undo).toBeUndefined();
    h.move(0, -1);
    h.move(0, 2);
    vi.runAllTimers();
    expect(h.setDayState).not.toHaveBeenCalled();
    expect(h.doFetch).not.toHaveBeenCalled();
  });

  it.each(["date", "reset", "scope"] as const)(
    "refuses an old order Undo after the %s boundary changes",
    (boundary) => {
      const h = orderHarness();
      const undo = acknowledgeSuggestedOrder(h);
      if (boundary === "date") h.dayStateRef.current.date = "2026-11-02";
      if (boundary === "reset") h.dayStateRef.current.resetAt = 456;
      if (boundary === "scope") {
        (h.bindings.operationalRevisionScopeRef as { current: string }).current =
          "sandbox:different-fixture:2026-11-01:123";
      }
      const latest = structuredClone(h.dayStateRef.current);
      undo();
      vi.runAllTimers();
      expect(h.dayStateRef.current).toEqual(latest);
      expect(h.setDayState).not.toHaveBeenCalled();
      expect(h.saveDayState).not.toHaveBeenCalled();
      expect(h.doFetch).not.toHaveBeenCalled();
      expect(h.toast).toHaveBeenCalledTimes(1);
    },
  );
});

  it("a rapid local check/uncheck cancels a genuine net-zero change", () => {
    const h = harness();
    h.toggle("run-a", "Material__lbs");
    h.toggle("run-a", "Material__lbs");
    vi.runAllTimers();
    expect(h.setDayState.mock.lastCall?.[0].stagedItems).toEqual(h.initial.stagedItems);
    expect(h.dayStateRef.current.stagedItems).toEqual(h.initial.stagedItems);
    expect(h.doFetch).not.toHaveBeenCalled();
    // This proves local queue behavior, not server-side union/uncheck policy.
  });

  it("dispatches a substitution and its activity evidence without another edit", () => {
    const h = harness();
    const substitutions = [{ id: "swap-one", runId: "run-a" }];
    h.substitute(substitutions, [{ id: "new", kind: "added" }]);
    vi.runAllTimers();
    expect(h.doFetch).toHaveBeenCalledTimes(1);
    expect(h.doFetch.mock.calls[0][0].substitutions).toEqual(substitutions);
    expect(h.doFetch.mock.calls[0][0].substitutionLog).toEqual([
      { id: "prior", kind: "added" },
      { id: "new", kind: "added" },
    ]);
    expect(h.setActiveSubstitutions).toHaveBeenCalledWith(substitutions);
    expect(h.dayStateRef.current.resetAt).toBe(h.initial.resetAt);
    expect(h.initial.substitutionLog).toEqual([{ id: "prior", kind: "added" }]);
  });

  it("rapid substitution writes retain both activity entries and the latest choice", () => {
    const h = harness();
    h.substitute([{ id: "first" }], [{ id: "entry-one", kind: "added" }]);
    h.substitute([{ id: "second" }], [{ id: "entry-two", kind: "changed" }]);
    vi.runAllTimers();
    expect(h.doFetch).toHaveBeenCalledTimes(1);
    expect(h.doFetch.mock.calls[0][0].substitutions).toEqual([{ id: "second" }]);
    expect(h.doFetch.mock.calls[0][0].substitutionLog.map((entry: { id: string }) => entry.id))
      .toEqual(["prior", "entry-one", "entry-two"]);
  });

  it("dispatches the prep handoff effect before React adopts its new phase", () => {
    const h = harness();
    h.bindings.useLiveRun = () => ({ nextRunPrepActive: true });
    h.bindings.useHomeTabCtx = () => ({
      ...h.bindings,
      currentRunId: "run-a",
      dayState: h.dayStateRef.current,
    });
    h.bindings.useEffect = (effect: () => void) => effect();
    loadFunction("LiveRunHandoffGuard", h.bindings)();
    vi.runAllTimers();
    expect(h.doFetch).toHaveBeenCalledTimes(1);
    expect(h.doFetch.mock.calls[0][0].prepPhase).toMatchObject({
      prepHandoffFromRunId: "run-a",
      prepBatchesDough: 0,
      prepBatchesSauce: 0,
      prepCarriedOver: false,
    });
    expect(h.saveDayState).toHaveBeenCalledWith(
      h.dayStateRef.current, { stampMeta: false },
    );
    expect(h.dayStateRef.current.runs).toEqual(h.initial.runs);
  });

  it.each(["hidden", "foreground", "adopting"] as const)(
    "retains an edit behind the %s fence without publishing",
    (fence) => {
      const h = harness();
      if (fence === "hidden") {
        (h.bindings.document as { hidden: boolean }).hidden = true;
      } else if (fence === "foreground") {
        (h.bindings.foregroundSyncBarrierRef as { current: boolean }).current = true;
      } else {
        (h.bindings.operationalAdoptionInFlightRef as { current: number }).current = 1;
      }
      h.toggle("run-a", "Material__lbs");
      vi.runAllTimers();
      expect(h.dayStateRef.current.stagedItems["run-a::Material__lbs"]).toBe(true);
      expect(h.bindings.foregroundPushPendingRef).toEqual({ current: true });
      expect(h.doFetch).not.toHaveBeenCalled();
    },
  );
});
