import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ownedFields,
  parseReport,
  preflightSourceLibraryReconciliation,
  resolveSourceLibraryRevision,
  assertProductionSourceLibraryCapture,
  assertBoundedSourceLibraryReconciliationEvidence,
  isRetryableSourceLibraryDatabaseError,
  SOURCE_LIBRARY_PREFLIGHT_DB_ATTEMPTS,
  stable,
  verifySourceLibraryReconciliation,
} from "./verify-source-library-reconciliation.mts";
import {
  RELEASE_PREFLIGHT_DB_ATTEMPTS,
  RELEASE_PREFLIGHT_RETRY_DELAYS_MS,
  runReleasePreflightDatabaseRetry,
} from "./release-preflight-db-retry.mts";

const reportPath = path.resolve(process.cwd(), "..", "attached_assets/source-library/audits/source-library-reconciliation-2026-08-26.json");
const reportBytes = fs.readFileSync(reportPath);
const report = parseReport(JSON.parse(reportBytes.toString("utf8")));
const queries: string[] = [];
const rootDir = path.resolve(new URL("../../", import.meta.url).pathname);
const verifierPath = path.resolve(
  new URL("./verify-source-library-reconciliation.mts", import.meta.url).pathname,
);
const importerPath = path.resolve(
  new URL("./import-source-library-reconciliation-evidence.mts", import.meta.url).pathname,
);
const tsxPath = path.resolve(rootDir, "scripts/node_modules/tsx/dist/cli.mjs");

assert.equal(report.proposals.length, 68);
assert.equal(report.findings.allZeroStubs.length, 3);
assert.equal(stable({ b: 2, a: 1 }), stable({ a: 1, b: 2 }));
const mixWithNotes = report.proposals.find((proposal) =>
  proposal.classification === "automatic" &&
  proposal.action === "replace-components-from-approved-source" &&
  proposal.table === "mixes" &&
  Object.prototype.hasOwnProperty.call(proposal.after, "notes"));
const mixWithoutNotes = report.proposals.find((proposal) =>
  proposal.classification === "automatic" &&
  proposal.action === "replace-components-from-approved-source" &&
  proposal.table === "mixes" &&
  !Object.prototype.hasOwnProperty.call(proposal.after, "notes"));
