import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  browserSpecSyntaxErrors,
  browserSpecManagerDefaultsErrors,
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

describe("browser default-manager fixture preflight", () => {
  const historical = [
    "manage-staff", "manage-inventory", "edit-production-rules",
    "approve-password-resets", "review-incidents", "use-ai-tools",
    "manage-factory-settings", "manage-profiles",
  ];
  const literal = JSON.stringify(historical);

  it.each([
    `const MANAGER_CAPABILITIES = ${literal};`,
    `const MANAGER_CAPABILITIES = ${JSON.stringify([...historical, "manage-qc"])};`,
    `await db.query("UPDATE roles SET capabilities = $1::jsonb WHERE name = 'manager'", [JSON.stringify(${literal})]);`,
  ])("rejects copied default-role baselines before setup: %s", (source) => {
    expect(browserSpecManagerDefaultsErrors(source, "fixture.spec.ts")).toEqual([
      expect.stringContaining("fixture.spec.ts:1: copied default-manager capabilities"),
    ]);
  });

  it.each([
    "const MANAGER_CAPABILITIES = DEFAULT_MANAGER_CAPABILITIES;",
    `await db.query("UPDATE roles SET capabilities = $1::jsonb WHERE name = 'manager'", [JSON.stringify([])]);`,
    `await db.query("UPDATE roles SET capabilities = $1::jsonb WHERE name = 'manager'", [JSON.stringify(DEFAULT_MANAGER_CAPABILITIES.filter(cap => cap !== "manage-qc"))]);`,
    `await db.query("UPDATE roles SET capabilities = $1::jsonb WHERE name = $2", [JSON.stringify(${literal}), "owned-test-role"]);`,
    `const unrelatedValues = ${literal};`,
  ])("preserves canonical defaults and intentional restrictions: %s", (source) => {
    expect(browserSpecManagerDefaultsErrors(source, "fixture.spec.ts")).toEqual([]);
  });

  it("wires the role-copy guard into the existing pre-database validator", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "manager-fixture-"));
    try {
      const fixture = path.join(directory, "copied-manager.spec.ts");
      fs.writeFileSync(fixture, `const MANAGER_CAPABILITIES = ${literal};`);
      expect(() =>
        validateBrowserSpecSyntaxSet([pathToFileURL(fixture)]),
      ).toThrow("copied default-manager capabilities");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});