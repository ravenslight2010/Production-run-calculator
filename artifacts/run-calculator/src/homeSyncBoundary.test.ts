import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Home sync manager boundary", () => {
  it("keeps transport primitives out of Home", () => {
    const home = readFileSync(resolve(import.meta.dirname, "pages/home.tsx"), "utf8");

    // These are manager-owned coordination concerns. Home only supplies the
    // canonical state/form callbacks that preserve the existing merge policy.
    expect(home).not.toContain("Event" + "Source");
    expect(home).not.toContain("SingleFlight" + "SyncQueue");
    expect(home).not.toContain("createSync" + "BaselineGate");
    expect(home).not.toMatch(/fetch\(`\/api\/sync\/today[^`]*`,\s*\{\s*method:\s*"PUT"/);
  });
});