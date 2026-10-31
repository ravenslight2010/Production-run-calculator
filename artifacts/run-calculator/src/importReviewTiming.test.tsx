import { StrictMode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ImportReviewTiming, startImportReviewTiming } from "./importReviewTiming";
import {
  clearPerformanceDiagnostics,
  getPerformanceDiagnostics,
  IMPORT_PERFORMANCE_BUDGETS,
} from "./performanceDiagnostics";

let now = 0;
let nextFrame = 0;
let frames: Map<number, FrameRequestCallback>;

function paint(at: number) {
  now = at;
  const callbacks = [...frames.values()];
  frames.clear();
  act(() => callbacks.forEach((callback) => callback(at)));
}

beforeEach(() => {
  now = 100;
  nextFrame = 0;
  frames = new Map();
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  clearPerformanceDiagnostics();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each(["spec", "premix", "cheese"] as const)("%s review opening", (kind) => {
  it.each([48, 2_000, 2_501])("records %i ms through the ready review frame", (elapsed) => {
    const prepared = { sourceNames: ["workbook.xlsx"], candidates: [] };
    const original = structuredClone(prepared);
    startImportReviewTiming(prepared, kind);
    // The review module can load after parsing; include that wait, not parse time.
    now = 130;
    const view = render(<ImportReviewTiming prepared={prepared} />);
    expect(getPerformanceDiagnostics()).toEqual([]);
    paint(100 + elapsed);
    expect(getPerformanceDiagnostics()).toEqual([{
      name: `import-${kind}-review-open`, durationMs: elapsed, kind: "render",
    }]);
    expect(IMPORT_PERFORMANCE_BUDGETS.reviewOpenMs).toBe(2_000);
    if (elapsed > 2_000) {
      expect(console.warn).toHaveBeenCalledWith(
        "[calculator-performance] render exceeded budget",
        { name: `import-${kind}-review-open`, durationMs: elapsed, budgetMs: 2_000 },
      );
    } else {
      expect(console.warn).not.toHaveBeenCalled();
    }
    expect(prepared).toEqual(original);
    view.rerender(<ImportReviewTiming prepared={prepared} />);
    paint(5_000);
    expect(getPerformanceDiagnostics()).toHaveLength(1);
  });

  it("includes deferred-module delay before the review mounts", () => {
    const prepared = {};
    startImportReviewTiming(prepared, kind);
    now = 2_550;
    render(<ImportReviewTiming prepared={prepared} />);
    paint(2_600);
    expect(getPerformanceDiagnostics()[0]?.durationMs).toBe(2_500);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("cancels unmounted or superseded reviews and measures only the current result", () => {
    const old = {};
    startImportReviewTiming(old, kind);
    const view = render(<ImportReviewTiming prepared={old} />);
    now = 200;
    const current = {};
    startImportReviewTiming(current, kind);
    view.rerender(<ImportReviewTiming prepared={current} />);
    paint(260);
    expect(getPerformanceDiagnostics()).toEqual([{
      name: `import-${kind}-review-open`, durationMs: 60, kind: "render",
    }]);
    const cancelled = {};
    startImportReviewTiming(cancelled, kind);
    view.rerender(<ImportReviewTiming prepared={cancelled} />);
    view.unmount();
    paint(3_000);
    expect(getPerformanceDiagnostics()).toHaveLength(1);
  });

  it("measures once with StrictMode and does not measure an untracked history reopen", () => {
    const prepared = {};
    startImportReviewTiming(prepared, kind);
    const view = render(<StrictMode><ImportReviewTiming prepared={prepared} /></StrictMode>);
    paint(164);
    view.unmount();
    render(<ImportReviewTiming prepared={prepared} />);
    paint(300);
    expect(getPerformanceDiagnostics()).toHaveLength(1);
    expect(getPerformanceDiagnostics()[0]?.durationMs).toBe(64);
    cleanup();
    render(<ImportReviewTiming prepared={{}} />);
    paint(4_000);
    expect(getPerformanceDiagnostics()).toHaveLength(1);
  });

  it("wires the marker only into the actual ready dialog branch", () => {
    const name = kind[0].toUpperCase() + kind.slice(1);
    const dialog = readFileSync(resolve(process.cwd(), `src/components/${name}ImportDialog.tsx`), "utf8");
    expect(dialog).toMatch(
      /\{!loading && !error && prepared && \(\s*<>\s*<ImportReviewTiming prepared=\{prepared\} \/>/,
    );
    const home = readFileSync(resolve(process.cwd(), "src/pages/home.tsx"), "utf8");
    expect(home).toContain(`startImportReviewTiming(prepared, "${kind}")`);
    expect(home).not.toContain(`recordPerformance("import-${kind}-review-open", 0`);
  });
});
