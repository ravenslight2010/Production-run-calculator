import fs from "node:fs";
import {
  compareEvaluationManifests,
  readEvaluationManifest,
} from "@workspace/ai-evaluation";

export function compareEvaluationFiles(
  baselinePath: string,
  candidatePath: string,
) {
  const read = (filePath: string) => {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    } catch (error) {
      throw new Error(
        `could not read evaluation manifest "${filePath}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  return compareEvaluationManifests(
    readEvaluationManifest(read(baselinePath)),
    readEvaluationManifest(read(candidatePath)),
  );
}

function usage(): never {
  throw new Error(
    "usage: compare-ai-evaluations <baseline.json> <candidate.json> [--human]",
  );
}

export function runComparisonCli(args: string[]): string {
  const human = args.includes("--human");
  const paths = args.filter((arg) => arg !== "--human");
  if (paths.length !== 2) usage();
  const comparison = compareEvaluationFiles(paths[0], paths[1]);
  if (!human) return `${JSON.stringify(comparison, null, 2)}\n`;

  const sections = [
    ["Identity", comparison.identityChanges],
    ["Metrics", comparison.metricChanges],
    ["Outcome", comparison.outcomeChanges],
  ] as const;
  const details = sections.flatMap(([label, changes]) => [
    `${label} (${changes.length})`,
    ...changes.map((change) =>
      `  ${change.path}: ${JSON.stringify(change.before)} -> ${JSON.stringify(change.after)}`
    ),
  ]);
  const limitations = comparison.limitations.length === 0
    ? []
    : ["Limitations", ...comparison.limitations.map((item) => `  ${item}`)];
  return `${comparison.summary}\n${[...limitations, ...details].join("\n")}\n`;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    process.stdout.write(runComparisonCli(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}