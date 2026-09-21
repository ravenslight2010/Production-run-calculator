import { describe, expect, it } from "vitest";
import * as GeneratedApi from "./generated/api";
import {
  OperationsAnomalyDetectionResponse,
  OperationsIncidentPatternsResponse,
  OperationsMixReconciliationResponse,
  OperationsRecapResponse,
  OperationsScheduleOrderingResponse,
  OperationsSpecReconciliationResponse,
} from "./generated/api";

type GeneratedOrderViolation = {
  constantName: string;
  constantLine: number;
  validatorName: string;
  validatorLine: number;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function assertScalarConstraintsPrecedeValidators(
  source: string,
  sourceName = "generated/api.ts",
): void {
  const lines = source.split("\n");
  const scalarConstraints = new Map<string, number>();
  const validatorStarts: Array<{ name: string; line: number }> = [];

  for (const [index, line] of lines.entries()) {
    const scalarConstraint = line.match(
      /^export const ([a-z][A-Za-z0-9]*) = (?!zod\.).+;$/,
    );
    if (scalarConstraint) {
      scalarConstraints.set(scalarConstraint[1], index);
    }

    const validator = line.match(
      /^export const ([A-Z][A-Za-z0-9]*) = zod\./,
    );
    if (validator) {
      validatorStarts.push({ name: validator[1], line: index });
    }
  }

  const violations: GeneratedOrderViolation[] = [];
  for (const validator of validatorStarts) {
    const nextExport = lines.findIndex(
      (line, index) => index > validator.line && /^export const /.test(line),
    );
    const end = nextExport === -1 ? lines.length : nextExport;
    const validatorSource = lines
      .slice(validator.line, end)
      .join("\n");

    for (const [constantName, constantLine] of scalarConstraints) {
      if (
        constantLine > validator.line &&
        new RegExp(`\\b${escapeRegExp(constantName)}\\b`).test(validatorSource)
      ) {
        violations.push({
          constantName,
          constantLine,
          validatorName: validator.name,
          validatorLine: validator.line,
        });
      }
    }
  }

  if (violations.length > 0) {
    const details = violations
      .map(
        ({
          constantName,
          constantLine,
          validatorName,
          validatorLine,
        }) =>
          `- ${constantName} (line ${constantLine + 1}) is declared after ` +
          `${validatorName} (line ${validatorLine + 1})`,
      )
      .join("\n");
    throw new Error(
      `Generated Zod scalar constraint declarations must precede the ` +
        `validators that use them in ${sourceName}:\n${details}`,
    );
  }
}

async function readGeneratedApiSource(): Promise<string> {
  const env = (
    globalThis as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env;
  const generatedApiPath = env?.GENERATED_API_SOURCE ?? "src/generated/api.ts";

  // The package deliberately omits Node typings from its TypeScript config.
  // Vitest still runs in Node, so keep this test-only import dynamic.
  // @ts-expect-error -- node:fs is available at test runtime.
  const { readFileSync } = await import("node:fs");
  return readFileSync(generatedApiPath, "utf8");
}

describe("generated Zod schema runtime contracts", () => {
  it("declares scalar constraints before validators that use them", async () => {
    assertScalarConstraintsPrecedeValidators(await readGeneratedApiSource());
  });

  it("reports the constraint and validator when declaration order breaks", () => {
    const invalidSource = [
      "import * as zod from 'zod';",
      "export const BrokenBody = zod.object({",
      "  value: zod.string().max(brokenBodyValueMax)",
      "})",
      "export const brokenBodyValueMax = 20;",
    ].join("\n");

    expect(() =>
      assertScalarConstraintsPrecedeValidators(invalidSource, "fixture.ts"),
    ).toThrow(/brokenBodyValueMax.*BrokenBody/);
  });

  it("keeps Operations Insights deterministic response contracts valid", () => {
    expect(
      OperationsRecapResponse.parse({
        summary: "Production recap",
        stats: {
          scope: "day",
          date: "2026-08-26",
          runsPlanned: 0,
          runsFinished: 0,
          casesPlanned: 0,
          casesProduced: 0,
          attainmentPct: 0,
          totalDowntimeMinutes: 0,
          totalStoppages: 0,
          unfinishedRuns: [],
          incidentCount: 0,
          wasteFlaggedCount: 0,
          hasData: false,
        },
        generatedAt: 1,
      }).summary,
    ).toBe("Production recap");

    expect(
      OperationsAnomalyDetectionResponse.parse({
        anomalies: [],
        checkedRuns: 0,
        baselineRuns: 0,
        summary: "",
        generatedAt: 1,
      }).anomalies,
    ).toEqual([]);

    expect(
      OperationsScheduleOrderingResponse.parse({
        order: [],
        changed: false,
        improved: false,
        before: { allergenViolations: 0, ruleViolations: 0, changeovers: 0 },
        after: { allergenViolations: 0, ruleViolations: 0, changeovers: 0 },
        summary: "",
        generatedAt: 1,
      }).improved,
    ).toBe(false);

    expect(
      OperationsSpecReconciliationResponse.parse({
        specSheetId: 1,
        discrepancies: [],
        generatedAt: 1,
      }).discrepancies,
    ).toEqual([]);

    expect(
      OperationsMixReconciliationResponse.parse({
        discrepancies: [],
        generatedAt: 1,
      }).discrepancies,
    ).toEqual([]);

    expect(
      OperationsIncidentPatternsResponse.parse({
        clusters: [],
        totalIncidents: 0,
        generatedAt: 1,
      }).clusters,
    ).toEqual([]);
  });

  it("publishes permanent operation names without legacy AI contract names", () => {
    expect("OperationsSpecReconciliationBody" in GeneratedApi).toBe(true);
    expect("OperationsMixReconciliationBody" in GeneratedApi).toBe(true);
    expect("OperationsIncidentPatternsBody" in GeneratedApi).toBe(true);
    expect("AiSpecReconcileBody" in GeneratedApi).toBe(false);
    expect("AiMixReconcileBody" in GeneratedApi).toBe(false);
    expect("AiSummaryBody" in GeneratedApi).toBe(false);
    expect("AiAnomaliesBody" in GeneratedApi).toBe(false);
    expect("AiScheduleOptimizeBody" in GeneratedApi).toBe(false);
    expect("AiIncidentClustersBody" in GeneratedApi).toBe(false);
  });

  it("does not publish retired conversation-history schemas", () => {
    expect("ConversationHistory" in GeneratedApi).toBe(false);
    expect("AppendConversationInput" in GeneratedApi).toBe(false);
    expect("ConversationTurn" in GeneratedApi).toBe(false);
  });
});