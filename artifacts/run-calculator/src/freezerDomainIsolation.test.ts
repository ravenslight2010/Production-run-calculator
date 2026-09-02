import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UseFormReturn } from "react-hook-form";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  saveFreezerPullItems,
  type FreezerPullItem,
} from "./freezerPull";
import {
  confirmFreezerSurplus,
  replaceFreezerSurplusAllocation,
  type FreezerSurplusLedger,
} from "./freezerSurplus";
import { computeLinePhases } from "./linePhases";
import {
  loadPackagingProgress,
  recordAutomaticPackagingProgress,
} from "./packagingProgress";
import { useAutoTrack } from "./hooks/useAutoTrack";
import type { FormValues } from "./types";

const ENDED_AT = Date.UTC(2026, 8, 1, 12, 0, 0);
const RUN_ID = "ended-run";
const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));

const phaseArgs = {
  elapsedBatchSec: 30 * 60,
  pausedAt: null,
  lastResumeWallMs: 0,
  lastPauseStartWallMs: 0,
  runStatus: "ended",
  preTunnelMin: 2.5,
  postTunnelMin: 2.5,
  freezerTime: 20,
  endedAt: ENDED_AT,
} as const;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function makeFakeForm(): {
  form: UseFormReturn<FormValues>;
  store: Record<string, number>;
} {
  const store: Record<string, number> = {
    skidsCompleted: 4,
    casesOnCurrentSkid: 40,
    traysOnLine: 5,
    batchesReady: 2,
  };
  return {
    store,
    form: {
      getValues: vi.fn((key: string) => store[key] ?? 0),
      setValue: vi.fn((key: string, value: number) => {
        store[key] = value;
      }),
    } as unknown as UseFormReturn<FormValues>,
  };
}

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(SRC_DIR, relativePath), "utf8");
}

