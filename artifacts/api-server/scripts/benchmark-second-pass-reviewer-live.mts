import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { openai, pickModel } from "@workspace/integrations-openai-ai-server";
import {
  buildReviewPrompt,
  sanitizeReviewVerdicts,
  type ReviewItem,
} from "@workspace/ai-review";
import { OPERATION_FINDINGS } from "../../../scripts/src/second-pass-reviewer-benchmark.mts";

type Label = "duplicate-if-flagged" | "false-if-flagged";
type Case = ReviewItem & { label: Label; materialKey: string };

const root = path.resolve(import.meta.dirname, "../../..");
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
for (const [operation, config] of Object.entries(OPERATION_FINDINGS)) {
  const cases = toCases(config);
  const { system, user } = buildReviewPrompt(
    operation,
    "Flag a concrete material error; do not flag an unresolved record merely because it requires human review.",
    cases,
  );
  const started = performance.now();
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
      latencyMs: Math.round(latencyMs),
      inputTokens: response.usage?.prompt_tokens ?? null,
      outputTokens: response.usage?.completion_tokens ?? null,
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
      latencyMs: Math.round(performance.now() - started),
      inputTokens: null,
      outputTokens: null,
      failureClass: error instanceof Error ? error.name : "unknown",
    };
  }
}

const output = {
  formatVersion: 1,
  sourceHash: createHash("sha256").update(sourceBytes).digest("hex"),
  model: pickModel("full"),
  operations: aggregate,
};
const target = process.argv.find((arg, index) => index >= 2 && arg !== "--");
if (!target) throw new Error("output path required");
fs.writeFileSync(path.resolve(process.cwd(), target), `${JSON.stringify(output, null, 2)}\n`);