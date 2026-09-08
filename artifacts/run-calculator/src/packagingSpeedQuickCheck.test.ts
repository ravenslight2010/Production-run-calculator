import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createPackagingControlAdapter } from "./packagingManager";

const homeSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "pages/home.tsx"),
  "utf8",
);
const managerSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "packagingManager.ts"),
  "utf8",
);

describe("Packaging speed feedback quick-check wiring", () => {
  it("routes Packaging, Sauce, and Dough corrections through shared live feedback", () => {
    expect(homeSource).toContain("detectPackagingSpeedDrift");
    expect(
      homeSource.match(/createPackagingControlAdapter\(/g),
    ).toHaveLength(3);
    expect(managerSource).toContain("reportCorrection");
  });

  it("keeps invalid cases-per-skid quick checks out of division paths", () => {
    expect(homeSource).toContain("const hasCps = v.casesPerSkid > 0;");
    expect(homeSource).toContain("const cps = hasCps ? v.casesPerSkid : 0;");
    expect(managerSource).toContain("if (casesPerSkid <= 0) return;");
  });
});

describe("Packaging control adapter", () => {
  it("keeps corrections, caps, and full-skid vibration in one action path", () => {
    const applied: Array<[number, number]> = [];
    const corrections: number[] = [];
    const vibrations: number[] = [];
    const controls = createPackagingControlAdapter({
      skidsCompleted: 2,
      casesOnCurrentSkid: 4,
      casesPerSkid: 10,
      applyProgress: (skids, cases) => applied.push([skids, cases]),
      reportCorrection: (delta) => corrections.push(delta),
      vibrate: (durationMs) => vibrations.push(durationMs),
    });

    controls.incrementCases();
    controls.incrementSkids(3);
    controls.completeSkid();

    expect(applied).toEqual([[2, 5], [3, 5], [4, 0]]);
    expect(corrections).toEqual([1, 10, 5]);
    expect(vibrations).toEqual([8, 8, 15]);
  });

  it("does not apply a capped or invalid quick-check action", () => {
    const applyProgress = vi.fn();
    const reportCorrection = vi.fn();
    const controls = createPackagingControlAdapter({
      skidsCompleted: 3,
      casesOnCurrentSkid: 10,
      casesPerSkid: 10,
      applyProgress,
      reportCorrection,
    });

    controls.incrementSkids(3);
    controls.incrementCases();

    expect(applyProgress).not.toHaveBeenCalled();
    expect(reportCorrection).not.toHaveBeenCalled();
  });
});
