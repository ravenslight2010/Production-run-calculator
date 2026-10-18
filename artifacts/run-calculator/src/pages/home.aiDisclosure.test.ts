import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("workbook AI disclosure placement", () => {
  it("shows the data-sharing disclosure before the workbook selection control", () => {
    const source = readFileSync(resolve(process.cwd(), "src/pages/home.tsx"), "utf8");
    const disclosure = source.indexOf('data-testid="spec-workbook-ai-disclosure"');
    const selection = source.indexOf("Import Spec Sheet", disclosure);

    expect(disclosure).toBeGreaterThan(-1);
    expect(selection).toBeGreaterThan(disclosure);
    expect(source.slice(disclosure, selection)).toContain("configured AI provider");
  });
});