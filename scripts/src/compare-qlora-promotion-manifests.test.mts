import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  evaluateConditionalQloraPromotion,
  QLORA_PROMOTION_POWER_METHOD,
  type QloraPromotionInput,
} from "@workspace/ai-evaluation";
import { compareQloraManifestFiles } from "./compare-qlora-promotion-manifests.mts";

const digest = (character: string) => character.repeat(64);

function makeInput(candidateModelSha256 = digest("3")): QloraPromotionInput {
  const fields = Array.from({ length: 100 }, (_, index) => `field-${index}`);
  const criticalFields = fields.slice(0, 10);
  const identities = {
    state: "identified" as const,
    sourceRevisionSha256: digest("a"),
    promptParseCacheSha256: digest("b"),
    outputSchemaSha256: digest("c"),
    sanitizerSha256: digest("d"),
    caseInputManifestSha256: digest("e"),
    goldLabelManifestSha256: digest("f"),
    fieldScoringRulesSha256: digest("1"),
    scoringImplementationSha256: digest("2"),
    expectedCases: 12,
    candidate: {
      modelSha256: candidateModelSha256,
      tokenizerSha256: digest("4"),
      generationSettingsSha256: digest("5"),
      retryPolicySha256: digest("6"),
    },
    promptedBase: {
      modelSha256: digest("7"),
      tokenizerSha256: digest("4"),
      generationSettingsSha256: digest("5"),
      retryPolicySha256: digest("6"),
    },
    gemini: {
      provider: "Gemini",
      model: "synthetic-gemini",
      generationSettingsSha256: digest("8"),
      retryPolicySha256: digest("9"),
    },
  };
  const powerAnalysis = {
    state: "qualified" as const,
    developmentEvidenceSha256: digest("f"),
    method: QLORA_PROMOTION_POWER_METHOD,
    seed: 20261002,
    confidenceLevel: 0.95,
    minimumPower: 0.8,
    overallTargetMarginPercentagePoints: 5,
    criticalTargetMarginPercentagePoints: 3,
    developmentCaseCount: 12,
    developmentBrandClusterCount: 12,
    simulationReplicates: 5000,
    plannedBrandClusters: 10,
    overallPower: 0.85,
    criticalPower: 0.84,
  };
  const correctness = Object.fromEntries(fields.map((field) => [field, true]));
  const runs = () =>
    Array.from({ length: 12 }, (_, index) => ({
      caseId: `case-${index}`,
      brandClusterId: `brand-${index}`,
      eligibleFields: fields,
      criticalFields,
      fieldCorrectness: correctness,
      schemaValid: true,
      blankPoison: false,
      emptyOutput: false,
      systematicMissingRequiredFields: false,
    }));
  return {
    identities,
    powerAnalysis,
    bootstrapSeed: 20261002,
    results: {
      candidate: runs(),
      promptedBase: runs(),
      gemini: runs(),
    },
  };
}

function writeComparisonFiles(
  directory: string,
  baseline: { manifest: unknown; bindings: unknown },
  candidate: { manifest: unknown; bindings: unknown },
): string[] {
  const files = {
    baselineManifest: path.join(directory, "baseline-manifest.json"),
    baselineBindings: path.join(directory, "baseline-bindings.json"),
    candidateManifest: path.join(directory, "candidate-manifest.json"),
    candidateBindings: path.join(directory, "candidate-bindings.json"),
  };
  fs.writeFileSync(files.baselineManifest, JSON.stringify(baseline.manifest));
  fs.writeFileSync(files.baselineBindings, JSON.stringify(baseline.bindings));
  fs.writeFileSync(files.candidateManifest, JSON.stringify(candidate.manifest));
  fs.writeFileSync(files.candidateBindings, JSON.stringify(candidate.bindings));
  return [
    "--baseline-manifest",
    files.baselineManifest,
    "--baseline-bindings",
    files.baselineBindings,
    "--candidate-manifest",
    files.candidateManifest,
    "--candidate-bindings",
    files.candidateBindings,
  ];
}

function createResult(input: QloraPromotionInput) {
  const { identities, powerAnalysis, bootstrapSeed, results } = input;
  const result = evaluateConditionalQloraPromotion(input);
  return {
    manifest: result.manifest,
    bindings: { identities, powerAnalysis, bootstrapSeed },
  };
}

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qlora-manifest-compare-"));
try {
  const baseline = createResult(makeInput());
  const sameContractCandidate = createResult(makeInput());
  const report = compareQloraManifestFiles(
    writeComparisonFiles(directory, baseline, sameContractCandidate),
  );
  assert.match(report, /Compatibility: COMPATIBLE/);
  assert.match(report, /Frozen identities \(0\)/);
  assert.match(report, /Aggregate metrics \(0\)/);
  assert.match(report, /Limitations\n  none/);

  const incompatibleCandidate = createResult(makeInput(digest("0")));
  const incompatibleReport = compareQloraManifestFiles(
    writeComparisonFiles(directory, baseline, incompatibleCandidate),
  );
  assert.match(incompatibleReport, /Compatibility: INCOMPATIBLE/);
  assert.match(incompatibleReport, /Frozen identities \(1\)/);
  assert.match(incompatibleReport, /identities\.candidate\.modelSha256/);
  assert.match(incompatibleReport, /Limitations\n  - frozen QLoRA identities differ/);

  const malformedManifest = {
    ...baseline.manifest as Record<string, unknown>,
    caseRows: [{ caseId: "private-case-identifier" }],
    providerPayload: "private-provider-payload",
  };
  const malformedArgs = writeComparisonFiles(directory, {
    ...baseline,
    manifest: malformedManifest,
  }, sameContractCandidate);
  assert.throws(
    () => compareQloraManifestFiles(malformedArgs),
    (error: unknown) => {
      assert.match(String(error), /unsupported metadata fields/);
      assert.doesNotMatch(String(error), /private-case-identifier|private-provider-payload/);
      return true;
    },
  );

  const parseErrorArgs = writeComparisonFiles(directory, baseline, sameContractCandidate);
  const candidateManifestPath = parseErrorArgs[5];
  fs.writeFileSync(candidateManifestPath, '{"private-provider-payload": "must-not-echo",');
  assert.throws(
    () => compareQloraManifestFiles(parseErrorArgs),
    (error: unknown) => {
      assert.match(String(error), /invalid JSON in candidate manifest/);
      assert.doesNotMatch(String(error), /must-not-echo/);
      return true;
    },
  );
  assert.throws(
    () => compareQloraManifestFiles(["--baseline-manifest", "only-one-file"]),
    /usage:/,
  );
  console.log("QLoRA promotion manifest comparison CLI tests passed");
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}