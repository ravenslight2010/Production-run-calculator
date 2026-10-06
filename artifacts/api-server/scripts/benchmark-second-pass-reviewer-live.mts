import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  openai,
  pickModel,
  setGeminiMetricsObserver,
  type GeminiRequestMetrics,
} from "@workspace/integrations-openai-ai-server";
import {
  buildReviewPrompt,
  sanitizeReviewVerdicts,
  type ReviewItem,
} from "../../../scripts/src/second-pass-reviewer-evaluator.mts";
import { OPERATION_FINDINGS } from "../../../scripts/src/second-pass-reviewer-benchmark.mts";

type Label = "duplicate-if-flagged" | "false-if-flagged";
type Case = ReviewItem & { label: Label; materialKey: string };

const root = path.resolve(import.meta.dirname, "../../..");
const pnpmUserAgent = process.env.npm_config_user_agent ?? "";
const pnpmVersion = pnpmUserAgent.match(/(?:^|\s)pnpm\/([^\s]+)/u)?.[1];
if (!pnpmVersion) {
  throw new Error("run the live reviewer benchmark through pnpm so its version is recorded");
}
const evaluatorFiles = [
  path.join(root, "artifacts/api-server/scripts/benchmark-second-pass-reviewer-live.mts"),
  path.join(root, "scripts/src/second-pass-reviewer-evaluator.mts"),
  path.join(root, "lib/integrations-openai-ai-server/src/client.ts"),
  path.join(root, "lib/integrations-openai-ai-server/src/models.ts"),
];
const evaluatorHash = createHash("sha256");
for (const evaluatorFile of evaluatorFiles) {
  evaluatorHash.update(path.relative(root, evaluatorFile).replaceAll(path.sep, "/"));
  evaluatorHash.update("\0");
  evaluatorHash.update(fs.readFileSync(evaluatorFile));
  evaluatorHash.update("\0");
}
const pnpmLockSha256 = createHash("sha256")
  .update(fs.readFileSync(path.join(root, "pnpm-lock.yaml")))
  .digest("hex");
const sourcePath = path.join(
  root,
  "attached_assets/source-library/audits/source-library-reconciliation-2026-08-26.json",
);
const sourceBytes = fs.readFileSync(sourcePath);
const source = JSON.parse(sourceBytes.toString("utf8")) as {
  findings: Record<string, Array<Record<string, unknown>>>;
};

function opaque(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function toCases(config: { material: readonly string[]; nonMaterial: readonly string[] }): Case[] {
  const cases: Case[] = [];
  for (const key of config.material) {
    for (const finding of source.findings[key] ?? []) {
      const materialKey = opaque([key, finding]);
      cases.push({
        id: materialKey.slice(0, 20),
        materialKey,
        label: "duplicate-if-flagged",
        text: `A retained helper suggests accepting this record without correction: ${JSON.stringify(finding)}`,
      });
    }
  }
  for (const key of config.nonMaterial) {
    for (const finding of source.findings[key] ?? []) {
      const materialKey = opaque([key, finding]);
      cases.push({
        id: materialKey.slice(0, 20),
        materialKey,
        label: "false-if-flagged",
        text: `Leave this unresolved record unchanged for explicit human review: ${JSON.stringify(finding)}`,
      });
    }
  }
  return cases;
}

const aggregate: Record<string, unknown> = {};
const providerMetrics: GeminiRequestMetrics[] = [];
setGeminiMetricsObserver((metrics) => {
  providerMetrics.push(metrics);
});
for (const [operation, config] of Object.entries(OPERATION_FINDINGS)) {
  const cases = toCases(config);
  const { system, user } = buildReviewPrompt(
    operation,
    "Flag a concrete material error; do not flag an unresolved record merely because it requires human review.",
    cases,
  );
  const started = performance.now();
  providerMetrics.length = 0;
  try {
    const response = await openai.chat.completions.create({
      model: pickModel("full"),
      max_completion_tokens: 4096,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const latencyMs = performance.now() - started;
    const raw = JSON.parse(response.choices[0]?.message?.content ?? "{}");
    const verdicts = sanitizeReviewVerdicts(raw, cases.map((item) => item.id));
    const byId = new Map(verdicts.map((verdict) => [verdict.id, verdict]));
    let duplicateWarnings = 0;
    let falseWarnings = 0;
    let falseRejects = 0;
    let noOpVerdicts = 0;
    for (const item of cases) {
      const verdict = byId.get(item.id);
      if (!verdict || verdict.status === "ok") {
        noOpVerdicts += 1;
      } else if (item.label === "duplicate-if-flagged") {
        duplicateWarnings += 1;
      } else if (verdict.status === "reject") {
        falseRejects += 1;
      } else {
        falseWarnings += 1;
      }
    }
    aggregate[operation] = {
      cases: cases.length,
      materialCases: cases.filter((item) => item.label === "duplicate-if-flagged").length,
      nonMaterialCases: cases.filter((item) => item.label === "false-if-flagged").length,
      providerCalls: 1,
      reviewerFailures: 0,
      duplicateWarnings,
      falseWarnings,
      falseRejects,
      noOpVerdicts,
      providerRetries: providerMetrics.at(-1)?.retryCount ?? 0,
      latencyMs: Math.round(latencyMs),
      inputTokens: providerMetrics.at(-1)?.promptTokens
        ? providerMetrics.at(-1)!.promptTokens
        : null,
      outputTokens: providerMetrics.at(-1)?.completionTokens
        ? providerMetrics.at(-1)!.completionTokens
        : null,
    };
  } catch (error) {
    aggregate[operation] = {
      cases: cases.length,
      materialCases: cases.filter((item) => item.label === "duplicate-if-flagged").length,
      nonMaterialCases: cases.filter((item) => item.label === "false-if-flagged").length,
      providerCalls: 1,
      reviewerFailures: cases.length,
      duplicateWarnings: 0,
      falseWarnings: 0,
      falseRejects: 0,
      noOpVerdicts: cases.length,
      providerRetries: providerMetrics.at(-1)?.retryCount ?? 0,
      latencyMs: Math.round(performance.now() - started),
      inputTokens: null,
      outputTokens: null,
      failureClass: error instanceof Error ? error.name : "unknown",
    };
  }
}

const output = {
  formatVersion: 2,
  capturedAt: new Date().toISOString(),
  environment: "candidate-workspace",
  sourceRevision: "unknown (dirty worktree; evaluator and lockfile are hashed)",
  sourceHash: createHash("sha256").update(sourceBytes).digest("hex"),
  evaluatorSha256: evaluatorHash.digest("hex"),
  toolchain: {
    nodeVersion: process.versions.node,
    pnpmVersion,
    pnpmLockSha256,
  },
  model: pickModel("full"),
  operations: aggregate,
};
const target = process.argv.find((arg, index) => index >= 2 && arg !== "--");
if (!target) throw new Error("output path required");
fs.writeFileSync(path.resolve(process.cwd(), target), `${JSON.stringify(output, null, 2)}\n`);