assert.ok(mixWithNotes);
assert.ok(mixWithoutNotes);
assert.ok(Object.prototype.hasOwnProperty.call(ownedFields(mixWithNotes as any), "notes"));
assert.ok(!Object.prototype.hasOwnProperty.call(ownedFields(mixWithoutNotes as any), "notes"));
assert.ok(!Object.prototype.hasOwnProperty.call(ownedFields(mixWithNotes as any), "batchSize"));
assert.ok(!Object.prototype.hasOwnProperty.call(ownedFields(mixWithoutNotes as any), "batchSize"));
assert.equal(
  resolveSourceLibraryRevision("release", "a".repeat(40)),
  "a".repeat(40),
);
assert.throws(
  () => resolveSourceLibraryRevision("release", undefined),
  /exact deployed 40-character Git commit SHA/,
);
assert.throws(
  () => resolveSourceLibraryRevision("release", "unknown"),
  /full 40-character Git commit SHA/,
);
assert.equal(isRetryableSourceLibraryDatabaseError({ code: "ETIMEDOUT" }), true);
assert.equal(
  isRetryableSourceLibraryDatabaseError(new Error("timeout exceeded when trying to connect")),
  true,
);
assert.equal(isRetryableSourceLibraryDatabaseError({ code: "23505" }), false);
assert.equal(isRetryableSourceLibraryDatabaseError(new Error("query failed")), false);
assert.equal(SOURCE_LIBRARY_PREFLIGHT_DB_ATTEMPTS, RELEASE_PREFLIGHT_DB_ATTEMPTS);
{
  let attempts = 0;
  const waits: number[] = [];
  const result = await runReleasePreflightDatabaseRetry(
    async () => {
      attempts += 1;
      if (attempts < RELEASE_PREFLIGHT_DB_ATTEMPTS) {
        throw { code: "ETIMEDOUT" };
      }
      return "recovered";
    },
    { sleep: async (milliseconds) => {
      waits.push(milliseconds);
    } },
  );
  assert.equal(result, "recovered");
  assert.equal(attempts, RELEASE_PREFLIGHT_DB_ATTEMPTS);
  assert.deepEqual(waits, [...RELEASE_PREFLIGHT_RETRY_DELAYS_MS]);
}
{
  let attempts = 0;
  await assert.rejects(
    runReleasePreflightDatabaseRetry(async () => {
      attempts += 1;
      throw { code: "23505" };
    }, { sleep: async () => {
      throw new Error("non-retryable errors must not sleep");
    } }),
    { code: "23505" },
  );
  assert.equal(attempts, 1);
}
assert.doesNotThrow(() =>
  assertProductionSourceLibraryCapture({
    environmentArgument: "release",
    configuredRevision: "a".repeat(40),
    revisionArgumentProvided: true,
    outputPath: undefined,
    preflight: false,
    environment: { DATABASE_URL: "postgresql://production.example/app" },
  }),
);
assert.throws(
  () =>
    assertProductionSourceLibraryCapture({
      environmentArgument: "development",
      configuredRevision: "a".repeat(40),
      revisionArgumentProvided: true,
      outputPath: undefined,
      preflight: false,
      environment: { DATABASE_URL: "postgresql://production.example/app" },
    }),
  /explicit --environment release/,
);
assert.throws(
  () =>
    assertProductionSourceLibraryCapture({
      environmentArgument: "release",
      configuredRevision: "a".repeat(40),
      revisionArgumentProvided: true,
      outputPath: undefined,
      preflight: false,
      environment: {
        DATABASE_URL: "postgresql://production.example/app",
        SOURCE_LIBRARY_VERIFIER_QUERY_FIXTURE: "/tmp/fixture.json",
      },
    }),
  /refuses SOURCE_LIBRARY_VERIFIER_QUERY_FIXTURE/,
);
assert.throws(
  () =>
    assertProductionSourceLibraryCapture({
      environmentArgument: "release",
      configuredRevision: "a".repeat(40),
      revisionArgumentProvided: true,
      outputPath: undefined,
      preflight: true,
      environment: { DATABASE_URL: "postgresql://production.example/app" },
    }),
  /does not support --preflight/,
);
assert.throws(
  () =>
    assertProductionSourceLibraryCapture({
      environmentArgument: "release",
      configuredRevision: "a".repeat(40),
      revisionArgumentProvided: false,
      outputPath: undefined,
      preflight: false,
      environment: { DATABASE_URL: "postgresql://production.example/app" },
    }),
  /requires --revision on the command line/,
);

const rowsByTable = new Map<string, Array<Record<string, unknown>>>();
for (const proposal of report.proposals) {
  const table = String(proposal.table);
  const row = {
    id: (proposal.before as Record<string, unknown>).id,
    name: (proposal.before as Record<string, unknown>).name,
    ...ownedFields(proposal as any),
  };
  rowsByTable.set(table, [...(rowsByTable.get(table) ?? []), row]);
}

const stubs = report.findings.allZeroStubs as Array<Record<string, unknown>>;
const pendingCanonical = String(stubs[0].canonicalName);
const protectedStub = String(stubs[1].name);
const historicalStub = String(stubs[2].name);
const identityReplacement = report.proposals.find((proposal) =>
  proposal.action === "replace-components-from-approved-source"
) as Record<string, unknown>;
const identityReplacementName = String(
  (identityReplacement.before as Record<string, unknown>).name,
);
const dailyRunReferences: Array<Record<string, unknown>> = [
  {
    date: "2026-08-26",
    run_id: "pending",
    started: false,
    field: "app1CheeseRecipeName",
    value: pendingCanonical,
  },
  {
    date: "2026-08-26",
    run_id: "started",
    started: true,
    field: "app1CheeseRecipeName",
    value: protectedStub,
  },
  {
    date: "2026-08-25",
    run_id: "historical",
    started: false,
    field: "app1CheeseRecipeName",
    value: historicalStub,
  },
];

