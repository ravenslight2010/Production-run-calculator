import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const profilePath = fileURLToPath(
  new URL("../../docs/coding-assistant/opencode-readonly.example.json", import.meta.url),
);
const profile = JSON.parse(await readFile(profilePath, "utf8"));
const modelId = "REPLACE_WITH_INSTALLED_OLLAMA_MODEL_ID";
const localModel = `plant-local/${modelId}`;

assert.equal(profile.$schema, "https://opencode.ai/config.json");
assert.equal(profile.update, "disable");
assert.equal(profile.model, localModel);
assert.equal(profile.agents?.title?.model, localModel);
assert.equal(profile.providers?.["plant-local"]?.package, "@opencode/ai/providers/openai-compatible");
assert.equal(profile.providers?.["plant-local"]?.settings?.baseURL, "http://127.0.0.1:11434/v1");
assert.equal(profile.providers?.["plant-local"]?.models?.[modelId]?.modelID, modelId);
assert.equal("apiKey" in profile.providers["plant-local"].settings, false);

const permission = (action, resource, effect) =>
  profile.permissions.find((rule) => rule.action === action && rule.resource === resource && rule.effect === effect);
assert.deepEqual(profile.permissions[0], { action: "*", resource: "*", effect: "deny" });
const allowedActions = new Set(
  profile.permissions.filter((rule) => rule.effect === "allow").map((rule) => rule.action),
);
assert.deepEqual([...allowedActions].sort(), ["glob", "grep", "question", "read"].sort());
for (const resource of ["*.env*", "*.npmrc", "*.git-credentials", "*.pem", "*.key", "*.p12", "*.pfx", "*.db", "*.sqlite*", "*.log"]) {
  const allowIndex = profile.permissions.findIndex((rule) => rule.action === "read" && rule.resource === "*" && rule.effect === "allow");
  const denyIndex = profile.permissions.findIndex((rule) => rule.action === "read" && rule.resource === resource && rule.effect === "deny");
  assert(denyIndex > allowIndex, `read deny must follow the broad read allow: ${resource}`);
}
assert(permission("edit", "*", "allow") === undefined);
assert(permission("shell", "*", "allow") === undefined);

const policy = (action, resource, effect) =>
  profile.policies.find((rule) => rule.action === action && rule.resource === resource && rule.effect === effect);
for (const [action, resource, effect] of [
  ["provider.use", "*", "deny"],
  ["provider.use", "plant-local", "allow"],
  ["integration.connect", "*", "deny"],
  ["integration.use", "*", "deny"],
  ["integration.use", "plant-local", "allow"],
  ["mcp.use", "*", "deny"],
  ["skill.use", "*", "deny"],
  ["plugin.use", "*", "deny"],
  ["websearch.use", "*", "deny"],
  ["tool.use", "shell:*", "deny"],
  ["tool.use", "edit:*", "deny"],
  ["tool.use", "subagent:*", "deny"],
  ["tool.use", "external_directory:*", "deny"],
  ["tool.use", "webfetch:*", "deny"],
  ["tool.use", "websearch:*", "deny"],
  ["tool.use", "execute:*", "deny"],
]) {
  assert(policy(action, resource, effect), `missing policy ${action} ${resource} ${effect}`);
}
assert.equal("mcp" in profile, false);
assert.equal("plugins" in profile, false);
console.log("PASS: static read-only profile invariants; model placeholder is intentionally unresolved.");
console.log("NOT TESTED: OpenCode runtime enforcement, Windows isolation, or network egress.");
