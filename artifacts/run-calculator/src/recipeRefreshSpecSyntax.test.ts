import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  browserSpecSyntaxErrors,
  configuredBrowserSpecFiles,
  validateBrowserSpecSyntaxSet,
} from "../e2e/validate-browser-spec-syntax";

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

  it("discovers the configured browser-spec set", () => {
    expect(
      configuredBrowserSpecFiles().some(
        (fileUrl) =>
          fileURLToPath(fileUrl) === SPEC_FILE,
      ),
    ).toBe(true);
  });

  it("reports missing files with the existing concise error format", () => {
    const missingFile = pathToFileURL(
      path.join(__dirname, "../e2e/missing-browser-spec.spec.ts"),
    );
    expect(() =>
      validateBrowserSpecSyntaxSet([
        missingFile,
      ]),
    ).toThrow(
      "Browser spec syntax validation failed before database setup:\n" +
        "- unable to read missing-browser-spec.spec.ts.",
    );
  });
});