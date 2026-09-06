import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findRepairResult, listRepairResults } from "./repairResultsRepository";

describe("repair results repository boundary", () => {
  it("accepts only a read executor and never imports write-capable repair code", () => {
    const source = fs.readFileSync(path.join(import.meta.dirname, "repairResultsRepository.ts"), "utf8");
    expect(source).not.toMatch(/^import .*["'].*(?:dataHeals|repairRegistry|\/repairs\/).*["'];?$/m);
    expect(typeof findRepairResult).toBe("function");
    expect(typeof listRepairResults).toBe("function");
  });
});