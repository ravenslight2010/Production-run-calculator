import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const configPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../",
  "artifacts/run-calculator/playwright.department.config.ts",
);
const requiredProjects = ["desktop-chromium", "phone-chromium"];

const config = await readFile(configPath, "utf8");
const missingProjects = requiredProjects.filter(
  (project) => !new RegExp(`name:\\s*["']${project}["']`).test(config),
);

if (missingProjects.length > 0) {
  console.error(
    [
      "Department Playwright project check failed.",
      `Missing project(s): ${missingProjects.join(", ")}.`,
      `Restore both responsive projects in ${configPath}.`,
      "The department-navigation-playwright-evidence workflow artifact is the evidence contract this check protects.",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(
  "Department Playwright project check passed: desktop-chromium and phone-chromium are configured.",
);