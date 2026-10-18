import fs from "node:fs";
import {
  compareQloraPromotionResultManifests,
  type QloraPromotionResultManifestBindings,
} from "@workspace/ai-evaluation";

type ComparisonFiles = {
  baselineManifest: string;
  baselineBindings: string;
  candidateManifest: string;
  candidateBindings: string;
};

const OPTIONS = [
  "--baseline-manifest",
  "--baseline-bindings",
  "--candidate-manifest",
  "--candidate-bindings",
] as const;

function usage(): never {
  throw new Error(
    "usage: qlora:compare-manifests --baseline-manifest <file> --baseline-bindings <file> --candidate-manifest <file> --candidate-bindings <file>",
  );
}

function parseArguments(args: string[]): ComparisonFiles {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (!OPTIONS.includes(option as (typeof OPTIONS)[number]) || values.has(option)) {
      usage();
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) usage();
    values.set(option, value);
    index += 1;
  }
  if (values.size !== OPTIONS.length) usage();
  return {
    baselineManifest: values.get("--baseline-manifest")!,
    baselineBindings: values.get("--baseline-bindings")!,
    candidateManifest: values.get("--candidate-manifest")!,
    candidateBindings: values.get("--candidate-bindings")!,
  };
}

function readJsonFile(filePath: string, label: string): unknown {
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    throw new Error(`could not read ${label} file "${filePath}"`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Do not include parser diagnostics, which can contain snippets of input.
    throw new Error(`invalid JSON in ${label} file "${filePath}"`);
  }
}

export function compareQloraManifestFiles(args: string[]): string {
  const files = parseArguments(args);
  const comparison = compareQloraPromotionResultManifests(
    {
      manifest: readJsonFile(files.baselineManifest, "baseline manifest"),
      bindings: readJsonFile(
        files.baselineBindings,
        "baseline bindings",
      ) as QloraPromotionResultManifestBindings,
    },
    {
      manifest: readJsonFile(files.candidateManifest, "candidate manifest"),
      bindings: readJsonFile(
        files.candidateBindings,
        "candidate bindings",
      ) as QloraPromotionResultManifestBindings,
    },
  );

  const categories = [
    ["Frozen identities", comparison.identityChanges],
    ["Power analysis", comparison.powerAnalysisChanges],
    ["Bootstrap contract", comparison.bootstrapChanges],
    ["Aggregate metrics", comparison.aggregateMetricChanges],
    ["Safety gates", comparison.safetyGateChanges],
    ["Decision", comparison.decisionChanges],
  ] as const;
  const lines = [
    `Compatibility: ${comparison.compatible ? "COMPATIBLE" : "INCOMPATIBLE"}`,
    comparison.summary,
    "",
    "Limitations",
    ...(comparison.limitations.length === 0
      ? ["  none"]
      : comparison.limitations.map((limitation) => `  - ${limitation}`)),
  ];
  for (const [label, changes] of categories) {
    lines.push("", `${label} (${changes.length})`);
    if (changes.length === 0) {
      lines.push("  no changes");
      continue;
    }
    for (const change of changes) {
      lines.push(
        `  ${change.path}: ${JSON.stringify(change.before)} -> ${JSON.stringify(change.after)}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    process.stdout.write(compareQloraManifestFiles(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "QLoRA manifest comparison failed"}\n`,
    );
    process.exitCode = 1;
  }
}