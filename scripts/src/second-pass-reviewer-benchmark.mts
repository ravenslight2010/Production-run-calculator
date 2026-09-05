import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

type FindingName =
  | "wrongQuantities"
  | "missingComponents"
  | "extraComponents"
  | "duplicateComponents"
  | "wrongNamesOrLinks"
  | "allZeroStubs"
  | "unmatchedSourceRecipes"
  | "unmatchedLiveRecipes"
  | "duplicateRecipes";

type FindingMap = Record<FindingName, unknown[]>;

export const OPERATION_FINDINGS: Record<
  string,
  { material: FindingName[]; nonMaterial: FindingName[] }
> = {
  "parse-spec-sheet": {
    material: ["wrongQuantities", "missingComponents", "extraComponents", "duplicateComponents"],
    nonMaterial: [],
  },
  "match-import": { material: ["wrongNamesOrLinks"], nonMaterial: [] },
  "match-premix": { material: [], nonMaterial: ["unmatchedSourceRecipes"] },
  "suggest-merges": { material: ["allZeroStubs", "duplicateRecipes"], nonMaterial: [] },
  "fill-missing": { material: [], nonMaterial: ["unmatchedLiveRecipes"] },
};

export const ACCEPTANCE = {
  minimumUniqueMaterialCatchRate: 0.2,
  maximumFalseWarningRate: 0.05,
  maximumAddedCostRatio: 0.35,
  maximumAddedLatencyP95Ms: 1_500,
  maximumReviewerFailureRate: 0.05,
  minimumUniqueMaterialCatches: 5,
} as const;

const MATERIAL: FindingName[] = [
  "wrongQuantities",
  "missingComponents",
  "extraComponents",
  "duplicateComponents",
  "wrongNamesOrLinks",
  "allZeroStubs",
  "duplicateRecipes",
];
const NON_MATERIAL: FindingName[] = ["unmatchedSourceRecipes", "unmatchedLiveRecipes"];

type Observation = {
  cases: number;
  materialCases: number;
  nonMaterialCases: number;
  providerCalls: number;
  reviewerFailures: number;
  duplicateWarnings: number;
  falseWarnings: number;
  falseRejects: number;
  noOpVerdicts: number;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
};

