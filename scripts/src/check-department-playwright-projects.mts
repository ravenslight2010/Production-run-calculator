import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const configPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../",
  "artifacts/run-calculator/playwright.department.config.ts",
);
const workflowPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../",
  ".github/workflows/department-navigation.yml",
);
const requiredProjects = ["desktop-chromium", "phone-chromium"];

const config = await readFile(configPath, "utf8");
const workflow = await readFile(workflowPath, "utf8");
const missingProjects = requiredProjects.filter(
  (project) => !new RegExp(`name:\\s*["']${project}["']`).test(config),
);
const contractFailures = [
  ...(!/retries:\s*0/.test(config)
    ? [
        "Playwright retries must remain disabled so persistent startup failures are not masked.",
      ]
    : []),
  ...(!/trace:\s*["']retain-on-failure["']/.test(config)
    ? ["Playwright must retain the first failure trace."]
    : []),
  ...(!/VITE_API_PROXY_TARGET:\s*http:\/\/127\.0\.0\.1:5000/.test(workflow)
    ? [
        "The workflow must route Vite /api requests to its API server on port 5000.",
      ]
    : []),
  ...(!/api\/readyz/.test(workflow) ||
  !/department-readiness\.log/.test(workflow)
    ? ["The workflow must retain bounded structured readiness diagnostics."]
    : []),
  ...(!/api\/livez/.test(workflow) || !/department-proxy\.log/.test(workflow)
    ? ["The workflow must distinguish API liveness from Vite proxy failures."]
    : []),
];

if (missingProjects.length > 0 || contractFailures.length > 0) {
  console.error(
    [
      "Department Playwright project check failed.",
      ...(missingProjects.length > 0
        ? [`Missing project(s): ${missingProjects.join(", ")}.`]
        : []),
      ...contractFailures,
      `Restore both responsive projects in ${configPath}.`,
      "The department-navigation-playwright-evidence workflow artifact is the evidence contract this check protects.",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(
  "Department Playwright contract passed: desktop and phone projects, first-failure traces, readiness diagnostics, and API proxy routing are configured.",
);
