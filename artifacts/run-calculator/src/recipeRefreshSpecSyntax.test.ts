import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { browserSpecSyntaxErrors } from "../e2e/validate-browser-spec-syntax";

const SPEC_FILE = path.resolve(
  __dirname,
  "../e2e/recipe-refresh-start-freeze.spec.ts",
);

describe("recipe-refresh browser spec syntax validation", () => {
  it("accepts the checked-in spec before database setup", () => {
    const source = fs.readFileSync(SPEC_FILE, "utf8");
    expect(browserSpecSyntaxErrors(source, path.basename(SPEC_FILE))).toEqual([]);
  });

  it("reports truncated or unbalanced syntax directly", () => {
    expect(
      browserSpecSyntaxErrors(
        "test('truncated', async () => {\n  await page.goto('/');",
        "recipe-refresh-start-freeze.spec.ts",
      ).some((error) => error.includes("'}' expected")),
    ).toBe(true);
  });
});