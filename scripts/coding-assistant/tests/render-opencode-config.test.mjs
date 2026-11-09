import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { renderOpenCodeConfig } from "../render-opencode-config.mjs";

const templatePath = fileURLToPath(new URL("../../../docs/coding-assistant/opencode-readonly.example.json", import.meta.url));
const template = await readFile(templatePath, "utf8");

function hostReport(codingAssistant = {
  status: "candidate",
  provider: "ollama",
  candidateModel: "qwen2.5-coder:7b",
  qualification: "unmeasured",
}) {
  return {
    schemaVersion: 1,
    tool: "RunCalculator.HostInspector",
    inspectionOnly: true,
    overallStatus: "warn",
    host: { isWindows: true },
    ai: { status: "candidate", candidateModel: "qwen3:4b" },
    codingAssistant,
  };
}

test("renders only the coding-specific local model and preserves read-only boundaries", () => {
  const result = JSON.parse(renderOpenCodeConfig(hostReport(), template));
  assert.equal(result.model, "plant-local/qwen2.5-coder:7b");
  assert.equal(result.agents.title.model, result.model);
  assert.deepEqual(Object.keys(result.providers["plant-local"].models), ["qwen2.5-coder:7b"]);
  assert.equal(result.providers["plant-local"].models["qwen2.5-coder:7b"].modelID, "qwen2.5-coder:7b");
  assert.equal(result.providers["plant-local"].settings.baseURL, "http://127.0.0.1:11434/v1");
  assert.equal(result.permissions[0].effect, "deny");
  assert.equal(result.permissions.some((rule) => rule.action === "edit" && rule.effect === "allow"), false);
  assert.equal(result.permissions.some((rule) => rule.action === "shell" && rule.effect === "allow"), false);
  assert.equal("mcp" in result, false);
  assert.equal("plugins" in result, false);
});

test("does not confuse the product AI recommendation with a coding model", () => {
  const report = hostReport();
  delete report.codingAssistant;
  assert.throws(() => renderOpenCodeConfig(report, template), /no codingAssistant recommendation/);
});

test("fails closed for unknown or rejected coding recommendations", () => {
  assert.throws(() => renderOpenCodeConfig(hostReport({ status: "unknown", provider: null, candidateModel: null }), template), /did not recommend/);
  assert.throws(() => renderOpenCodeConfig(hostReport({ status: "notRecommended", provider: null, candidateModel: null }), template), /did not recommend/);
});

test("rejects cloud providers and malformed model identifiers", () => {
  assert.throws(() => renderOpenCodeConfig(hostReport({ status: "candidate", provider: "openai", candidateModel: "gpt-4" }), template), /only the local Ollama provider/);
  for (const candidateModel of ["../secret", "bad model", "model/../other", "model//tag", "model:", ""]) {
    assert.throws(() => renderOpenCodeConfig(hostReport({ status: "candidate", provider: "ollama", candidateModel }), template), /invalid/);
  }
});

test("refuses non-Windows or blocked/unknown host inspections", () => {
  assert.throws(() => renderOpenCodeConfig({ ...hostReport(), host: { isWindows: false } }, template), /Windows host/);
  assert.throws(() => renderOpenCodeConfig({ ...hostReport(), overallStatus: "blocked" }, template), /blocked or unresolved/);
  assert.throws(() => renderOpenCodeConfig({ ...hostReport(), overallStatus: "unknown" }, template), /blocked or unresolved/);
});

test("refuses a weakened template instead of silently repairing it", () => {
  const weakened = JSON.parse(template);
  weakened.permissions.push({ action: "shell", resource: "*", effect: "allow" });
  assert.throws(() => renderOpenCodeConfig(hostReport(), JSON.stringify(weakened)), /write-capable/);

  const cloud = JSON.parse(template);
  cloud.providers["plant-local"].settings.baseURL = "https://example.invalid/v1";
  assert.throws(() => renderOpenCodeConfig(hostReport(), JSON.stringify(cloud)), /loopback endpoint/);
});
