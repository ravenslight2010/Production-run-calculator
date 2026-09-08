import { describe, expect, it } from "vitest";

// Keep the run-closing call sites covered by a cheap contract test. These
// Client-owned run-closing paths intentionally converge on the same durable
// server finalization intent. Daily rollover is server-owned and must not be
// reintroduced here as a duplicate client finalization path.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const homeSource = readFileSync(
  resolve(fileURLToPath(import.meta.url), "../pages/home.tsx"),
  "utf8",
);

describe("inventory finalization wiring", () => {
  it("routes every run-closing path through the atomic finalization intent", () => {
    const inventoryIntentLines = [...homeSource.matchAll(
      /inventoryLines:\s*computeRunConsumptionLines\(/g,
    )];
    expect(inventoryIntentLines.length).toBeGreaterThanOrEqual(2);
    expect(homeSource).toContain('lifecycle: "end"');
    expect(homeSource).toContain("fencePendingEndSnapshots(");
    expect(homeSource).not.toMatch(/consumeRun\(\s*activeRunId\s*,/);
  });

  it("does not retain a client-side midnight finalization loop", () => {
    expect(homeSource).not.toContain("date-rollover");
    expect(homeSource).not.toContain("msUntilMidnight");
  });
});