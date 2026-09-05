import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ownedFields,
  parseReport,
  stable,
  verifySourceLibraryReconciliation,
} from "./verify-source-library-reconciliation.mts";

const reportPath = path.resolve(process.cwd(), "..", "attached_assets/source-library/audits/source-library-reconciliation-2026-08-26.json");
const reportBytes = fs.readFileSync(reportPath);
const report = parseReport(JSON.parse(reportBytes.toString("utf8")));
const queries: string[] = [];
const rootDir = path.resolve(new URL("../../", import.meta.url).pathname);
const verifierPath = path.resolve(
  new URL("./verify-source-library-reconciliation.mts", import.meta.url).pathname,
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
  if (text.includes("FROM brand_profiles")) return { rows: [] };
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
assert.equal(output.pendingRuns.stale, 0);
assert.equal(output.pendingRuns.inspected, 1);
assert.equal(output.pendingRuns.canonical, 1);
assert.equal(output.protectedHistory.references, 2);
assert.equal(output.stubs.canonicalExact, 3);
assert.equal(output.stubs.deletedExpected, 1);
assert.equal(output.stubs.remainingProtected, 2);
assert.equal(output.stubs.unexpectedlyRemaining, 0);
assert.doesNotMatch(JSON.stringify(output), /basha|pepperoni|bbq chicken/i);
assert.match(output.idempotencyFingerprint.value, /^[a-f0-9]{64}$/);
assert.ok(queries.length > 0);

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
    connect: async () => ({
      query,
      release() {},
    }),
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

function runVerifierCli(
  args: readonly string[],
  env: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [tsxPath, verifierPath, ...args], {
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

function assertBoundedCliEvidence(value: Record<string, unknown>) {
  assert.deepEqual(Object.keys(value).sort(), [
    "aliases",
    "failures",
    "idempotencyFingerprint",
    "marker",
    "ok",
    "pendingRuns",
    "pools",
    "profiles",
    "protectedHistory",
    "repairBoundary",
    "report",
    "stubs",
    "verifier",
  ]);
  assert.equal(value.verifier, "source-library-reconciliation");
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
} finally {
  await rm(cliRoot, { recursive: true, force: true });
}

console.log("Source library reconciliation verifier tests passed.");
