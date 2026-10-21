import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  findFixHistoryDetails,
  formatFixHistoryFinding,
} from "./check-codex-fixes.mts";

const notePath = resolve(
  import.meta.dirname,
  "../../.agents/memory/codex-fixes.md",
);

test("the current fix-history note contains no flagged operational details", async () => {
  const content = await readFile(notePath, "utf8");
  assert.deepEqual(findFixHistoryDetails(content), []);
});

test("flags private infrastructure, deployment image tags, and actionable watch details without echoing values", () => {
  const privateHost = "ops-cache.internal";
  const privateAddress = "10.44.8.21";
  const imageTag = "registry.example.invalid/service:8.4.2-build.7";
  const watchDetail = "Monitor queue_lag every 4 seconds and alert at threshold";
  const content = [
    `Service was reached at ${privateHost}.`,
    `The diagnostic peer was ${privateAddress}.`,
    `FROM ${imageTag}`,
    watchDetail,
  ].join("\n");

  const findings = findFixHistoryDetails(content);
  assert.deepEqual(findings, [
    { line: 1, category: "infrastructure identifier" },
    { line: 2, category: "infrastructure identifier" },
    { line: 3, category: "deployment image tag" },
    { line: 4, category: "actionable operational watch detail" },
  ]);

  const diagnostic = findings.map(formatFixHistoryFinding).join("\n");
  for (const matchedValue of [
    privateHost,
    privateAddress,
    imageTag,
    "queue_lag",
    "4 seconds",
  ]) {
    assert.equal(diagnostic.includes(matchedValue), false);
  }
});

test("allows generic lessons and the known harmless public API endpoint", () => {
  const content = [
    "A bounded retry preserves the original error for diagnosis.",
    "The public endpoint is https://generativelanguage.googleapis.com.",
    "A container build uses a supported runtime image.",
    "Operational checks should report a category and line, not matched text.",
  ].join("\n");

  assert.deepEqual(findFixHistoryDetails(content), []);
});
