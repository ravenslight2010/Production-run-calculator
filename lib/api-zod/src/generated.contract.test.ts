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
  sourceName: string;
  constantName: string;
  constantLine: number;
  validatorName: string;
  validatorLine: number;
};

type GeneratedZodSource = {
  sourceName: string;
  source: string;
};

type GeneratedDirectoryEntry = {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findScalarConstraintViolations(
  { source, sourceName }: GeneratedZodSource,
): GeneratedOrderViolation[] {
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
          sourceName,
          constantName,
          constantLine,
          validatorName: validator.name,
          validatorLine: validator.line,
        });
      }
    }
  }

  return violations;
}

export function assertGeneratedZodSourcesHaveSafeDeclarationOrder(
  sources: readonly GeneratedZodSource[],
): void {
  const violations = sources.flatMap(findScalarConstraintViolations);

  if (violations.length > 0) {
    const details = violations
      .map(
        ({
          sourceName,
          constantName,
          constantLine,
          validatorName,
          validatorLine,
        }) =>
          `- ${constantName} (line ${constantLine + 1}) is declared after ` +
          `${validatorName} (line ${validatorLine + 1}) in ${sourceName}`,
      )
      .join("\n");
    throw new Error(
      `Generated Zod scalar constraint declarations must precede the ` +
        `validators that use them:\n${details}`,
    );
  }
}

export function assertScalarConstraintsPrecedeValidators(
  source: string,
  sourceName = "generated/api.ts",
): void {
  assertGeneratedZodSourcesHaveSafeDeclarationOrder([{ source, sourceName }]);
}

async function readGeneratedZodSources(): Promise<GeneratedZodSource[]> {
  const env = (
    globalThis as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env;
  const generatedRoot = env?.GENERATED_ZOD_SOURCE_ROOT ?? "src/generated";

  // The package deliberately omits Node typings from its TypeScript config.
  // Vitest still runs in Node, so keep this test-only import dynamic.
  // @ts-expect-error -- node:fs is available at test runtime.
  const { readdirSync, readFileSync } = await import("node:fs");
  // @ts-expect-error -- node:path is available at test runtime.
  const { join, relative } = await import("node:path");
  const sources: GeneratedZodSource[] = [];

  const visit = (directory: string): void => {
    const entries = readdirSync(directory, {
      withFileTypes: true,
    }) as GeneratedDirectoryEntry[];
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        sources.push({
          sourceName: relative(generatedRoot, entryPath),
          source: readFileSync(entryPath, "utf8"),
        });
      }
    }
  };

  visit(generatedRoot);
  return sources;
}

describe("generated Zod schema runtime contracts", () => {
  it("declares scalar constraints before validators that use them", async () => {
    assertGeneratedZodSourcesHaveSafeDeclarationOrder(
      await readGeneratedZodSources(),
    );
  });

  it("reports the constraint and validator from a split generated file", () => {
    const invalidSources = [
      {
        sourceName: "types/brokenValidator.ts",
        source: [
          "import * as zod from 'zod';",
          "export const BrokenBody = zod.object({",
          "  value: zod.string().max(brokenBodyValueMax)",
          "})",
          "export const brokenBodyValueMax = 20;",
        ].join("\n"),
      },
      {
        sourceName: "types/unrelated.ts",
        source: "export interface Unrelated { value: string; }",
      },
    ];

    expect(() =>
      assertGeneratedZodSourcesHaveSafeDeclarationOrder(invalidSources),
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