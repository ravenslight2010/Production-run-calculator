import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertBoundedSourceLibraryReconciliationEvidence,
  DEFAULT_SOURCE_LIBRARY_POOL_EXCEPTIONS,
  assertProductionSourceLibraryCapture,
  DEFAULT_FROM_DATE,
  DEFAULT_HEAL_ID,
  DEFAULT_REPORT,
  parseReport,
  loadSourceLibraryPoolExceptionApproval,
  parseSourceLibraryEvidenceEnvironment,
  preflightSourceLibraryReconciliation,
  resolveSourceLibraryDatabaseOwner,
  resolveSourceLibraryRevision,
  runSourceLibraryReadOnlyCheck,
  verifySourceLibraryReconciliation,
} from "./verify-source-library-reconciliation.mts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function argument(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function outputPathArgument(): string | undefined {
  const value = argument("--output");
  return value ? path.resolve(process.cwd(), value) : undefined;
}

function writeOutput(outputPath: string | undefined, output: unknown): void {
  if (outputPath) {
    fs.writeFileSync(outputPath, `${JSON.stringify(output)}\n`, "utf8");
  }
}

function dateFromHealId(healId: string): string | undefined {
  const match = healId.match(/(?:^|-)((?:20)\d{2}-\d{2}-\d{2})(?:-|$)/);
  return match?.[1];
}

async function main(): Promise<void> {
  const reportArgument = argument("--report");
  const reportPath = reportArgument
    ? path.resolve(process.cwd(), reportArgument)
    : path.resolve(ROOT, DEFAULT_REPORT);
  const healId = argument("--heal-id", DEFAULT_HEAL_ID)!;
  const fromDate = argument("--from-date", dateFromHealId(healId) ?? DEFAULT_FROM_DATE)!;
  const environmentArgument = argument(
    "--environment",
    process.env.SOURCE_LIBRARY_RECONCILIATION_ENVIRONMENT,
  );
  if (environmentArgument === undefined) {
    throw new Error(
      "Missing --environment; choose development or release so source-library evidence cannot be compared across databases",
    );
  }
  const environment = parseSourceLibraryEvidenceEnvironment(environmentArgument);
  const captureProduction = process.argv.includes("--capture-production");
  const revisionArgumentProvided = process.argv.includes("--revision");
  const deploymentHandoffArgumentProvided =
    process.argv.includes("--deployment-handoff");
  const configuredRevisionArgument =
    argument("--revision", process.env.SOURCE_LIBRARY_RECONCILIATION_REVISION);
  const configuredDatabaseOwner = argument(
    "--database-owner",
    process.env.SOURCE_LIBRARY_RECONCILIATION_DATABASE_OWNER,
  );
  const deploymentHandoffPath = argument(
    "--deployment-handoff",
    process.env.SOURCE_LIBRARY_RECONCILIATION_DEPLOYMENT_HANDOFF,
  );
  const databaseOwner = resolveSourceLibraryDatabaseOwner(
    configuredDatabaseOwner,
    deploymentHandoffPath,
  );
  const revision = resolveSourceLibraryRevision(
    environment,
    configuredRevisionArgument,
    deploymentHandoffPath,
  );
  const outputPath = outputPathArgument();
  const preflightOnly = process.argv.includes("--preflight");
  if (captureProduction) {
    assertProductionSourceLibraryCapture({
      environmentArgument,
      configuredRevision: configuredRevisionArgument,
      revisionArgumentProvided,
      deploymentHandoffArgumentProvided,
      deploymentHandoffPath,
      outputPath,
      preflight: preflightOnly,
      configuredDatabaseOwner: databaseOwner,
      environment: process.env,
    });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(fromDate)) {
    throw new Error("Invalid --from-date; expected YYYY-MM-DD");
  }

  const reportBytes = fs.readFileSync(reportPath);
  const report = parseReport(JSON.parse(reportBytes.toString("utf8")));
  const explicitPoolExceptionsPath = argument("--pool-exceptions");
  const poolExceptionsPath =
    explicitPoolExceptionsPath ??
    (environment === "release" &&
    reportPath === path.resolve(ROOT, DEFAULT_REPORT)
      ? DEFAULT_SOURCE_LIBRARY_POOL_EXCEPTIONS
      : undefined);
  const poolExceptionApproval =
    !preflightOnly && poolExceptionsPath !== undefined
      ? loadSourceLibraryPoolExceptionApproval(poolExceptionsPath, reportBytes)
      : undefined;
  const { pool } = await import("@workspace/db");
  if (preflightOnly) {
    const output = await runSourceLibraryReadOnlyCheck(
      pool,
      true,
      (query) =>
        preflightSourceLibraryReconciliation(
          report,
          reportBytes,
          healId,
          query,
          environment,
          revision,
          databaseOwner,
        ),
    );
    writeOutput(outputPath, output);
    process.stdout.write(`${JSON.stringify(output)}\n`);
    if (!output.ok) process.exitCode = 1;
    return;
  }

  const output = await runSourceLibraryReadOnlyCheck(
    pool,
    false,
    (query) =>
      verifySourceLibraryReconciliation(
        report,
        reportBytes,
        healId,
        query,
        fromDate,
        environment,
        revision,
        databaseOwner,
        undefined,
        poolExceptionApproval,
      ),
  );
  assertBoundedSourceLibraryReconciliationEvidence(output);
  writeOutput(outputPath, output);
  process.stdout.write(`${JSON.stringify(output)}\n`);
  if (!output.ok) process.exitCode = 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main().catch((error) => {
    const environmentIndex = process.argv.indexOf("--environment");
    const requestedEnvironment =
      environmentIndex >= 0 && process.argv[environmentIndex + 1]
        ? process.argv[environmentIndex + 1]
        : process.env.SOURCE_LIBRARY_RECONCILIATION_ENVIRONMENT;
    const revisionIndex = process.argv.indexOf("--revision");
    const requestedRevision =
      revisionIndex >= 0 && process.argv[revisionIndex + 1]
        ? process.argv[revisionIndex + 1]
        : process.env.SOURCE_LIBRARY_RECONCILIATION_REVISION;
    const output = {
      verifier: process.argv.includes("--preflight")
        ? "source-library-reconciliation-preflight"
        : "source-library-reconciliation",
      environment: requestedEnvironment ?? "unknown",
      revision: requestedRevision ?? "unknown",
      capturedAt: new Date().toISOString(),
      ok: false,
      failures: [{ check: "input-or-database", count: 1 }],
      error: error instanceof Error ? error.message : "Verification failed",
    };
    const outputArgument = process.argv.indexOf("--output");
    const outputPath =
      outputArgument >= 0 && process.argv[outputArgument + 1]
        ? path.resolve(process.cwd(), process.argv[outputArgument + 1])
        : undefined;
    // A failed production capture is not evidence. In particular, do not leave
    // a failure-shaped JSON file for the importer or release checker to treat
    // as a retained artifact. Development verifier failures still write their
    // bounded diagnostic because the fixture tests use that output to explain
    // a failed gate.
    if (outputPath && !process.argv.includes("--capture-production")) {
      try {
        fs.writeFileSync(outputPath, `${JSON.stringify(output)}\n`, "utf8");
      } catch {
        // Preserve the original verifier error on stdout/stderr if evidence
        // cannot be written; the release gate still fails closed.
      }
    }
    process.stdout.write(`${JSON.stringify(output)}\n`);
    process.exitCode = 1;
  });
}