const query = async (text: string, values?: readonly unknown[]) => {
  queries.push(text);
  assert.doesNotMatch(text, /\b(?:insert|update|delete|truncate|alter|drop|create)\b/i);
  if (text.includes("FROM data_heals")) {
    return {
      rows: [{
        appliedAt: new Date("2026-08-26T01:00:00.000Z"),
        result: { replacements: 0, aliasesInserted: 0, repointedProfiles: 0, repointedRuns: 0, deletedStubs: 0 },
      }],
    };
  }
  if (text.includes("FROM brand_profiles")) {
    return {
      rows: [{
        key: "identity-replacement-reference",
        v_app1CheeseRecipeName: identityReplacementName,
      }],
    };
  }
  if (text.includes("FROM daily_sync")) return { rows: dailyRunReferences };
  if (text.includes("FROM spec_import_aliases")) {
    const expected = (values?.[0] as string[]) ?? [];
    return {
      rows: expected.map((external) => {
        const proposal = report.proposals.find((candidate) =>
          candidate.action === "link-source-identity" &&
          String((candidate.after as Record<string, unknown>).sourceName).trim().toLowerCase() === external.trim().toLowerCase(),
        );
        const stub = report.findings.allZeroStubs.find((candidate) =>
          String((candidate as Record<string, unknown>).name).trim().toLowerCase() === external.trim().toLowerCase(),
        ) as Record<string, unknown> | undefined;
        return {
          external,
          canonical: proposal
            ? (proposal.before as Record<string, unknown>).name
            : stub?.canonicalName,
        };
      }),
    };
  }
  if (text.startsWith("SELECT id, name, components FROM cheese_recipes")) {
    return {
      rows: [
        ...stubs.map((stub) => ({
          id: stub.canonicalId,
          name: stub.canonicalName,
          components: [{ lbs: 1 }],
        })),
        {
          id: stubs[1].id,
          name: stubs[1].name,
          components: [],
        },
        {
          id: stubs[2].id,
          name: stubs[2].name,
          components: [{ lbs: 1 }],
        },
      ],
    };
  }
  for (const table of ["dough_recipes", "sauce_recipes", "cheese_recipes", "mixes"]) {
    if (text.includes(`FROM ${table}`)) return { rows: rowsByTable.get(table) ?? [] };
  }
  throw new Error(`Unhandled query: ${text}`);
};

const output = await verifySourceLibraryReconciliation(
  report,
  reportBytes,
  "source-library-reconciliation-2026-08-26-v1",
  query,
);

assert.equal(output.ok, true);
assert.equal(output.pools.exactMatches, 68);
assert.equal(output.aliases.expected, 25);
assert.equal(output.aliases.exactMatches, 25);
assert.equal(output.profiles.inspected, 0);
assert.equal(output.pendingRuns.stale, 0);
assert.equal(output.pendingRuns.inspected, 1);
assert.equal(output.pendingRuns.canonical, 1);
assert.equal(output.protectedHistory.references, 2);
assert.equal(output.stubs.canonicalExact, 3);
assert.equal(output.stubs.deletedExpected, 1);
assert.equal(output.stubs.remainingProtected, 2);
assert.equal(output.stubs.unexpectedlyRemaining, 0);
assert.doesNotMatch(JSON.stringify(output), /basha|pepperoni|bbq chicken/i);
assert.doesNotMatch(
  JSON.stringify(output),
  /Basha Garlic Recipe|Pepperoni Ingredient|sourceRows/i,
  "captured evidence must not retain representative source-row details",
);
assert.throws(
  () =>
    assertBoundedSourceLibraryReconciliationEvidence({
      ...output,
      sourceRows: [{
        recipeName: "Basha Garlic Recipe",
        ingredient: "Pepperoni Ingredient",
      }],
    }),
  /bounded allowlist/,
  "source-row payloads must be rejected by the evidence contract",
);
assert.match(output.idempotencyFingerprint.value, /^[a-f0-9]{64}$/);
assert.ok(queries.length > 0);

const preflight = await preflightSourceLibraryReconciliation(
  report,
  reportBytes,
  "source-library-reconciliation-2026-08-26-v1",
  query,
  "development",
  "development-unbound",
);
assert.equal(preflight.ok, true);
assert.equal(preflight.database, "approved-matching");
assert.deepEqual(preflight.expected, { poolRows: 68, aliases: 25 });
assert.deepEqual(preflight.observed, {
  poolRows: 68,
  aliasesExact: 25,
  aliasesMissing: 0,
  aliasesMismatched: 0,
  markerPresent: true,
  markerValid: true,
});
assert.deepEqual(preflight.failures, []);
assert.doesNotMatch(
  JSON.stringify(preflight),
  /Replacement \d|Canonical (?:Link|Stub)|Legacy (?:Link|Stub)|components|sourceName/i,
);

