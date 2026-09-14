import fs from "node:fs";
import path from "node:path";

const SOURCE_EXTENSION = /\.(?:ts|mts)$/;
const TEST_SOURCE = /\.(?:test|spec)\.(?:ts|mts)$/;
const PRIVACY_TEST = /\.privacy\.(?:test|spec)\.(?:ts|mts)$/;
const EVALUATION_ENTRYPOINT_NAME = /(?:ai|benchmark|evaluation|reviewer)/i;
const JSON_SERIALIZATION = /JSON\.stringify\s*\(/;
const OUTPUT_SINK = /(?:writeFileSync|writeFile|stdout\.write)\s*\(/;
const RAW_SERIALIZATION =
  /JSON\.stringify\s*\(\s*(?:raw\w*|provider\w*|evaluation\w*|observations?|responses?)\s*[,)]/gi;

type Reporter = {
  source: string;
  projection: string;
  privacyTest: string;
};

type NonReporter = {
  source: string;
  reason: string;
};

export type RetentionCheckFailure = {
  file: string;
  reason: string;
};

function listSourceFiles(sourceDirectory: string): string[] {
  return fs.readdirSync(sourceDirectory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(sourceDirectory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(entryPath);
    if (
      entry.isFile() &&
      SOURCE_EXTENSION.test(entry.name) &&
      !TEST_SOURCE.test(entry.name)
    ) {
      return [entryPath];
    }
    return [];
  });
}

function isEvaluationArtifactEntrypoint(filePath: string, source: string): boolean {
  return (
    EVALUATION_ENTRYPOINT_NAME.test(path.basename(filePath)) &&
    JSON_SERIALIZATION.test(source) &&
    OUTPUT_SINK.test(source)
  );
}

function readRegistry(registryPath: string): {
  reporters: Reporter[];
  nonReporters: NonReporter[];
} {
  const parsed = JSON.parse(fs.readFileSync(registryPath, "utf8")) as {
    reporters?: unknown;
    nonReporters?: unknown;
  };
  if (!Array.isArray(parsed.reporters)) {
    throw new Error("evaluation reporter registry must contain a reporters array");
  }
  if (!Array.isArray(parsed.nonReporters)) {
    throw new Error("evaluation reporter registry must contain a nonReporters array");
  }
  return {
    reporters: parsed.reporters as Reporter[],
    nonReporters: parsed.nonReporters as NonReporter[],
  };
}

export function checkEvaluationReportRetention(
  sourceDirectory = path.resolve(import.meta.dirname),
  registryPath = path.join(sourceDirectory, "evaluation-reporters.json"),
): RetentionCheckFailure[] {
  const failures: RetentionCheckFailure[] = [];
  const { reporters, nonReporters } = readRegistry(registryPath);
  const sourceFiles = listSourceFiles(sourceDirectory);
  const candidates = new Set(
    sourceFiles
      .filter((filePath) =>
        isEvaluationArtifactEntrypoint(filePath, fs.readFileSync(filePath, "utf8")),
      )
      .map((filePath) => path.relative(sourceDirectory, filePath)),
  );
  const registeredSources = new Set(reporters.map((reporter) => reporter.source));
  const excludedSources = new Set(nonReporters.map((entry) => entry.source));
  const privacyTests = new Set<string>();

  for (const candidate of candidates) {
    if (!registeredSources.has(candidate) && !excludedSources.has(candidate)) {
      failures.push({
        file: candidate,
        reason: "evaluation artifact entrypoint must be registered in evaluation-reporters.json",
      });
    }
  }

  for (const entry of nonReporters) {
    if (
      typeof entry.source !== "string" ||
      typeof entry.reason !== "string" ||
      entry.reason.trim().length < 20
    ) {
      failures.push({
        file: "evaluation-reporters.json",
        reason: "every non-reporter classification requires a source and meaningful reason",
      });
    } else if (!candidates.has(entry.source)) {
      failures.push({
        file: entry.source,
        reason: "non-reporter classification is stale because the source is not a candidate",
      });
    }
  }

  for (const reporter of reporters) {
    if (
      typeof reporter.source !== "string" ||
      typeof reporter.projection !== "string" ||
      typeof reporter.privacyTest !== "string"
    ) {
      failures.push({
        file: "evaluation-reporters.json",
        reason: "every reporter requires source, projection, and privacyTest strings",
      });
      continue;
    }
    if (privacyTests.has(reporter.privacyTest)) {
      failures.push({
        file: reporter.source,
        reason: `privacy test must be unique to one reporter: ${reporter.privacyTest}`,
      });
    }
    privacyTests.add(reporter.privacyTest);

    const sourcePath = path.join(sourceDirectory, reporter.source);
    if (!fs.existsSync(sourcePath)) {
      failures.push({ file: reporter.source, reason: "registered reporter source does not exist" });
      continue;
    }
    const source = fs.readFileSync(sourcePath, "utf8");
    if (!candidates.has(reporter.source)) {
      failures.push({
        file: reporter.source,
        reason: "registered source is not an evaluation JSON artifact entrypoint",
      });
    }
    const projectionDefinition = new RegExp(
      `export\\s+(?:function|const)\\s+${reporter.projection}\\b`,
    );
    const projectionCall = new RegExp(`\\b${reporter.projection}\\s*\\(`, "g");
    if (
      !projectionDefinition.test(source) ||
      [...source.matchAll(projectionCall)].length < 2
    ) {
      failures.push({
        file: reporter.source,
        reason: `allowlisted projection ${reporter.projection} must be exported and used`,
      });
    }
    const rawMatches = [...source.matchAll(RAW_SERIALIZATION)].map((match) => match[0]);
    if (rawMatches.length > 0) {
      failures.push({
        file: reporter.source,
        reason: `raw evaluation/provider objects must not be serialized directly: ${rawMatches.join(", ")}`,
      });
    }

    if (!PRIVACY_TEST.test(reporter.privacyTest)) {
      failures.push({
        file: reporter.source,
        reason: "privacyTest must use the .privacy.test.ts/.mts naming convention",
      });
      continue;
    }
    const privacyTestPath = path.join(sourceDirectory, reporter.privacyTest);
    if (!fs.existsSync(privacyTestPath)) {
      failures.push({
        file: reporter.source,
        reason: `registered privacy test does not exist: ${reporter.privacyTest}`,
      });
      continue;
    }
    const privacyTest = fs.readFileSync(privacyTestPath, "utf8");
    const reporterImport = `./${reporter.source}`;
    for (const requiredText of [
      reporter.projection,
      reporterImport,
      "SYNTHETIC_BENCHMARK_PRIVACY_FIXTURES",
      "SYNTHETIC_BENCHMARK_SENSITIVE_MARKERS",
      'from "./benchmark-report-privacy.fixtures"',
      ".not.toContain(",
    ]) {
      if (!privacyTest.includes(requiredText)) {
        failures.push({
          file: reporter.source,
          reason: `${reporter.privacyTest} must exercise ${requiredText}`,
        });
      }
    }
  }

  return failures;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const failures = checkEvaluationReportRetention();
  if (failures.length > 0) {
    for (const failure of failures) {
      process.stderr.write(`${failure.file}: ${failure.reason}\n`);
    }
    process.exitCode = 1;
  } else {
    process.stdout.write("Evaluation report retention check passed.\n");
  }
}