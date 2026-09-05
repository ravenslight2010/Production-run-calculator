import { describe, expect, it } from "vitest";

// Keep the run-closing call sites covered by a cheap contract test. These
// paths intentionally converge on the same run-keyed server claim so an
// explicit completion, auto-stop, rollover, or refresh
// replay cannot create a second inventory deduction.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const homeSource = readFileSync(
  resolve(fileURLToPath(import.meta.url), "../pages/home.tsx"),
  "utf8",
);

describe("inventory finalization wiring", () => {
  it("routes every run-closing path through run-keyed consumeRun", () => {
    const consumeCalls = [...homeSource.matchAll(/consumeRun\(\s*([^,]+),/g)];
    expect(consumeCalls.length).toBeGreaterThanOrEqual(4);
    expect(consumeCalls.map((match) => match[1].trim())).toEqual(
      expect.arrayContaining(["r.id", "activeRunId"]),
    );
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