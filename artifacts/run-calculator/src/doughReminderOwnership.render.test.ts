import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const liveDoughSource = readFileSync(
  resolve(process.cwd(), "src/components/live-stations/LiveDoughTabContent.tsx"),
  "utf8",
);
const floorModeSource = readFileSync(
  resolve(process.cwd(), "src/components/ScreenModeView.tsx"),
  "utf8",
);

describe("Dough reminder ownership", () => {
  it("renders the live reminder card only in manual tracking mode", () => {
    expect(liveDoughSource).toMatch(
      /runStatus === "running" && !calc\.pressDone && !autoTrackProgress/,
    );
    expect(liveDoughSource).toContain('data-testid="button-dismiss-batch-reminder"');
    expect(liveDoughSource).toContain("Dismiss reminder");
    expect(liveDoughSource).not.toContain("START NEXT BATCH");
  });

  it("shows automatic ownership instead of manual-start instructions in Dough floor mode", () => {
    const autoBranch = floorModeSource.slice(
      floorModeSource.indexOf('runStatus === "running" && autoTrackProgress'),
      floorModeSource.indexOf(
        ': runStatus === "running" && calc.timePerBatchSec',
      ),
    );

    expect(autoBranch).toContain("Automatic Dough Tracking Active");
    expect(autoBranch).toContain("Batch progress updates automatically");
    expect(autoBranch).not.toMatch(/Start Next Batch/i);
  });

  it("keeps the manual floor-mode countdown and due wording", () => {
    expect(floorModeSource).toContain('"🍕 Start Next Batch Now!"');
    expect(floorModeSource).toContain('"Next Batch In"');
    expect(floorModeSource).toContain("fmtCountdownParts(mm, ss)");
  });
});