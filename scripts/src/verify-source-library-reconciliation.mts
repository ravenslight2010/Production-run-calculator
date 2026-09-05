/**
 * Read-only verification for the approved source-library reconciliation heal.
 *
 * This command deliberately does not use the application's write-capable
 * routes or Drizzle mutations. It opens a PostgreSQL transaction declared
 * READ ONLY, selects only report-owned fields, and rolls the transaction back.
 * Output is JSON only so the result can be retained by release automation.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_REPORT = "attached_assets/source-library/audits/source-library-reconciliation-2026-08-26.json";
const DEFAULT_HEAL_ID = "source-library-reconciliation-2026-08-26-v1";
const DEFAULT_FROM_DATE = "2026-08-26";
const SOURCE_LINK_FIELDS = [
  "doughRecipeName",
  "frontlineRecipeName",
  "app1CheeseRecipeName",
  "app2CheeseRecipeName",
  "app3CheeseRecipeName",
  "app4CheeseRecipeName",
] as const;
const TABLES = ["dough_recipes", "sauce_recipes", "cheese_recipes", "mixes"] as const;
type RecipeTable = (typeof TABLES)[number];
type QueryResult = { rows: Array<Record<string, unknown>> };
export type ReadOnlyQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResult>;

type Proposal = {
  classification: "automatic";
  action: "replace-components-from-approved-source" | "link-source-identity";
  table: RecipeTable;
  before: { id: string; name: string };
  after: Record<string, unknown>;
};
type Stub = {
  table: "cheese_recipes";
  id: string;
  name: string;
  canonicalId: string;
  canonicalName: string;
};
type Report = {
  format: "source-library-reconciliation";
  formatVersion: 1;
  snapshot: { path: string; sha256: string; capturedAt: string };
  manifest: { path: string; sha256: string; retained: number; excludedOlderDuplicates: number };
  proposals: Array<Record<string, unknown>>;
  findings: { allZeroStubs: unknown[] };
};

type Mapping = { old: string; canonical: string; table: RecipeTable | "cheese_recipes" };
type ReferenceObservation = {
  scope: "profile" | "pending" | "protected";
  key: string;
  field: string;
  value: string;
  old: boolean;
  canonical: boolean;
  nonCanonical: boolean;
};

const sha256 = (value: string | Buffer) => crypto.createHash("sha256").update(value).digest("hex");
const normalizedName = (value: unknown) => String(value ?? "").trim().toLowerCase();
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (!isRecord(value)) return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
}

function reportError(message: string): never {
  throw new Error(message);
}

function parseReport(value: unknown): Report {
  if (!isRecord(value) || value.format !== "source-library-reconciliation" || value.formatVersion !== 1) {
    return reportError("Invalid source-library reconciliation report format");
  }
  if (!isRecord(value.snapshot) || !isRecord(value.manifest) || !Array.isArray(value.proposals) ||
      !isRecord(value.findings) || !Array.isArray(value.findings.allZeroStubs)) {
    return reportError("Invalid source-library reconciliation report shape");
  }
  const proposals: Array<Record<string, unknown>> = [];
  for (const proposal of value.proposals) {
    if (!isRecord(proposal) || proposal.classification !== "automatic") continue;
    if (
      (proposal.action !== "replace-components-from-approved-source" && proposal.action !== "link-source-identity") ||
      typeof proposal.table !== "string" || !TABLES.includes(proposal.table as RecipeTable) ||
      !isRecord(proposal.before) || typeof proposal.before.id !== "string" ||
      typeof proposal.before.name !== "string" || !isRecord(proposal.after)
    ) {
      return reportError("Invalid automatic source-library reconciliation proposal");
    }
    if (proposal.action === "link-source-identity" && typeof proposal.after.sourceName !== "string") {
      return reportError("Invalid source-library identity-link proposal");
    }
    if (proposal.action === "replace-components-from-approved-source" && !Array.isArray(proposal.after.components)) {
      return reportError("Invalid source-library replacement proposal");
    }
    proposals.push(proposal);
  }
  const stubs: Stub[] = value.findings.allZeroStubs.map((stub) => {
    if (!isRecord(stub) || stub.table !== "cheese_recipes" || typeof stub.id !== "string" ||
        typeof stub.name !== "string" || typeof stub.canonicalId !== "string" ||
        typeof stub.canonicalName !== "string") {
      return reportError("Invalid source-library zero stub");
    }
    return {
      table: "cheese_recipes",
      id: stub.id,
      name: stub.name,
      canonicalId: stub.canonicalId,
      canonicalName: stub.canonicalName,
    };
  });
  const replacements = proposals.filter((proposal) => proposal.action === "replace-components-from-approved-source");
  const links = proposals.filter((proposal) => proposal.action === "link-source-identity");
  if (replacements.length !== 46 || links.length !== 22 || stubs.length !== 3) {
    return reportError("Unexpected source-library automatic proposal or stub count");
  }
  return {
    format: "source-library-reconciliation",
    formatVersion: 1,
    snapshot: value.snapshot as Report["snapshot"],
    manifest: value.manifest as Report["manifest"],
    proposals,
    findings: { allZeroStubs: stubs },
  };
}

function ownedFields(proposal: Proposal): Record<string, unknown> {
  const after = proposal.after;
  const fields: string[] = ["components"];
  if (proposal.table === "dough_recipes") fields.push("doughballVariants", "doughballWeightOz", "doughballsPerTray");
  if (proposal.table === "cheese_recipes") fields.push("brand", "flavors", "shredderSetting", "cellulose", "notes");
  if (proposal.table === "mixes") {
    fields.push("brand", "flavor", "daysEarly", "batchSize");
    // An omitted notes field means the heal must preserve the manager's note.
    if (Object.prototype.hasOwnProperty.call(after, "notes")) fields.push("notes");
  }
  return Object.fromEntries(fields.filter((field) => Object.prototype.hasOwnProperty.call(after, field))
    .map((field) => [field, after[field]]));
}

function actualOwnedFields(proposal: Proposal, row: Record<string, unknown>): Record<string, unknown> {
  const expected = ownedFields(proposal);
  return Object.fromEntries(Object.keys(expected).map((field) => [field, row[field]]));
}

function tableColumns(table: RecipeTable): string {
  switch (table) {
    case "dough_recipes":
      return `id, name, components, doughball_variants AS "doughballVariants",
        doughball_weight_oz AS "doughballWeightOz", doughballs_per_tray AS "doughballsPerTray"`;
    case "sauce_recipes":
      return "id, name, components";
    case "cheese_recipes":
      return `id, name, components, brand, flavors, shredder_setting AS "shredderSetting",
        cellulose, notes`;
    case "mixes":
      return "id, name, components, brand, flavor, days_early AS \"daysEarly\", batch_size AS \"batchSize\", notes";
  }
}

async function selectPoolRows(query: ReadOnlyQuery, table: RecipeTable, ids: string[]) {
  if (ids.length === 0) return [] as Array<Record<string, unknown>>;
  const result = await query(
    `SELECT ${tableColumns(table)} FROM ${table} WHERE scope = 'live' AND id = ANY($1::text[])`,
    [ids],
  );
  return result.rows;
}

function buildMappings(report: Report): Mapping[] {
  const mappings: Mapping[] = [];
  for (const raw of report.proposals) {
    const proposal = raw as unknown as Proposal;
    const canonical = proposal.action === "link-source-identity"
      ? String(proposal.before.name)
      : String(proposal.after.name ?? proposal.before.name);
    mappings.push({ old: String(proposal.after.sourceName ?? proposal.before.name), canonical, table: proposal.table });
  }
  for (const raw of report.findings.allZeroStubs) {
    const stub = raw as Stub;
    mappings.push({ old: stub.name, canonical: stub.canonicalName, table: "cheese_recipes" });
  }
  return mappings;
}

function mappingFor(value: string, mappings: Mapping[]): Mapping[] {
  return mappings.filter((mapping) => normalizedName(mapping.old) === normalizedName(value));
}

function canonicalValuesFor(value: string, mappings: Mapping[]): string[] {
  return [...new Set(mappingFor(value, mappings).map((mapping) => mapping.canonical))];
}

function classifyReference(value: string, mappings: Mapping[]) {
  const matches = mappingFor(value, mappings);
  if (matches.length === 0) return { old: false, canonical: false, nonCanonical: false };
  const old = matches.some((mapping) => value === mapping.old || normalizedName(value) === normalizedName(mapping.old));
  const canonical = matches.some((mapping) => value === mapping.canonical);
  const canonicalByName = matches.some((mapping) => normalizedName(value) === normalizedName(mapping.canonical));
  return { old, canonical: !old && canonical, nonCanonical: !old && !canonical && canonicalByName };
}

function profileSelectSql() {
  const fields = SOURCE_LINK_FIELDS.flatMap((field) => [
    `"values"->>'${field}' AS "v_${field}"`,
    `"crust_values"->>'${field}' AS "c_${field}"`,
  ]);
  return `SELECT key, ${fields.join(", ")} FROM brand_profiles WHERE scope = 'live'`;
}

async function selectReferences(query: ReadOnlyQuery, mappings: Mapping[], fromDate: string) {
  const profiles = await query(profileSelectSql());
  const profileObservations: ReferenceObservation[] = [];
  for (const row of profiles.rows) {
    for (const field of SOURCE_LINK_FIELDS) {
      for (const prefix of ["v", "c"] as const) {
        const value = typeof row[`${prefix}_${field}`] === "string" ? String(row[`${prefix}_${field}`]) : "";
        const state = value ? classifyReference(value, mappings) : { old: false, canonical: false, nonCanonical: false };
        if (state.old || state.canonical || state.nonCanonical) {
          profileObservations.push({
            scope: "profile",
            key: String(row.key ?? ""),
            field,
            value,
            ...state,
          });
        }
      }
    }
  }

  const runResult = await query(
    `WITH day_runs AS (
       SELECT date, data,
         jsonb_array_elements(
           CASE
             WHEN jsonb_typeof(data->'dayState'->'runs') = 'array' THEN data->'dayState'->'runs'
             WHEN jsonb_typeof(data->'runs') = 'array' THEN data->'runs'
             ELSE '[]'::jsonb
           END
         ) AS run
       FROM daily_sync
       WHERE scope = 'live'
     ),
     run_fields AS (
       SELECT date, data, run->>'id' AS run_id,
         (run->>'startedAt') IS NOT NULL AS started,
         data->'runValues'->(run->>'id') AS values
       FROM day_runs
       WHERE run->>'id' IS NOT NULL
     )
     SELECT date, run_id, started, field,
       values->>field AS value
     FROM run_fields
     CROSS JOIN unnest($1::text[]) AS fields(field)
     WHERE jsonb_typeof(values) = 'object'
       AND values->>field IS NOT NULL`,
    [SOURCE_LINK_FIELDS],
  );
  const runObservations: ReferenceObservation[] = [];
  for (const row of runResult.rows) {
    const value = String(row.value ?? "");
    const state = classifyReference(value, mappings);
    if (!state.old && !state.canonical && !state.nonCanonical) continue;
    const protectedRun = Boolean(row.started) || String(row.date) < fromDate;
    runObservations.push({
      scope: protectedRun ? "protected" : "pending",
      key: `${String(row.date)}\u0000${String(row.run_id)}`,
      field: String(row.field),
      value,
      ...state,
    });
  }
  return { profiles: profileObservations, runs: runObservations, profileRows: profiles.rows.length };
}

async function selectAliases(query: ReadOnlyQuery, report: Report) {
  const mappings = [
    ...(report.proposals as unknown as Proposal[])
      .filter((proposal) => proposal.action === "link-source-identity")
      .map((proposal) => ({
        old: String(proposal.after.sourceName),
        canonical: String(proposal.before.name),
      })),
    ...(report.findings.allZeroStubs as Stub[]).map((stub) => ({
      old: stub.name,
      canonical: stub.canonicalName,
    })),
  ];
  const expected = mappings.map((mapping) => ({
    external: mapping.old,
    canonical: mapping.canonical,
  }));
  if (expected.length === 0) return { expected, rows: [] as Array<Record<string, unknown>> };
  const result = await query(
    `SELECT external_name AS external, canonical_name AS canonical
       FROM spec_import_aliases
      WHERE scope = 'live' AND kind = 'appType' AND context IS NULL
        AND lower(external_name) = ANY($1::text[])`,
    [[...new Set(expected.map((entry) => normalizedName(entry.external)))]],
  );
  return { expected, rows: result.rows };
}

function zeroComponents(value: unknown) {
  return Array.isArray(value) && value.every((component) => {
    if (!isRecord(component)) return true;
    return ["lbs", "ozPerPizza", "perPizza"].every((field) => {
      const amount = Number(component[field] ?? 0);
      return !Number.isFinite(amount) || amount === 0;
    });
  });
}

function boundedCount(value: unknown) {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
}

function comparePoolRows(report: Report, rowsByTable: Record<RecipeTable, Array<Record<string, unknown>>>) {
  const counts = { expected: 0, exactMatches: 0, guardedRenames: 0, missing: 0, mismatches: 0 };
  const fingerprintRows: unknown[] = [];
  for (const raw of report.proposals) {
    const proposal = raw as unknown as Proposal;
    const row = rowsByTable[proposal.table].find((candidate) => candidate.id === proposal.before.id);
    counts.expected++;
    if (!row) {
      counts.missing++;
      fingerprintRows.push([proposal.table, proposal.before.id, "missing"]);
      continue;
    }
    if (row.name !== proposal.before.name) {
      counts.guardedRenames++;
      fingerprintRows.push([proposal.table, proposal.before.id, "guarded-rename"]);
      continue;
    }
    if (proposal.action === "link-source-identity") {
      counts.exactMatches++;
      fingerprintRows.push([proposal.table, proposal.before.id, "link", row.name]);
      continue;
    }
    const expected = ownedFields(proposal);
    const actual = actualOwnedFields(proposal, row);
    if (stable(expected) === stable(actual)) {
      counts.exactMatches++;
      fingerprintRows.push([proposal.table, proposal.before.id, expected]);
    } else {
      counts.mismatches++;
      fingerprintRows.push([proposal.table, proposal.before.id, actual]);
    }
  }
  return { counts, fingerprintRows };
}

function compareAliases(aliasState: Awaited<ReturnType<typeof selectAliases>>) {
  let exact = 0;
  let missing = 0;
  let mismatches = 0;
  const observations: unknown[] = [];
  for (const expected of aliasState.expected) {
    const rows = aliasState.rows.filter((row) => normalizedName(row.external) === normalizedName(expected.external));
    const exactRow = rows.find((row) => normalizedName(row.canonical) === normalizedName(expected.canonical));
    if (exactRow) {
      exact++;
      observations.push([expected.external, expected.canonical]);
    } else if (rows.length === 0) {
      missing++;
      observations.push([expected.external, "missing"]);
    } else {
      mismatches++;
      observations.push([expected.external, rows.map((row) => String(row.canonical ?? "")).sort()]);
    }
  }
  return {
    counts: { expected: aliasState.expected.length, exactMatches: exact, missing, mismatches },
    observations,
  };
}

function summarizeReferences(references: ReferenceObservation[]) {
  return {
    inspected: references.length,
    canonical: references.filter((reference) => reference.canonical).length,
    stale: references.filter((reference) => reference.old).length,
    nonCanonical: references.filter((reference) => reference.nonCanonical).length,
  };
}

async function selectStubRows(query: ReadOnlyQuery, stubs: Stub[]) {
  const ids = [...new Set(stubs.flatMap((stub) => [stub.id, stub.canonicalId]))];
  if (ids.length === 0) return [] as Array<Record<string, unknown>>;
  const result = await query(
    `SELECT id, name, components FROM cheese_recipes WHERE scope = 'live' AND id = ANY($1::text[])`,
    [ids],
  );
  return result.rows;
}

function compareStubs(stubs: Stub[], rows: Array<Record<string, unknown>>, protectedReferences: ReferenceObservation[]) {
  let canonicalExact = 0;
  let canonicalMissing = 0;
  let canonicalMismatches = 0;
  let deletedExpected = 0;
  let remainingProtected = 0;
  let unexpectedlyDeleted = 0;
  let unexpectedlyRemaining = 0;
  const observations: unknown[] = [];
  for (const stub of stubs) {
    const canonical = rows.find((row) => row.id === stub.canonicalId);
    if (!canonical) canonicalMissing++;
    else if (canonical.name === stub.canonicalName) canonicalExact++;
    else canonicalMismatches++;

    const current = rows.find((row) => row.id === stub.id);
    const historyReference = protectedReferences.some((reference) =>
      reference.old && normalizedName(reference.value) === normalizedName(stub.name));
    if (!current) {
      if (historyReference) unexpectedlyDeleted++;
      else deletedExpected++;
      observations.push([stub.id, "deleted", historyReference]);
      continue;
    }
    const protectedStub = !zeroComponents(current.components) || historyReference;
    if (protectedStub) remainingProtected++;
    else unexpectedlyRemaining++;
    observations.push([stub.id, protectedStub ? "protected" : "unexpected"]);
  }
  return {
    counts: {
      expected: stubs.length,
      canonicalExact,
      canonicalMissing,
      canonicalMismatches,
      deletedExpected,
      remainingProtected,
      unexpectedlyDeleted,
      unexpectedlyRemaining,
    },
    observations,
  };
}

function markerCheck(marker: Record<string, unknown> | undefined, report: Report, profileRows: number, pendingReferences: number) {
  const allowed = ["replacements", "aliasesInserted", "repointedProfiles", "repointedRuns", "deletedStubs"];
  const result = marker?.result;
  const validResult = isRecord(result) &&
    Object.keys(result).sort().join(",") === allowed.slice().sort().join(",") &&
    allowed.every((key) => boundedCount(result[key]));
  const withinBounds = validResult && result !== undefined
    ? Number(result.replacements) <= report.proposals.filter((proposal) => proposal.action === "replace-components-from-approved-source").length &&
      Number(result.aliasesInserted) <= report.proposals.length - report.proposals.filter((proposal) => proposal.action === "replace-components-from-approved-source").length + report.findings.allZeroStubs.length &&
      Number(result.repointedProfiles) <= profileRows &&
      Number(result.repointedRuns) <= pendingReferences &&
      Number(result.deletedStubs) <= report.findings.allZeroStubs.length
    : false;
  return {
    present: Boolean(marker),
    resultValid: validResult,
    resultWithinBounds: withinBounds,
    resultCounts: validResult ? result : {},
    appliedAtPresent: typeof marker?.appliedAt === "string" || marker?.appliedAt instanceof Date,
  };
}

export type VerificationOutput = {
  verifier: "source-library-reconciliation";
  repairBoundary: { fromDate: string };
  report: { sha256: string; formatVersion: number; automaticProposals: number; stubs: number };
  marker: ReturnType<typeof markerCheck>;
  pools: ReturnType<typeof comparePoolRows>["counts"];
  aliases: ReturnType<typeof compareAliases>["counts"];
  profiles: ReturnType<typeof summarizeReferences>;
  pendingRuns: ReturnType<typeof summarizeReferences>;
  protectedHistory: { references: number };
  stubs: ReturnType<typeof compareStubs>["counts"];
  idempotencyFingerprint: { algorithm: "sha256"; value: string };
  ok: boolean;
  failures: Array<{ check: string; count: number }>;
};

export async function verifySourceLibraryReconciliation(
  report: Report,
  reportBytes: Buffer,
  healId: string,
  query: ReadOnlyQuery,
  fromDate = DEFAULT_FROM_DATE,
): Promise<VerificationOutput> {
  const proposals = report.proposals as unknown as Proposal[];
  const idsByTable = Object.fromEntries(TABLES.map((table) => [
    table,
    [...new Set(proposals.filter((proposal) => proposal.table === table).map((proposal) => proposal.before.id))],
  ])) as Record<RecipeTable, string[]>;
  const rowsByTable = {} as Record<RecipeTable, Array<Record<string, unknown>>>;
  // A pg client owns one connection. Keep these SELECTs sequential so the
  // verifier itself does not create concurrent-query warnings or ambiguity.
  for (const table of TABLES) rowsByTable[table] = await selectPoolRows(query, table, idsByTable[table]);
  const stubs = report.findings.allZeroStubs as Stub[];
  const stubRows = await selectStubRows(query, stubs);
  const mappings = buildMappings(report);
  const references = await selectReferences(query, mappings, fromDate);
  const aliases = compareAliases(await selectAliases(query, report));
  const poolState = comparePoolRows(report, rowsByTable);
  const pendingSummary = summarizeReferences(references.runs.filter((reference) => reference.scope === "pending"));
  const profileSummary = summarizeReferences(references.profiles);
  const protectedReferences = references.runs.filter((reference) => reference.scope === "protected");
  const stubState = compareStubs(stubs, stubRows, protectedReferences);
  const markerResult = await query(
    "SELECT applied_at AS \"appliedAt\", result FROM data_heals WHERE id = $1 LIMIT 1",
    [healId],
  );
  const marker = markerCheck(markerResult.rows[0], report, references.profileRows, pendingSummary.inspected);

  const failureCandidates: Array<[string, number]> = [
    ["marker", Number(!marker.present || !marker.appliedAtPresent || !marker.resultValid || !marker.resultWithinBounds)],
    ["pools", poolState.counts.missing + poolState.counts.mismatches],
    ["aliases", aliases.counts.missing + aliases.counts.mismatches],
    ["profiles", profileSummary.stale + profileSummary.nonCanonical],
    ["pendingRuns", pendingSummary.stale + pendingSummary.nonCanonical],
    ["stubs", stubState.counts.canonicalMissing + stubState.counts.canonicalMismatches + stubState.counts.unexpectedlyDeleted + stubState.counts.unexpectedlyRemaining],
  ];
  const failures = failureCandidates.filter(([, count]) => count > 0).map(([check, count]) => ({ check, count }));
  const fingerprintInput = {
    reportSha256: sha256(reportBytes),
    healId,
    marker: marker.resultCounts,
    pool: poolState.counts,
    poolObservations: poolState.fingerprintRows,
    aliases: aliases.counts,
    aliasObservations: aliases.observations,
    profiles: references.profiles.map((reference) => [reference.key, reference.field, sha256(reference.value)]),
    runs: references.runs.map((reference) => [reference.key, reference.field, reference.scope, sha256(reference.value)]),
    stubs: stubState.counts,
    stubObservations: stubState.observations,
  };
  return {
    verifier: "source-library-reconciliation",
    repairBoundary: { fromDate },
    report: {
      sha256: sha256(reportBytes),
      formatVersion: report.formatVersion,
      automaticProposals: report.proposals.length,
      stubs: stubs.length,
    },
    marker,
    pools: poolState.counts,
    aliases: aliases.counts,
    profiles: profileSummary,
    pendingRuns: pendingSummary,
    protectedHistory: { references: protectedReferences.length },
    stubs: stubState.counts,
    idempotencyFingerprint: { algorithm: "sha256", value: sha256(stable(fingerprintInput)) },
    ok: failures.length === 0,
    failures,
  };
}

function argument(name: string, fallback?: string) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`);
  return value;
}

function dateFromHealId(healId: string) {
  const match = healId.match(/(?:^|-)((?:20)\d{2}-\d{2}-\d{2})(?:-|$)/);
  return match?.[1];
}

async function main() {
  const reportArgument = argument("--report");
  const reportPath = reportArgument
    ? path.resolve(process.cwd(), reportArgument)
    : path.resolve(ROOT, DEFAULT_REPORT);
  const healId = argument("--heal-id", DEFAULT_HEAL_ID)!;
  const fromDate = argument("--from-date", dateFromHealId(healId) ?? DEFAULT_FROM_DATE)!;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(fromDate)) throw new Error("Invalid --from-date; expected YYYY-MM-DD");
  const reportBytes = fs.readFileSync(reportPath);
  const report = parseReport(JSON.parse(reportBytes.toString("utf8")));
  const { pool } = await import("@workspace/db");
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    const output = await verifySourceLibraryReconciliation(
      report,
      reportBytes,
      healId,
      async (text, values) => {
        const result = await client.query(text, values ? [...values] : undefined);
        return { rows: result.rows as Array<Record<string, unknown>> };
      },
      fromDate,
    );
    await client.query("ROLLBACK");
    process.stdout.write(`${JSON.stringify(output)}\n`);
    if (!output.ok) process.exitCode = 1;
  } finally {
    client.release();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stdout.write(`${JSON.stringify({
      verifier: "source-library-reconciliation",
      ok: false,
      failures: [{ check: "input-or-database", count: 1 }],
      error: error instanceof Error ? error.message : "Verification failed",
    })}\n`);
    process.exitCode = 1;
  });
}

export { parseReport, stable, ownedFields, normalizedName };