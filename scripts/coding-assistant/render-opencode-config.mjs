import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const TEMPLATE_PATH = fileURLToPath(
  new URL("../../docs/coding-assistant/opencode-readonly.example.json", import.meta.url),
);
const PLACEHOLDER = "REPLACE_WITH_INSTALLED_OLLAMA_MODEL_ID";
const LOCAL_PROVIDER = "plant-local";
const LOCAL_BASE_URL = "http://127.0.0.1:11434/v1";
const MODEL_CONTEXT_LIMITS = Object.freeze({
  "qwen2.5-coder:7b": 32_768,
  "qwen3-coder:30b": 65_536,
});

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateReport(report) {
  requireCondition(isRecord(report), "host report must be a JSON object");
  requireCondition(report.schemaVersion === 1, "unsupported host report schema version");
  requireCondition(report.tool === "RunCalculator.HostInspector", "unexpected host report tool");
  requireCondition(report.inspectionOnly === true, "host report is not marked inspection-only");
  requireCondition(isRecord(report.host) && report.host.isWindows === true, "report must come from a Windows host inspection");
  requireCondition(
    report.overallStatus === "pass" || report.overallStatus === "warn",
    "host inspection is blocked or unresolved; refusing to render a runtime profile",
  );

  const recommendation = report.codingAssistant;
  requireCondition(isRecord(recommendation), "host report has no codingAssistant recommendation; the installer integration is not available yet");
  requireCondition(recommendation.status === "candidate", "installer did not recommend a coding model for this host");
  requireCondition(recommendation.provider === "ollama", "only the local Ollama provider is accepted");
  const modelId = recommendation.candidateModel;
  requireCondition(
    typeof modelId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(modelId) &&
      !modelId.includes("..") && !modelId.includes("//") && !modelId.endsWith(":") && !modelId.endsWith("/"),
    "coding model identifier is missing or invalid",
  );
  const contextTokens = MODEL_CONTEXT_LIMITS[modelId];
  requireCondition(
    contextTokens !== undefined && recommendation.contextTokens === contextTokens,
    "coding model or context cap is not in the approved local catalogue",
  );
  return { modelId, contextTokens };
}

function assertReadOnlyProfile(profile, expectedModelId, expectedContextTokens) {
  requireCondition(isRecord(profile), "profile template must be a JSON object");
  requireCondition(profile.$schema === "https://opencode.ai/config.json", "unexpected OpenCode schema");
  requireCondition(profile.update === "disable", "automatic OpenCode updates must stay disabled in the pilot");
  requireCondition(profile.model === `${LOCAL_PROVIDER}/${expectedModelId}`, "primary model is not pinned to the local candidate");
  requireCondition(profile.agents?.title?.model === profile.model, "auxiliary title model must use the same local model");

  const providers = profile.providers;
  requireCondition(isRecord(providers) && Object.keys(providers).length === 1 && isRecord(providers[LOCAL_PROVIDER]), "profile must contain only the approved local provider");
  const provider = providers[LOCAL_PROVIDER];
  requireCondition(provider.package === "@opencode/ai/providers/openai-compatible", "unexpected local provider package");
  requireCondition(provider.settings?.baseURL === LOCAL_BASE_URL, "provider must point only to the local Ollama loopback endpoint");
  requireCondition(!("apiKey" in provider.settings), "API keys are not allowed in the pilot profile");
  requireCondition(
    isRecord(provider.models) && Object.keys(provider.models).length === 1 &&
      isRecord(provider.models[expectedModelId]) && provider.models[expectedModelId].modelID === expectedModelId,
    "profile model entry does not match the installer candidate",
  );
  requireCondition(
    provider.models[expectedModelId].limit?.context === expectedContextTokens &&
      provider.models[expectedModelId].limit?.output === 8192,
    "model context/output limits do not match the approved catalogue",
  );

  requireCondition(Array.isArray(profile.permissions), "profile is missing explicit permissions");
  requireCondition(
    JSON.stringify(profile.permissions[0]) === JSON.stringify({ action: "*", resource: "*", effect: "deny" }),
    "permissions must begin with a global deny",
  );
  const allowed = new Set(profile.permissions.filter((rule) => rule.effect === "allow").map((rule) => rule.action));
  requireCondition(
    [...allowed].sort().join(",") === ["glob", "grep", "question", "read"].sort().join(","),
    "unexpected write-capable or unreviewed permission is present",
  );
  for (const resource of ["*.env*", "*.npmrc", "*.git-credentials", "*.pem", "*.key", "*.p12", "*.pfx", "*.db", "*.sqlite*", "*.log"]) {
    requireCondition(
      profile.permissions.some((rule) => rule.action === "read" && rule.resource === resource && rule.effect === "deny"),
      `missing sensitive-file read denial: ${resource}`,
    );
  }

  requireCondition(Array.isArray(profile.policies), "profile is missing explicit integration/tool policies");
  const hasPolicy = (action, resource, effect) =>
    profile.policies.some((rule) => rule.action === action && rule.resource === resource && rule.effect === effect);
  for (const [action, resource, effect] of [
    ["provider.use", "*", "deny"],
    ["provider.use", LOCAL_PROVIDER, "allow"],
    ["integration.connect", "*", "deny"],
    ["integration.use", "*", "deny"],
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
    requireCondition(hasPolicy(action, resource, effect), `missing safety policy: ${action} ${resource} ${effect}`);
  }
  requireCondition(!("mcp" in profile) && !("plugins" in profile), "MCP servers and plugins must remain absent");
}

export function renderOpenCodeConfig(report, templateText) {
  const { modelId, contextTokens } = validateReport(report);
  let profile;
  try {
    profile = JSON.parse(templateText);
  } catch {
    throw new Error("OpenCode profile template is not valid JSON");
  }

  requireCondition(
    isRecord(profile.providers?.[LOCAL_PROVIDER]?.models) &&
      isRecord(profile.providers[LOCAL_PROVIDER].models[PLACEHOLDER]),
    "template model placeholder is missing or changed",
  );
  const modelTemplate = profile.providers[LOCAL_PROVIDER].models[PLACEHOLDER];
  profile.model = `${LOCAL_PROVIDER}/${modelId}`;
  profile.agents ??= {};
  profile.agents.title ??= {};
  profile.agents.title.model = profile.model;
  profile.providers[LOCAL_PROVIDER].models = {
    [modelId]: {
      ...modelTemplate,
      modelID: modelId,
      limit: { ...modelTemplate.limit, context: contextTokens, output: 8192 },
    },
  };

  assertReadOnlyProfile(profile, modelId, contextTokens);
  const output = JSON.stringify(profile, null, 2);
  requireCondition(!output.includes(PLACEHOLDER), "unresolved model placeholder remains");
  return `${output}\n`;
}

async function main(args) {
  if (args.length !== 2 || args[0] !== "--report") {
    throw new Error("usage: node scripts/coding-assistant/render-opencode-config.mjs --report <host-report.json> > opencode.json");
  }
  const report = JSON.parse(await readFile(args[1], "utf8"));
  const templateText = await readFile(TEMPLATE_PATH, "utf8");
  process.stdout.write(renderOpenCodeConfig(report, templateText));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`Cannot render OpenCode profile: ${error.message}\n`);
    process.exitCode = 1;
  });
}
