import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkEvaluationReportRetention } from "./check-evaluation-report-retention.mts";

type FixtureReporter = {
  source: string;
  projection: string;
  privacyTest: string;
};

function privacyTest(source: string, projection: string) {
  return `
import { ${projection} } from "./${source}";
import {
  SYNTHETIC_BENCHMARK_PRIVACY_FIXTURES,
  SYNTHETIC_BENCHMARK_SENSITIVE_MARKERS,
} from "./benchmark-report-privacy.fixtures";
const serialized = JSON.stringify(${projection}(SYNTHETIC_BENCHMARK_PRIVACY_FIXTURES));
for (const marker of SYNTHETIC_BENCHMARK_SENSITIVE_MARKERS) {
  expect(serialized).not.toContain(marker);
}
`;
}

function withSources(
  sources: Record<string, string>,
  reporters: FixtureReporter[],
  run: (directory: string) => void,
  nonReporters: Array<{ source: string; reason: string }> = [],
) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "evaluation-retention-"));
  try {
    for (const [name, contents] of Object.entries(sources)) {
      const filePath = path.join(directory, name);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, contents);
    }
    fs.writeFileSync(
      path.join(directory, "evaluation-reporters.json"),
      JSON.stringify({ reporters, nonReporters }),
    );
    run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

const safeSource = `
import fs from "node:fs";
export function retainMetrics(input: unknown) { return { count: Number(input) }; }
const report = retainMetrics(1);
fs.writeFileSync("report.json", JSON.stringify(report));
`;
const safeReporter = {
  source: "safe-evaluation-report.mts",
  projection: "retainMetrics",
  privacyTest: "safe-evaluation-report.privacy.test.ts",
};

test("accepts an inventoried projection with an executed privacy-test name", () => {
  withSources(
    {
      [safeReporter.source]: safeSource,
      [safeReporter.privacyTest]: privacyTest(safeReporter.source, safeReporter.projection),
    },
    [safeReporter],
    (directory) => assert.deepEqual(checkEvaluationReportRetention(directory), []),
  );
});

test("rejects renamed and pre-serialized unregistered evaluation entrypoints", () => {
  withSources(
    {
      "gemini-benchmark.mts": `
import fs from "node:fs";
const payload = { private: true };
const serialized = JSON.stringify(payload);
fs.writeFileSync("report.json", serialized);
`,
    },
    [],
    (directory) => {
      assert.match(
        checkEvaluationReportRetention(directory)[0]?.reason ?? "",
        /must be registered/,
      );
    },
  );
});

for (const [description, serialization] of [
  ["direct", "JSON.stringify(providerResponse)"],
  ["aliased", "JSON.stringify(payload)"],
  ["chained alias", "JSON.stringify(output)"],
  ["destructured", "JSON.stringify(payload)"],
] as const) {
  test(`rejects ${description} raw provider serialization in a registered reporter`, () => {
    const setup = {
      direct: "const providerResponse = { private: true };",
      aliased:
        "const providerResponse = { private: true }; const payload = providerResponse;",
      "chained alias":
        "const providerResponse = { private: true }; const payload = providerResponse; const output = payload;",
      destructured:
        "const providerResponse = { payload: { private: true } }; const { payload } = providerResponse;",
    }[description];
    const unsafeSource = safeSource
      .replace("JSON.stringify(report)", serialization)
      .replace("const report = retainMetrics(1);", `const report = retainMetrics(1); ${setup}`);
    withSources(
      {
        [safeReporter.source]: unsafeSource,
        [safeReporter.privacyTest]: privacyTest(safeReporter.source, safeReporter.projection),
      },
      [safeReporter],
      (directory) => {
        assert.ok(
          checkEvaluationReportRetention(directory).some((failure) =>
            /must not be serialized directly/.test(failure.reason),
          ),
        );
      },
    );
  });
}

test("accepts a projected report derived from a raw provider value", () => {
  const projectedSource = safeSource.replace(
    "const report = retainMetrics(1);",
    "const providerResponse = { private: true }; const report = retainMetrics(providerResponse);",
  );
  withSources(
    {
      [safeReporter.source]: projectedSource,
      [safeReporter.privacyTest]: privacyTest(safeReporter.source, safeReporter.projection),
    },
    [safeReporter],
    (directory) => assert.deepEqual(checkEvaluationReportRetention(directory), []),
  );
});

test("rejects reused privacy tests", () => {
  const secondReporter = {
    source: "other-ai-report.mts",
    projection: "retainMetrics",
    privacyTest: safeReporter.privacyTest,
  };
  withSources(
    {
      [safeReporter.source]: safeSource,
      [secondReporter.source]: safeSource,
      [safeReporter.privacyTest]: privacyTest(safeReporter.source, safeReporter.projection),
    },
    [safeReporter, secondReporter],
    (directory) => {
      assert.ok(
        checkEvaluationReportRetention(directory).some((failure) =>
          /privacy test must be unique/.test(failure.reason),
        ),
      );
    },
  );
});

test("rejects privacy tests omitted from the executable glob convention", () => {
  const reporter = {
    ...safeReporter,
    privacyTest: "safe-evaluation-report.test.ts",
  };
  withSources(
    {
      [reporter.source]: safeSource,
      [reporter.privacyTest]: privacyTest(reporter.source, reporter.projection),
    },
    [reporter],
    (directory) => {
      assert.match(
        checkEvaluationReportRetention(directory)[0]?.reason ?? "",
        /privacyTest must use the \.privacy\.test/,
      );
    },
  );
});

test("rejects unrelated privacy tests that do not import the reporter projection", () => {
  withSources(
    {
      [safeReporter.source]: safeSource,
      [safeReporter.privacyTest]: `
import {
  SYNTHETIC_BENCHMARK_PRIVACY_FIXTURES,
  SYNTHETIC_BENCHMARK_SENSITIVE_MARKERS,
} from "./benchmark-report-privacy.fixtures";
for (const marker of SYNTHETIC_BENCHMARK_SENSITIVE_MARKERS) {
  expect(JSON.stringify({})).not.toContain(marker);
}
void SYNTHETIC_BENCHMARK_PRIVACY_FIXTURES;
`,
    },
    [safeReporter],
    (directory) => {
      const failures = checkEvaluationReportRetention(directory);
      assert.ok(failures.some((failure) => failure.reason.includes("retainMetrics")));
      assert.ok(failures.some((failure) => failure.reason.includes("./safe-evaluation-report.mts")));
    },
  );
});