import { createHash } from "node:crypto";
import { lstat, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateSourceLibraryReconciliationEvidence } from "./release-check.mts";
import {
  assertBoundedSourceLibraryReconciliationEvidence,
  resolveSourceLibraryRevision,
} from "./verify-source-library-reconciliation.mts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MAX_AGE_MS = 24 * 60 * 60 * 1_000;

export type SourceLibraryEvidenceImportOptions = {
  input: string;
  output: string;
  report: string;
  healId: string;
  fromDate: string;
  revision?: string;
  deploymentHandoffPath?: string;
  now?: Date;
};

function argument(name: string, fallback?: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : fallback;
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

async function readInput(input: string): Promise<Buffer> {
  if (input !== "-") {
    const stats = await lstat(input);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error("Imported source-library evidence must be a regular file.");
    }
    return readFile(input);
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function importSourceLibraryReconciliationEvidence(
  options: SourceLibraryEvidenceImportOptions,
): Promise<void> {
  const input = path.resolve(process.cwd(), options.input);
  const output = path.resolve(process.cwd(), options.output);
  const report = path.resolve(process.cwd(), options.report);
  const { healId, fromDate } = options;
  if (!/^[a-z0-9][a-z0-9-]{2,127}$/u.test(healId)) {
    throw new Error("Invalid --heal-id.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(fromDate)) {
    throw new Error("Invalid --from-date; expected YYYY-MM-DD.");
  }
  const healDate = healId.match(/(?:^|-)((?:20)\d{2}-\d{2}-\d{2})(?:-|$)/u)?.[1];
  if (healDate !== undefined && healDate !== fromDate) {
    throw new Error("--from-date must match the dated heal identity.");
  }
  const revision = resolveSourceLibraryRevision(
    "release",
    options.revision,
    options.deploymentHandoffPath,
    options.now,
  );

  const [evidenceBytes, reportBytes] = await Promise.all([
    readInput(options.input === "-" ? "-" : input),
    readFile(report),
  ]);
  let parsedEvidence: unknown;
  try {
    parsedEvidence = JSON.parse(new TextDecoder().decode(evidenceBytes));
  } catch {
    throw new Error(
      "Source-library reconciliation evidence is not valid JSON.",
    );
  }
  assertBoundedSourceLibraryReconciliationEvidence(parsedEvidence);
  validateSourceLibraryReconciliationEvidence(evidenceBytes, {
    expectedEnvironment: "release",
    expectedRevision: revision,
    expectedHealId: healId,
    expectedFromDate: fromDate,
    expectedReportSha256: createHash("sha256").update(reportBytes).digest("hex"),
    maxAgeMs: MAX_AGE_MS,
    now: options.now,
  });

  const temporary = `${output}.importing`;
  await rm(temporary, { force: true });
  await writeFile(temporary, evidenceBytes, { mode: 0o600 });
  await rename(temporary, output);
  console.log(
    `Imported fresh production source-library evidence for revision ${revision}.`,
  );
}

async function main(): Promise<void> {
  const optionalArgument = (
    name: string,
    fallback?: string,
  ): string | undefined => {
    const index = process.argv.indexOf(name);
    if (index < 0) return fallback;
    const value = process.argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${name}`);
    }
    return value;
  };
  await importSourceLibraryReconciliationEvidence({
    input: argument("--input"),
    output: argument("--output"),
    report: argument("--report"),
    healId: argument("--heal-id"),
    fromDate: argument("--from-date"),
    revision: optionalArgument(
      "--revision",
      process.env.SOURCE_LIBRARY_RECONCILIATION_REVISION,
    ),
    deploymentHandoffPath: optionalArgument(
      "--deployment-handoff",
      process.env.SOURCE_LIBRARY_RECONCILIATION_DEPLOYMENT_HANDOFF,
    ),
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Source-library evidence import failed.",
    );
    process.exit(1);
  });
}