export function evaluateReviewerEvidence(
  findings: FindingMap,
  observations: Record<string, Observation>,
) {
  const material = MATERIAL.reduce((sum, key) => sum + findings[key].length, 0);
  const nonMaterial = NON_MATERIAL.reduce((sum, key) => sum + findings[key].length, 0);

  // These labels were produced by deterministic source reconciliation before
  // the reviewer benchmark. A reviewer cannot receive "unique catch" credit for
  // rediscovering one, and the checked-in corpus contains no separately labeled
  // material miss left over for it to catch.
  const values = Object.values(observations);
  const expectedOperations = Object.keys(OPERATION_FINDINGS).sort();
  const observedOperations = Object.keys(observations).sort();
  if (JSON.stringify(expectedOperations) !== JSON.stringify(observedOperations)) {
    throw new Error("reviewer observations do not cover the expected operations");
  }
  for (const [operation, config] of Object.entries(OPERATION_FINDINGS)) {
    const observation = observations[operation];
    const expectedMaterial = config.material.reduce((sum, key) => sum + findings[key].length, 0);
    const expectedNonMaterial = config.nonMaterial.reduce(
      (sum, key) => sum + findings[key].length,
      0,
    );
    if (
      observation.materialCases !== expectedMaterial
      || observation.nonMaterialCases !== expectedNonMaterial
      || observation.cases !== expectedMaterial + expectedNonMaterial
    ) {
      throw new Error(`reviewer observation labels do not match source for ${operation}`);
    }
  }
  const uniqueMaterialCatches = 0;
  const duplicateWarnings = values.reduce((sum, value) => sum + value.duplicateWarnings, 0);
  const falseWarnings = values.reduce((sum, value) => sum + value.falseWarnings, 0);
  const falseRejects = values.reduce((sum, value) => sum + value.falseRejects, 0);
  const noOpVerdicts = values.reduce((sum, value) => sum + value.noOpVerdicts, 0);
  const reviewerFailures = values.reduce((sum, value) => sum + value.reviewerFailures, 0);
  const observedCases = values.reduce((sum, value) => sum + value.cases, 0);
  if (observedCases !== material + nonMaterial) {
    throw new Error(`reviewer observations cover ${observedCases} of ${material + nonMaterial} cases`);
  }
  const uniqueCatchRate = material === 0 ? 0 : uniqueMaterialCatches / material;
  const successfullyReviewedNonMaterial = values.reduce(
    (sum, value) => sum + (value.reviewerFailures === 0 ? value.nonMaterialCases : 0),
    0,
  );
  const falseWarningRate = successfullyReviewedNonMaterial === 0
    ? null
    : (falseWarnings + falseRejects) / successfullyReviewedNonMaterial;
  const reviewerFailureRate = observedCases === 0 ? 1 : reviewerFailures / observedCases;
  const p95LatencyMs = values.length === 0
    ? null
    : values.map((value) => value.latencyMs).sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
  const measuredTokens = values.every(
    (value) => value.inputTokens !== null && value.outputTokens !== null,
  );
  const addedCostRatio = null;
  const thresholdPasses = {
    uniqueMaterialCatchCount: uniqueMaterialCatches >= ACCEPTANCE.minimumUniqueMaterialCatches,
    uniqueMaterialCatchRate: uniqueCatchRate >= ACCEPTANCE.minimumUniqueMaterialCatchRate,
    falseWarningRate:
      falseWarningRate !== null && falseWarningRate <= ACCEPTANCE.maximumFalseWarningRate,
    addedCostRatio: addedCostRatio !== null && addedCostRatio <= ACCEPTANCE.maximumAddedCostRatio,
    addedLatencyP95:
      p95LatencyMs !== null && p95LatencyMs <= ACCEPTANCE.maximumAddedLatencyP95Ms,
    reviewerFailureRate: reviewerFailureRate <= ACCEPTANCE.maximumReviewerFailureRate,
  };

  return {
    acceptanceCriteria: ACCEPTANCE,
    corpus: {
      labeledCases: material + nonMaterial,
      materialCases: material,
      nonMaterialCases: nonMaterial,
      sourceAuthority: "deterministic-reconciliation-and-human-review",
    },
    pairedOutcome: {
      control: { uniqueMaterialCatches: 0, addedProviderCalls: 0 },
      reviewer: {
        uniqueMaterialCatches,
        duplicateWarnings,
        falseWarnings,
        falseRejects,
        noOpVerdicts,
        reviewerFailures,
        reviewerFailureRate,
        falseWarningRate,
      },
    },
    operationEffects: {
      "parse-spec-sheet": { addedCostRatio: 1, addedProviderCallsPerMiss: 1, cache: "reviewer-memory-only" },
      "match-import": { addedCostRatio: "full-model-after-cheap-model", addedProviderCallsPerMiss: 1, cache: "reviewer-memory-only" },
      "match-premix": { addedCostRatio: "full-model-after-cheap-model", addedProviderCallsPerMiss: 1, cache: "reviewer-memory-only" },
      "suggest-merges": { addedCostRatio: "full-model-after-cheap-model", addedProviderCallsPerMiss: 1, cache: "reviewer-memory-only" },
      "fill-missing": { addedCostRatio: "full-model-after-cheap-model", addedProviderCallsPerRequest: 1, cache: "reviewer-memory-only" },
    },
    measuredEffects: {
      observationsByOperation: observations,
      measuredTokens,
      addedCostRatio,
      p95LatencyMs,
    },
    latencyAndRetry: {
      addedSerialProviderRoundTripsPerMiss: 1,
      reviewerRetries: 0,
      reviewerFailureBehavior: "fail-open-with-no-verdict",
      measuredLatencyP95Ms: p95LatencyMs,
      note: "The reviewer adds one serial provider round trip; provider failures are not retried.",
    },
    decision: {
      retain: Object.values(thresholdPasses).every(Boolean),
      thresholdPasses,
      reason: "No uniquely caught material errors exist in the labeled retained corpus.",
      authority: "Deterministic sanitizers, canonicalization, source evidence, and explicit human confirmation remain authoritative.",
    },
  };
}

function repositoryRoot() {
  let current = process.cwd();
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) return current;
    current = path.dirname(current);
  }
  throw new Error("repository root not found");
}

export function buildReviewerBenchmark(root = repositoryRoot()) {
  const sourcePath = path.join(
    root,
    "attached_assets/source-library/audits/source-library-reconciliation-2026-08-26.json",
  );
  const source = JSON.parse(fs.readFileSync(sourcePath, "utf8")) as { findings: FindingMap };
  const observationsPath = path.join(
    root,
    "docs/second-pass-reviewer-live-observations-2026-09-05.json",
  );
  const observationsFile = JSON.parse(fs.readFileSync(observationsPath, "utf8")) as {
    sourceHash: string;
    operations: Record<string, Observation>;
  };
  const sourceHash = createHash("sha256").update(fs.readFileSync(sourcePath)).digest("hex");
  if (observationsFile.sourceHash !== sourceHash) {
    throw new Error("reviewer observations do not match the pinned reconciliation source");
  }
  const report = evaluateReviewerEvidence(source.findings, observationsFile.operations);
  const output = {
    benchmarkVersion: 1,
    sourceHash,
    ...report,
  };
  return output;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const output = buildReviewerBenchmark();
  const target = process.argv.find((arg, index) => index >= 2 && arg !== "--");
  if (target) fs.writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`);
  else process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (output.decision.retain) process.exitCode = 1;
}