import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const packageJsonPath = resolve(process.cwd(), "package.json");
const debugConfigPath = resolve(
  process.cwd(),
  "playwright.release-debug.config.ts",
);
const fullConfigPath = resolve(process.cwd(), "playwright.config.ts");

describe("focused release browser debug boundary", () => {
  it("starts local release servers without self-approving destructive database access", async () => {
    const packageJson = JSON.parse(
      await readFile(packageJsonPath, "utf8"),
    ) as {
      scripts: Record<string, string>;
    };
    const command = packageJson.scripts["test:e2e:release-debug"];

    expect(command).toContain("RELEASE_BROWSER_LOCAL_SERVERS=1");
    expect(command).toContain(
      "--config playwright.release-debug.config.ts",
    );
    expect(command).not.toContain("E2E_TEST_DB=1");
    expect(command).not.toContain("E2E_APPROVED_DESTRUCTIVE_MODE=1");
  });

  it("keeps debug artifacts separate and the strict reporter exclusive to the full lane", async () => {
    const [debugConfig, fullConfig] = await Promise.all([
      readFile(debugConfigPath, "utf8"),
      readFile(fullConfigPath, "utf8"),
    ]);

    expect(debugConfig).toContain('outputDir: "test-results/release-debug"');
    expect(debugConfig).toContain(
      'outputFolder: "playwright-report/release-debug"',
    );
    expect(debugConfig).not.toContain("release-duration-reporter");
    expect(debugConfig).not.toContain("release-evidence");
    expect(fullConfig).toContain("./e2e/release-duration-reporter.ts");
  });
});