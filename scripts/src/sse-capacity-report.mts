import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { captureReleaseIdentity } from "./release-source-identity.mjs";
import {
  buildSseCapacityReport,
  parseSseCapacityInputs,
} from "./sse-capacity-report-core.mts";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const MAX_PLATFORM_BYTES = 32_000;

function parseArgs(args: string[]) {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const values = new Map<string, string>();
  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const key = normalizedArgs[index];
    if (key === "--help" || key === "-h") return { help: true as const };
    if (key !== "--samples" && key !== "--platform" && key !== "--output") {
      throw new Error("Use --samples, --platform, and optional --output.");
    }
    const value = normalizedArgs[index + 1];
    if (!value || value.startsWith("--") || values.has(key)) {
      throw new Error("Each report argument needs one unique value.");
    }
    values.set(key, value);
    index += 1;
  }
  const samples = values.get("--samples");
  const platform = values.get("--platform");
  if (!samples || !platform) throw new Error("Both --samples and --platform are required.");
  return { help: false as const, samples, platform, output: values.get("--output") };
}

function safeOutputPath(value: string | undefined, now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const candidate = path.resolve(
    PROJECT_ROOT,
    value ?? `docs/evidence/sse-capacity-report-${stamp}.json`,
  );
  const evidenceRoot = path.resolve(PROJECT_ROOT, "docs/evidence") + path.sep;
  if (!candidate.startsWith(evidenceRoot)) {
    throw new Error("Report output must be inside docs/evidence.");
  }
  return candidate;
}

async function readLimited(filePath: string, maximumBytes: number, label: string): Promise<string> {
  const absolute = path.resolve(PROJECT_ROOT, filePath);
  let bytes: Buffer;
  try {
    bytes = await readFile(absolute);
  } catch {
    throw new Error(`${label} file could not be read.`);
  }
  if (bytes.byteLength > maximumBytes) throw new Error(`${label} exceeds its size limit.`);
  return bytes.toString("utf8");
}

export async function runSseCapacityReport(args: string[], now = new Date()): Promise<string> {
  const options = parseArgs(args);
  if (options.help) {
    return [
      "Build a sanitized, revision-bound capacity report without database writes.",
      "Usage: pnpm --filter @workspace/scripts run sse-capacity-report --",
      "  --samples <database_capacity_sample-jsonl>",
      "  --platform <platform-metrics-json>",
      "  [--output docs/evidence/report.json]",
    ].join("\n");
  }
  const logText = await readLimited(options.samples, 16 * 1024 * 1024, "Capacity logs");
  const platformJson = await readLimited(options.platform, MAX_PLATFORM_BYTES, "Platform metrics");
  const parsed = parseSseCapacityInputs(platformJson, logText);
  let identity: ReturnType<typeof captureReleaseIdentity>;
  try {
    identity = captureReleaseIdentity(PROJECT_ROOT);
  } catch {
    throw new Error("Local report source identity could not be computed.");
  }
  const report = buildSseCapacityReport({
    ...parsed,
    revision: {
      assessmentRevision: identity.revision,
      sourceRevision: identity.sourceRevision,
      verificationFingerprintSha256: identity.verificationFingerprintSha256,
    },
    generatedAtUtc: now.toISOString(),
  });
  const outputPath = safeOutputPath(options.output, now);
  try {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  } catch {
    throw new Error("Report could not be written; check the evidence path and whether it already exists.");
  }
  return path.relative(PROJECT_ROOT, outputPath);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runSseCapacityReport(process.argv.slice(2));
    console.log(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    console.error(`SSE capacity report failed: ${message}`);
    process.exitCode = 1;
  }
}