const partialPreflight = await preflightSourceLibraryReconciliation(
  report,
  reportBytes,
  "source-library-reconciliation-2026-08-26-v1",
  async (text, values) => {
    if (text.includes("FROM mixes")) return { rows: [] };
    return query(text, values);
  },
  "development",
  "development-unbound",
);
assert.equal(partialPreflight.ok, false);
assert.equal(partialPreflight.database, "partial-fixture");
assert.deepEqual(partialPreflight.failures, [{
  check: "databaseShape",
  count: report.proposals.filter((proposal) => proposal.table === "mixes").length,
}]);

const mutableMixRow = rowsByTable.get("mixes")!.find((row) =>
  row.id === (mixWithNotes.before as Record<string, unknown>).id);
assert.ok(mutableMixRow);
mutableMixRow.batchSize = 12345;
const batchSizeDriftOutput = await verifySourceLibraryReconciliation(
  report,
  reportBytes,
  "source-library-reconciliation-2026-08-26-v1",
  query,
);
assert.equal(batchSizeDriftOutput.ok, true);
assert.equal(batchSizeDriftOutput.pools.mismatches, 0);

const sourceComponents = mutableMixRow.components;
mutableMixRow.components = [{ ingredient: "component drift", perPizza: 1 }];
const componentDriftOutput = await verifySourceLibraryReconciliation(
  report,
  reportBytes,
  "source-library-reconciliation-2026-08-26-v1",
  query,
);
assert.equal(componentDriftOutput.ok, false);
assert.equal(componentDriftOutput.pools.mismatches, 1);
assert.deepEqual(componentDriftOutput.failures, [{ check: "pools", count: 1 }]);
mutableMixRow.components = sourceComponents;

dailyRunReferences[0].value = String(stubs[0].name);
const stalePendingOutput = await verifySourceLibraryReconciliation(
  report,
  reportBytes,
  "source-library-reconciliation-2026-08-26-v1",
  query,
);
assert.equal(stalePendingOutput.ok, false);
assert.equal(stalePendingOutput.pendingRuns.stale, 1);
assert.equal(stalePendingOutput.protectedHistory.references, 2);
assert.equal(stalePendingOutput.stubs.remainingProtected, 2);
assert.deepEqual(stalePendingOutput.failures, [{ check: "pendingRuns", count: 1 }]);
assert.doesNotMatch(JSON.stringify(stalePendingOutput), /basha|pepperoni|bbq chicken/i);

type CliScenario = "pass" | "pending" | "protected";
type CliQueryFixture = {
  poolRows: Record<string, Array<Record<string, unknown>>>;
  stubRows: Array<Record<string, unknown>>;
  profileRows: Array<Record<string, unknown>>;
  dailyRunRows: Array<Record<string, unknown>>;
  aliasRows: Array<Record<string, unknown>>;
  markerRows: Array<Record<string, unknown>>;
};