function findFunctionSource(source: string, functionName: string): string {
  const sourceFile = ts.createSourceFile(
    "source.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let found = "";
  const visit = (node: ts.Node) => {
    if (
      ts.isFunctionDeclaration(node)
      && node.name?.text === functionName
    ) {
      found = node.getText(sourceFile);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!found) throw new Error(`Function ${functionName} was not found`);
  return found;
}

function findEffectSource(source: string, marker: string): string {
  const sourceFile = ts.createSourceFile(
    "source.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let found = "";
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node)
      && node.expression.getText(sourceFile) === "useEffect"
      && node.getText(sourceFile).includes(marker)
    ) {
      found = node.getText(sourceFile);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!found) throw new Error(`useEffect containing ${marker} was not found`);
  return found;
}

function expectNoReferences(
  source: string,
  forbidden: string[],
  boundaryName: string,
): void {
  const found = forbidden.filter((name) => new RegExp(`\\b${name}\\b`).test(source));
  expect(
    found,
    `${boundaryName} crossed the freeze-tunnel / warehouse-inventory boundary: ${found.join(", ")}`,
  ).toEqual([]);
}

describe("freeze tunnel and warehouse freezer domain isolation", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(ENDED_AT + 3 * 60_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ended-run tunnel drain updates packaging without touching freezer-pull items or surplus lots", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const earlyPhases = computeLinePhases({
      ...phaseArgs,
      nowMs: ENDED_AT + 3 * 60_000,
    });
    const latePhases = computeLinePhases({
      ...phaseArgs,
      nowMs: ENDED_AT + 19 * 60_000,
    });
    expect(earlyPhases.stage2.state).toBe("draining");
    expect(latePhases.stage3.state).toBe("draining");

    const { form, store } = makeFakeForm();
    type Props = Parameters<typeof useAutoTrack>[0];
    const props = (nowMs: number, casesInFreezer: number): Props => ({
      runId: RUN_ID,
      runStatus: "ended",
      endedAt: ENDED_AT,
      nowTime: new Date(nowMs),
      elapsedBatchSec: 30 * 60,
      calc: {
        ppm: 60,
        perTray: 200,
        perBatch: 1200,
        traysNeeded: 5,
        batchesNeeded: 2,
        pressDone: true,
        casesInFreezer,
      },
      v: {
        casesPerSkid: 100,
        pizzasPerCase: 10,
        casesNeeded: 500,
        freezerTime: 20,
        traysOnLine: store.traysOnLine,
        batchesReady: store.batchesReady,
      },
      form,
      onPackagingProgressAutoAdvance: (skidsCompleted, casesOnCurrentSkid) => (
        recordAutomaticPackagingProgress({
          runId: RUN_ID,
          skidsCompleted,
          casesOnCurrentSkid,
          now: nowMs,
        }) !== null
      ),
    });
    const initialNow = ENDED_AT + 3 * 60_000;
    const { rerender } = renderHook(
      (input: Props) => useAutoTrack(input),
      { initialProps: props(initialNow, 60) },
    );
    const nextNow = initialNow + 10_001;
    act(() => {
      vi.setSystemTime(nextNow);
      rerender(props(nextNow, 54));
    });

    expect(loadPackagingProgress()[RUN_ID]).toMatchObject({
      skidsCompleted: 4,
      casesOnCurrentSkid: 46,
    });
    expect(store.skidsCompleted * 100 + store.casesOnCurrentSkid).toBe(446);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("freezer-pull and surplus API actions do not write packaging progress", async () => {
    recordAutomaticPackagingProgress({
      runId: RUN_ID,
      skidsCompleted: 4,
      casesOnCurrentSkid: 86,
      now: ENDED_AT + 3 * 60_000,
    });
    const beforeProgress = structuredClone(loadPackagingProgress());

    const pullItems: FreezerPullItem[] = [
      { id: "pull-1", ingredient: "Frozen sausage", daysEarly: 3, enabled: true },
    ];
    const confirmedLedger: FreezerSurplusLedger = {
      lots: [{
        id: "lot-1",
        brand: "Acme",
        flavor: "Pepperoni",
        productionDate: "2026-09-01",
        totalCases: 20,
        remainingCases: 20,
      }],
      allocations: [],
    };
    const allocatedLedger: FreezerSurplusLedger = {
      lots: [{ ...confirmedLedger.lots[0], remainingCases: 8 }],
      allocations: [{
        id: "allocation-1",
        lotId: "lot-1",
        runId: "future-run",
        runDate: "2026-09-02",
        brand: "Acme",
        flavor: "Pepperoni",
        cases: 12,
      }],
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path === "/api/freezer-pull-items" && init?.method === "POST") {
        return jsonResponse({ items: pullItems });
      }
      if (path === "/api/freezer-surplus" && init?.method === "POST") {
        return jsonResponse(confirmedLedger);
      }
      if (
        path === "/api/freezer-surplus/allocations/future-run"
        && init?.method === "PUT"
      ) {
        return jsonResponse(allocatedLedger);
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${path}`);
    });

    await saveFreezerPullItems(pullItems);
    await confirmFreezerSurplus({
      brand: "Acme",
      flavor: "Pepperoni",
      productionDate: "2026-09-01",
      cases: 20,
    });
    await replaceFreezerSurplusAllocation({
      runId: "future-run",
      runDate: "2026-09-02",
      brand: "Acme",
      flavor: "Pepperoni",
      allocations: [{ lotId: "lot-1", cases: 12 }],
    });

    expect(fetchSpy.mock.calls.map(([input, init]) => [
      String(input),
      init?.method,
    ])).toEqual([
      ["/api/freezer-pull-items", "POST"],
      ["/api/freezer-surplus", "POST"],
      ["/api/freezer-surplus/allocations/future-run", "PUT"],
    ]);
    expect(loadPackagingProgress()).toEqual(beforeProgress);
  });

  it("keeps Home drain and freezer action handlers on opposite state boundaries", () => {
    const homeSource = readSource("pages/home.tsx");
    const drainEffect = findEffectSource(homeSource, "priorDrainFreezerRef");
    const updateDrainingRun = findFunctionSource(homeSource, "updateDrainingRunValues");
    const confirmSurplus = findFunctionSource(homeSource, "confirmRunSurplus");
    const replaceSurplus = findFunctionSource(homeSource, "replaceRunSurplus");

    const warehouseMutations = [
      "setFreezerSurplus",
      "confirmFreezerSurplus",
      "replaceFreezerSurplusAllocation",
      "saveFreezerPullItems",
      "deleteFreezerPullItems",
    ];
    const lineAndPackagingMutations = [
      "setDayState",
      "saveDayState",
      "saveRunValues",
      "updateDrainingRunValues",
      "recordAutomaticPackagingProgress",
      "recordManualPackagingProgress",
      "persistManualPackagingProgress",
      "markRunValuesUpdated",
    ];

    expectNoReferences(
      drainEffect,
      warehouseMutations,
      "prior-run tunnel drain effect",
    );
    expectNoReferences(
      updateDrainingRun,
      warehouseMutations,
      "draining-run packaging writer",
    );
    expectNoReferences(
      confirmSurplus,
      lineAndPackagingMutations,
      "surplus confirmation handler",
    );
    expectNoReferences(
      replaceSurplus,
      lineAndPackagingMutations,
      "surplus allocation handler",
    );
  });
});