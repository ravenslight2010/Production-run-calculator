import { describe, expect, it } from "vitest";

// Keep the run-closing call sites covered by a cheap contract test. These
// paths intentionally converge on the same durable server finalization intent
// so an explicit completion, auto-stop, rollover, or refresh replay cannot
// publish an End separately from its inventory deduction.
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
    expect(inventoryIntentLines.length).toBeGreaterThanOrEqual(4);
    expect(homeSource).toContain('lifecycle: "end"');
    expect(homeSource).toContain("fencePendingEndSnapshots(");
    expect(homeSource).not.toMatch(/consumeRun\(\s*activeRunId\s*,/);
  });

  it("uses the current run form only for the current run and stored values otherwise", () => {
    expect(homeSource).toContain(
      "r.id === currentRunIdRef.current ? form.getValues() : loadRunValues(r.id)",
    );
    expect(homeSource).toContain(
      "r.id !== activeRunId && r.startedAt && !r.endedAt",
    );
  });
});