function createCliFixture(scenario: CliScenario): {
  reportBytes: Buffer;
  fixture: CliQueryFixture;
} {
  const proposals = [
    ...Array.from({ length: 46 }, (_, index) => ({
      classification: "automatic" as const,
      action: "replace-components-from-approved-source" as const,
      table: (["dough_recipes", "sauce_recipes", "cheese_recipes", "mixes"] as const)[index % 4],
      before: { id: `replacement-${index}`, name: `Replacement ${index}` },
      after: { components: [] },
    })),
    ...Array.from({ length: 22 }, (_, index) => ({
      classification: "automatic" as const,
      action: "link-source-identity" as const,
      table: "cheese_recipes" as const,
      before: { id: `link-${index}`, name: `Canonical Link ${index}` },
      after: { sourceName: `Legacy Link ${index}` },
    })),
  ];
  const stubs = [
    {
      table: "cheese_recipes" as const,
      id: "stub-deleted",
      name: "Legacy Stub Deleted",
      canonicalId: "canonical-deleted",
      canonicalName: "Canonical Stub Deleted",
    },
    {
      table: "cheese_recipes" as const,
      id: "stub-protected",
      name: "Legacy Stub Protected",
      canonicalId: "canonical-protected",
      canonicalName: "Canonical Stub Protected",
    },
    {
      table: "cheese_recipes" as const,
      id: "stub-unused",
      name: "Legacy Stub Unused",
      canonicalId: "canonical-unused",
      canonicalName: "Canonical Stub Unused",
    },
  ];
  const report = {
    format: "source-library-reconciliation" as const,
    formatVersion: 1 as const,
    snapshot: {
      path: "snapshot.json",
      sha256: "a".repeat(64),
      capturedAt: "2026-08-26T00:00:00.000Z",
    },
    manifest: {
      path: "manifest.json",
      sha256: "b".repeat(64),
      retained: 1,
      excludedOlderDuplicates: 0,
    },
    proposals,
    findings: { allZeroStubs: stubs },
  };
  const reportBytes = Buffer.from(`${JSON.stringify(report)}\n`);
  const poolRows: CliQueryFixture["poolRows"] = {
    dough_recipes: [],
    sauce_recipes: [],
    cheese_recipes: [],
    mixes: [],
  };
  for (const proposal of proposals) {
    const table = proposal.table;
    poolRows[table].push({
      id: proposal.before.id,
      name: proposal.before.name,
      components: [],
    });
  }
  const canonicalStubRows = stubs.map((stub) => ({
    id: stub.canonicalId,
    name: stub.canonicalName,
    components: [{ lbs: 1 }],
  }));
  const stubRows = canonicalStubRows.concat({
    id: stubs[1].id,
    name: stubs[1].name,
    components: [{ lbs: 1 }],
  });
  const dailyRunRows = scenario === "pending"
    ? [{
      date: "2026-08-26",
      run_id: "pending-run",
      started: false,
      field: "app1CheeseRecipeName",
      value: "Legacy Link 0",
    }]
    : scenario === "protected"
      ? [{
        date: "2026-08-26",
        run_id: "started-run",
        started: true,
        field: "app1CheeseRecipeName",
        value: stubs[0].name,
      }]
      : [];
  const aliasRows = [
    ...Array.from({ length: 22 }, (_, index) => ({
      external: `Legacy Link ${index}`,
      canonical: `Canonical Link ${index}`,
    })),
    ...stubs.map((stub) => ({
      external: stub.name,
      canonical: stub.canonicalName,
    })),
  ];
  return {
    reportBytes,
    fixture: {
      poolRows,
      stubRows,
      profileRows: [],
      dailyRunRows,
      aliasRows,
      markerRows: [{
        appliedAt: "2026-08-26T01:00:00.000Z",
        result: {
          replacements: 0,
          aliasesInserted: 0,
          repointedProfiles: 0,
          repointedRuns: 0,
          deletedStubs: 0,
        },
      }],
    },
  };
}

const cliDbLoader = `
import fs from "node:fs";

const databaseModule = \`
  import fs from "node:fs";

  const fixture = JSON.parse(
    fs.readFileSync(process.env.SOURCE_LIBRARY_VERIFIER_QUERY_FIXTURE, "utf8"),
  );
  const query = async (text) => {
    if (text.startsWith("BEGIN TRANSACTION READ ONLY") || text === "ROLLBACK") {
      return { rows: [] };
    }
    if (text.includes("FROM data_heals")) return { rows: fixture.markerRows };
    if (text.includes("FROM brand_profiles")) return { rows: fixture.profileRows };
    if (text.includes("FROM daily_sync")) return { rows: fixture.dailyRunRows };
    if (text.includes("FROM spec_import_aliases")) return { rows: fixture.aliasRows };
    if (text.startsWith("SELECT id, name, components FROM cheese_recipes")) {
      return { rows: fixture.stubRows };
    }
    for (const table of ["dough_recipes", "sauce_recipes", "cheese_recipes", "mixes"]) {
      if (text.includes("FROM " + table)) return { rows: fixture.poolRows[table] ?? [] };
    }
    throw new Error("Unhandled verifier fixture query: " + text);
  };

  export const pool = {
    connect: async () => {
      const failures = Number(process.env.SOURCE_LIBRARY_VERIFIER_CONNECT_FAILURES ?? "0");
      const attempt = Number(process.env.SOURCE_LIBRARY_VERIFIER_CONNECT_ATTEMPTS ?? "0");
      process.env.SOURCE_LIBRARY_VERIFIER_CONNECT_ATTEMPTS = String(attempt + 1);
      if (attempt < failures) {
        const error = new Error("timeout exceeded when trying to connect");
        error.code = "ETIMEDOUT";
        throw error;
      }
      return {
        query,
        release() {},
      };
    },
  };
\`;
const databaseUrl = "data:text/javascript," + encodeURIComponent(databaseModule);

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@workspace/db") {
    return { url: databaseUrl, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
`;

