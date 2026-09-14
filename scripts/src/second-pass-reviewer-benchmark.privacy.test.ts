import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SYNTHETIC_BENCHMARK_PRIVACY_FIXTURES,
  SYNTHETIC_BENCHMARK_SENSITIVE_MARKERS,
} from "./benchmark-report-privacy.fixtures";
import {
  OPERATION_FINDINGS,
  evaluateReviewerEvidence,
  writeReviewerBenchmarkReport,
} from "./second-pass-reviewer-benchmark.mts";

const EMPTY_FINDINGS = {
  wrongQuantities: [],
  missingComponents: [],
  extraComponents: [],
  duplicateComponents: [],
  wrongNamesOrLinks: [],
  allZeroStubs: [],
  unmatchedSourceRecipes: [],
  unmatchedLiveRecipes: [],
  duplicateRecipes: [],
};

function observationsWithSensitivePayloads(): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.keys(OPERATION_FINDINGS).map((operation) => [
      operation,
      {
        cases: 0,
        materialCases: 0,
        nonMaterialCases: 0,
        providerCalls: 0,
        reviewerFailures: 0,
        duplicateWarnings: 0,
        falseWarnings: 0,
        falseRejects: 0,
        noOpVerdicts: 0,
        latencyMs: 0,
        inputTokens: null,
        outputTokens: null,
        ...SYNTHETIC_BENCHMARK_PRIVACY_FIXTURES,
        rawProviderResponse: SYNTHETIC_BENCHMARK_PRIVACY_FIXTURES.providerPayload,
      },
    ]),
  );
}

const RETAINED_OBSERVATION_FIELDS = [
  "cases",
  "materialCases",
  "nonMaterialCases",
  "providerCalls",
  "reviewerFailures",
  "duplicateWarnings",
  "falseWarnings",
  "falseRejects",
  "noOpVerdicts",
  "latencyMs",
  "inputTokens",
  "outputTokens",
] as const;

describe("retained reviewer benchmark privacy boundary", () => {
  it("retains only aggregate metrics from observations", () => {
    const report = evaluateReviewerEvidence(
      EMPTY_FINDINGS,
      observationsWithSensitivePayloads(),
    );

    for (const observation of Object.values(
      report.measuredEffects.observationsByOperation,
    )) {
      expect(Object.keys(observation).sort()).toEqual(
        [...RETAINED_OBSERVATION_FIELDS].sort(),
      );
    }
  });

  it("does not serialize synthetic personal, source, credential, conversation, or provider content", () => {
    const serialized = JSON.stringify(
      evaluateReviewerEvidence(
        {
          ...EMPTY_FINDINGS,
          unmatchedSourceRecipes: [SYNTHETIC_BENCHMARK_PRIVACY_FIXTURES],
        },
        {
          ...observationsWithSensitivePayloads(),
          "match-premix": {
            ...observationsWithSensitivePayloads()["match-premix"],
            cases: 1,
            nonMaterialCases: 1,
          },
        },
      ),
    );

    for (const marker of SYNTHETIC_BENCHMARK_SENSITIVE_MARKERS) {
      expect(serialized).not.toContain(marker);
    }
    expect(serialized.length).toBeLessThan(10_000);
  });

  it("rejects sensitive or malformed values hidden in every allowlisted metric", () => {
    const sensitiveValues = Object.values(SYNTHETIC_BENCHMARK_PRIVACY_FIXTURES);
    for (const [index, field] of RETAINED_OBSERVATION_FIELDS.entries()) {
      for (const sensitiveValue of sensitiveValues) {
        const observations = observationsWithSensitivePayloads();
        observations["parse-spec-sheet"][field] = sensitiveValue;
        expect(
          () => evaluateReviewerEvidence(EMPTY_FINDINGS, observations),
          `${field} fixture ${index}`,
        ).toThrow(/reviewer observation metric/);
      }
    }
  });

  it("does not create or overwrite a report when parsed metrics are unsafe", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "reviewer-privacy-"));
    const sourcePath = path.join(
      root,
      "attached_assets/source-library/audits/source-library-reconciliation-2026-08-26.json",
    );
    const observationsPath = path.join(
      root,
      "docs/second-pass-reviewer-live-observations-2026-09-05.json",
    );
    const target = path.join(root, "retained-report.json");
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.mkdirSync(path.dirname(observationsPath), { recursive: true });
    const sourceBytes = JSON.stringify({ findings: EMPTY_FINDINGS });
    fs.writeFileSync(sourcePath, sourceBytes);
    const observations = observationsWithSensitivePayloads();
    observations["parse-spec-sheet"].providerCalls =
      SYNTHETIC_BENCHMARK_PRIVACY_FIXTURES.providerPayload;
    fs.writeFileSync(
      observationsPath,
      JSON.stringify({
        sourceHash: createHash("sha256").update(sourceBytes).digest("hex"),
        operations: observations,
      }),
    );
    fs.writeFileSync(target, "existing safe report\n");

    try {
      expect(() => writeReviewerBenchmarkReport(target, root)).toThrow(
        /providerCalls must be a non-negative safe integer/,
      );
      expect(fs.readFileSync(target, "utf8")).toBe("existing safe report\n");
      fs.rmSync(target);
      expect(() => writeReviewerBenchmarkReport(target, root)).toThrow(
        /providerCalls must be a non-negative safe integer/,
      );
      expect(fs.existsSync(target)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});