function runScriptCli(
  scriptPath: string,
  args: readonly string[],
  env: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [tsxPath, scriptPath, ...args], {
      cwd: rootDir,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code) =>
      resolveRun({ code: code ?? 1, stdout, stderr }),
    );
  });
}

function runVerifierCli(
  args: readonly string[],
  env: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return runScriptCli(verifierPath, args, env);
}

function assertBoundedCliEvidence(value: Record<string, unknown>) {
  assert.deepEqual(Object.keys(value).sort(), [
    "aliases",
    "capturedAt",
    "environment",
    "evidenceId",
    "failures",
    "healId",
    "idempotencyFingerprint",
    "marker",
    "ok",
    "pendingRuns",
    "pools",
    "profiles",
    "protectedHistory",
    "repairBoundary",
    "report",
    "revision",
    "stubs",
    "verifier",
  ]);
  assert.equal(value.verifier, "source-library-reconciliation");
  assert.equal(value.environment, "development");
  const expectedSummaryKeys: Record<string, string[]> = {
    repairBoundary: ["fromDate"],
    marker: [
      "appliedAtPresent",
      "present",
      "resultCounts",
      "resultValid",
      "resultWithinBounds",
    ],
    pools: ["exactMatches", "expected", "guardedRenames", "mismatches", "missing"],
    aliases: ["exactMatches", "expected", "mismatches", "missing"],
    profiles: ["canonical", "inspected", "nonCanonical", "stale"],
    pendingRuns: ["canonical", "inspected", "nonCanonical", "stale"],
    protectedHistory: ["references"],
    stubs: [
      "canonicalExact",
      "canonicalMismatches",
      "canonicalMissing",
      "deletedExpected",
      "expected",
      "remainingProtected",
      "unexpectedlyDeleted",
      "unexpectedlyRemaining",
    ],
  };
  for (const [key, keys] of Object.entries(expectedSummaryKeys)) {
    assert.deepEqual(
      Object.keys(value[key] as object).sort(),
      [...keys].sort(),
      `${key} evidence must remain summary-only`,
    );
  }
  assert.deepEqual(
    Object.keys((value.marker as Record<string, unknown>).resultCounts as object).sort(),
    [
      "aliasesInserted",
      "deletedStubs",
      "repointedProfiles",
      "repointedRuns",
      "replacements",
    ].sort(),
  );
  const failures = value.failures as Array<Record<string, unknown>>;
  if (failures.length > 0) {
    assert.deepEqual(Object.keys(failures[0]).sort(), ["check", "count"]);
  }
  assert.deepEqual(Object.keys(value.report as object).sort(), [
    "automaticProposals",
    "formatVersion",
    "sha256",
    "stubs",
  ]);
  assert.deepEqual(Object.keys(value.idempotencyFingerprint as object).sort(), [
    "algorithm",
    "value",
  ]);
  assert.doesNotMatch(
    JSON.stringify(value),
    /Replacement \d|Canonical (?:Link|Stub)|Legacy (?:Link|Stub)|components|sourceName|snapshot\.json|manifest\.json/i,
    "retained CLI evidence must not contain recipe payloads or source paths",
  );
}

const cliRoot = await mkdtemp(path.join(tmpdir(), "source-library-verifier-cli-"));
try {
  const loaderPath = path.join(cliRoot, "db-loader.mjs");
  await writeFile(loaderPath, cliDbLoader, "utf8");
  for (const scenario of ["pass", "pending", "protected"] as const) {
    const { reportBytes: cliReportBytes, fixture } = createCliFixture(scenario);
    const reportFixturePath = path.join(cliRoot, `${scenario}-report.json`);
    const queryFixturePath = path.join(cliRoot, `${scenario}-queries.json`);
    const outputPath = path.join(cliRoot, `${scenario}-output.json`);
    await writeFile(reportFixturePath, cliReportBytes);
    await writeFile(queryFixturePath, JSON.stringify(fixture));
    const result = await runVerifierCli(
      [
        "--report",
        reportFixturePath,
        "--heal-id",
        "source-library-reconciliation-2026-08-26-v1",
        "--from-date",
        "2026-08-26",
        "--environment",
        "development",
        "--output",
        outputPath,
      ],
      {
        SOURCE_LIBRARY_VERIFIER_QUERY_FIXTURE: queryFixturePath,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --loader=${loaderPath}`.trim(),
      },
    );
    assert.equal(
      result.code,
      scenario === "pass" ? 0 : 1,
      `${scenario} CLI verifier exit status\n${result.stdout}\n${result.stderr}`,
    );
    const retained = JSON.parse(await readFile(outputPath, "utf8")) as Record<string, unknown>;
    assertBoundedCliEvidence(retained);
    assert.equal(retained.ok, scenario === "pass");
    assert.deepEqual(
      retained.failures,
      scenario === "pass"
        ? []
        : [{
          check: scenario === "pending" ? "pendingRuns" : "protectedStubs",
          count: 1,
        }],
    );
    assert.equal(
      JSON.stringify(retained),
      result.stdout.trim(),
      `${scenario} CLI stdout and retained evidence should match`,
    );
  }
  const preflightFixture = createCliFixture("pass");
  const preflightReportPath = path.join(cliRoot, "preflight-report.json");
  const preflightQueriesPath = path.join(cliRoot, "preflight-queries.json");
  const preflightOutputPath = path.join(cliRoot, "preflight-output.json");
  await writeFile(preflightReportPath, preflightFixture.reportBytes);
  await writeFile(
    preflightQueriesPath,
    JSON.stringify(preflightFixture.fixture),
  );
  const preflightResult = await runVerifierCli(
    [
      "--report",
      preflightReportPath,
      "--heal-id",
      "source-library-reconciliation-2026-08-26-v1",
      "--from-date",
      "2026-08-26",
      "--environment",
      "development",
      "--preflight",
      "--output",
      preflightOutputPath,
    ],
    {
      SOURCE_LIBRARY_VERIFIER_QUERY_FIXTURE: preflightQueriesPath,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --loader=${loaderPath}`.trim(),
    },
  );
  assert.equal(preflightResult.code, 0, preflightResult.stderr);
  const preflightOutput = JSON.parse(
    await readFile(preflightOutputPath, "utf8"),
  ) as Record<string, unknown>;
  assert.equal(
    preflightOutput.verifier,
    "source-library-reconciliation-preflight",
  );
  assert.equal(preflightOutput.database, "approved-matching");
  assert.equal(preflightOutput.ok, true);
  assert.equal(
    JSON.stringify(preflightOutput),
    preflightResult.stdout.trim(),
    "preflight stdout and retained diagnostic should match",
  );

  const recoveredPreflightOutputPath = path.join(cliRoot, "recovered-preflight-output.json");
  const recoveredPreflightResult = await runVerifierCli(
    [
      "--report",
      preflightReportPath,
      "--heal-id",
      "source-library-reconciliation-2026-08-26-v1",
      "--from-date",
      "2026-08-26",
      "--environment",
      "development",
      "--revision",
      "a".repeat(40),
      "--preflight",
      "--output",
      recoveredPreflightOutputPath,
    ],
    {
      SOURCE_LIBRARY_VERIFIER_QUERY_FIXTURE: preflightQueriesPath,
      SOURCE_LIBRARY_VERIFIER_CONNECT_FAILURES: "1",
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --loader=${loaderPath}`.trim(),
    },
  );
  assert.equal(recoveredPreflightResult.code, 0, recoveredPreflightResult.stderr);
  const recoveredPreflightOutput = JSON.parse(
    await readFile(recoveredPreflightOutputPath, "utf8"),
  ) as Record<string, unknown>;
  assert.equal(recoveredPreflightOutput.ok, true);
  assert.equal(recoveredPreflightOutput.revision, "a".repeat(40));
  assert.equal(
    JSON.stringify(recoveredPreflightOutput),
    recoveredPreflightResult.stdout.trim(),
    "a recovered preflight must retain the requested release revision",
  );

  const exhaustedPreflightOutputPath = path.join(cliRoot, "exhausted-preflight-output.json");
  const exhaustedPreflightResult = await runVerifierCli(
    [
      "--report",
      preflightReportPath,
      "--heal-id",
      "source-library-reconciliation-2026-08-26-v1",
      "--from-date",
      "2026-08-26",
      "--environment",
      "development",
      "--revision",
      "b".repeat(40),
      "--preflight",
      "--output",
      exhaustedPreflightOutputPath,
    ],
    {
      SOURCE_LIBRARY_VERIFIER_QUERY_FIXTURE: preflightQueriesPath,
      SOURCE_LIBRARY_VERIFIER_CONNECT_FAILURES: "3",
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --loader=${loaderPath}`.trim(),
    },
  );
  assert.equal(exhaustedPreflightResult.code, 1);
  assert.match(exhaustedPreflightResult.stdout, /"revision":"b{40}"/);
  assert.match(exhaustedPreflightResult.stdout, /timeout exceeded when trying to connect/);
  assert.equal(fs.existsSync(exhaustedPreflightOutputPath), true);
  const exhaustedPreflightOutput = JSON.parse(
    await readFile(exhaustedPreflightOutputPath, "utf8"),
  ) as Record<string, unknown>;
  assert.equal(exhaustedPreflightOutput.ok, false);
  assert.equal(exhaustedPreflightOutput.revision, "b".repeat(40));
  assert.match(String(exhaustedPreflightOutput.error), /timeout exceeded when trying to connect/);

  const partialFixture = createCliFixture("pass");
  partialFixture.fixture.poolRows.mixes.pop();
  const partialReportPath = path.join(cliRoot, "partial-report.json");
  const partialQueriesPath = path.join(cliRoot, "partial-queries.json");
  const partialOutputPath = path.join(cliRoot, "partial-output.json");
  await writeFile(partialReportPath, partialFixture.reportBytes);
  await writeFile(partialQueriesPath, JSON.stringify(partialFixture.fixture));
  const partialResult = await runVerifierCli(
    [
      "--report",
      partialReportPath,
      "--heal-id",
      "source-library-reconciliation-2026-08-26-v1",
      "--from-date",
      "2026-08-26",
      "--environment",
      "development",
      "--preflight",
      "--output",
      partialOutputPath,
    ],
    {
      SOURCE_LIBRARY_VERIFIER_QUERY_FIXTURE: partialQueriesPath,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --loader=${loaderPath}`.trim(),
    },
  );
  assert.equal(partialResult.code, 1);
  const partialOutput = JSON.parse(
    await readFile(partialOutputPath, "utf8"),
  ) as Record<string, unknown>;
  assert.equal(partialOutput.database, "partial-fixture");
  assert.equal(partialOutput.ok, false);

  const failedCaptureOutputPath = path.join(cliRoot, "failed-production-capture.json");
  const failedImportOutputPath = path.join(cliRoot, "failed-production-import.json");
  const failedCaptureResult = await runVerifierCli(
    [
      "--report",
      reportPath,
      "--heal-id",
      "source-library-reconciliation-2026-08-26-v1",
      "--from-date",
      "2026-08-26",
      "--capture-production",
      "--environment",
      "release",
      "--revision",
      "a".repeat(40),
      "--output",
      failedCaptureOutputPath,
    ],
    { DATABASE_URL: "" },
  );
  assert.equal(failedCaptureResult.code, 1);
  assert.match(
    failedCaptureResult.stdout,
    /requires DATABASE_URL for the read-only production database/,
  );
  assert.equal(
    fs.existsSync(failedCaptureOutputPath),
    false,
    "a failed production capture must not create an evidence file",
  );

  const failedImportResult = await runScriptCli(
    importerPath,
    [
      "--input",
      failedCaptureOutputPath,
      "--output",
      failedImportOutputPath,
      "--report",
      reportPath,
      "--heal-id",
      "source-library-reconciliation-2026-08-26-v1",
      "--from-date",
      "2026-08-26",
      "--revision",
      "a".repeat(40),
    ],
    {},
  );
  assert.equal(failedImportResult.code, 1);
  assert.equal(
    fs.existsSync(failedImportOutputPath),
    false,
    "the importer must not create retained evidence when capture input is absent",
  );
} finally {
  await rm(cliRoot, { recursive: true, force: true });
}

console.log("Source library reconciliation verifier tests passed.");
