/**
 * Read-only verification for the approved source-library reconciliation heal.
 *
 * This command deliberately does not use the application's write-capable
 * routes or Drizzle mutations. It opens a PostgreSQL transaction declared
 * READ ONLY, selects only report-owned fields, and rolls the transaction back.
 * Output is JSON only so the result can be retained by release automation.
 */
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isRetryableReleasePreflightDatabaseError,
  RELEASE_PREFLIGHT_DB_ATTEMPTS,
  runReleasePreflightDatabaseRetry,
} from "./release-preflight-db-retry.mts";
import {
  validateReadinessDeploymentHandoff,
  type ReadinessDeploymentHandoff,
} from "./capture-readiness-recovery.mts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DEFAULT_REPORT = "attached_assets/source-library/audits/source-library-reconciliation-2026-08-26.json";
export const DEFAULT_HEAL_ID = "source-library-reconciliation-2026-08-26-v2";
export const DEFAULT_FROM_DATE = "2026-08-26";
export const SOURCE_LIBRARY_EVIDENCE_ENVIRONMENTS = ["development", "release"] as const;
export type SourceLibraryEvidenceEnvironment = (typeof SOURCE_LIBRARY_EVIDENCE_ENVIRONMENTS)[number];
const DATABASE_OWNER_MAX_LENGTH = 128;
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

export function parseSourceLibraryEvidenceEnvironment(value: unknown): SourceLibraryEvidenceEnvironment {
  if (value === "development" || value === "release") return value;
  return reportError(
    "Invalid source-library evidence environment; expected --environment development or --environment release",
  );
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
    // The heal initializes batchSize, but managers may legitimately edit it
    // afterward. Post-heal verification owns only immutable source fields.
    fields.push("brand", "flavor", "daysEarly");
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
    const old = String(proposal.after.sourceName ?? proposal.before.name);
    // Component-only replacements intentionally retain their recipe identity.
    // Treating old === canonical as a rename makes every legitimate profile and
    // pending-run reference look stale even though no repoint was required.
    if (normalizedName(old) !== normalizedName(canonical)) {
      mappings.push({ old, canonical, table: proposal.table });
    }
  }
  for (const raw of report.findings.allZeroStubs) {
    const stub = raw as Stub;
    mappings.push({ old: stub.name, canonical: stub.canonicalName, table: "cheese_recipes" });
  }
  return mappings;
}

function mappingFor(value: string, mappings: Mapping[]): Mapping[] {
  const normalized = normalizedName(value);
  return mappings.filter((mapping) =>
    normalizedName(mapping.old) === normalized || normalizedName(mapping.canonical) === normalized);
}

function classifyReference(value: string, mappings: Mapping[]) {
  const matches = mappingFor(value, mappings);
  if (matches.length === 0) return { old: false, canonical: false, nonCanonical: false };
  const old = matches.some((mapping) => normalizedName(value) === normalizedName(mapping.old));
  const canonical = !old && matches.some((mapping) => value === mapping.canonical);
  const canonicalByName = !old && matches.some((mapping) =>
    normalizedName(value) === normalizedName(mapping.canonical));
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

function validDatabaseOwner(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= DATABASE_OWNER_MAX_LENGTH &&
    /^[A-Za-z_][A-Za-z0-9_$-]*$/u.test(value)
  );
}

async function checkDatabaseOwner(
  query: ReadOnlyQuery,
  environment: SourceLibraryEvidenceEnvironment,
  expectedDatabaseOwner: string | undefined,
): Promise<boolean> {
  // Development fixture verification intentionally remains independent of a
  // production deployment's owner configuration. Release verification must
  // always have an explicit, externally approved owner to compare with the
  // owner reported by PostgreSQL.
  if (environment !== "release" && expectedDatabaseOwner === undefined) {
    return true;
  }
  if (!validDatabaseOwner(expectedDatabaseOwner)) return false;
  const result = await query(
    `SELECT pg_get_userbyid(datdba) AS "databaseOwner"
       FROM pg_database
      WHERE datname = current_database()
      LIMIT 1`,
  );
  return result.rows.length === 1 &&
    result.rows[0]?.databaseOwner === expectedDatabaseOwner;
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
  environment: SourceLibraryEvidenceEnvironment;
  revision: string;
  capturedAt: string;
  evidenceId: string;
  healId: string;
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

export const SOURCE_LIBRARY_EVIDENCE_KEYS = [
  "verifier",
  "environment",
  "revision",
  "capturedAt",
  "evidenceId",
  "healId",
  "repairBoundary",
  "report",
  "marker",
  "pools",
  "aliases",
  "profiles",
  "pendingRuns",
  "protectedHistory",
  "stubs",
  "idempotencyFingerprint",
  "ok",
  "failures",
] as const;

const SOURCE_LIBRARY_EVIDENCE_MAX_COUNT = 1_000_000;

function boundedEvidenceString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function boundedEvidenceCount(value: unknown): value is number {
  return (
    isFiniteNumber(value) &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= SOURCE_LIBRARY_EVIDENCE_MAX_COUNT
  );
}

function assertBoundedSummary(
  value: unknown,
  keys: readonly string[],
  name: string,
): asserts value is Record<string, unknown> {
  if (!isRecord(value) || !hasExactKeys(value, keys)) {
    throw new Error(
      `Source-library reconciliation evidence does not match the bounded allowlist (${name}).`,
    );
  }
  for (const key of keys) {
    if (!boundedEvidenceCount(value[key])) {
      throw new Error(
        `Source-library reconciliation evidence has an invalid bounded count (${name}.${key}).`,
      );
    }
  }
}

/**
 * Enforce the exact shape retained as source-library release evidence.
 *
 * This is intentionally stricter than checking a few expected fields. It is
 * the privacy boundary between production source rows and retained evidence:
 * new row-shaped fields must be rejected until they are explicitly reviewed
 * and added to this summary-only contract.
 */
export function assertBoundedSourceLibraryReconciliationEvidence(
  value: unknown,
): asserts value is VerificationOutput {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, SOURCE_LIBRARY_EVIDENCE_KEYS) ||
    value.verifier !== "source-library-reconciliation" ||
    (value.environment !== "development" && value.environment !== "release") ||
    !boundedEvidenceString(value.revision) ||
    !boundedEvidenceString(value.capturedAt) ||
    !/^[a-f0-9]{64}$/u.test(String(value.evidenceId ?? "")) ||
    !boundedEvidenceString(value.healId) ||
    !isRecord(value.repairBoundary) ||
    !hasExactKeys(value.repairBoundary, ["fromDate"]) ||
    typeof value.repairBoundary.fromDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(value.repairBoundary.fromDate) ||
    !isRecord(value.report) ||
    !hasExactKeys(value.report, [
      "sha256",
      "formatVersion",
      "automaticProposals",
      "stubs",
    ]) ||
    !/^[a-f0-9]{64}$/u.test(String(value.report.sha256 ?? "")) ||
    value.report.formatVersion !== 1 ||
    !boundedEvidenceCount(value.report.automaticProposals) ||
    !boundedEvidenceCount(value.report.stubs) ||
    typeof value.ok !== "boolean" ||
    !isRecord(value.marker) ||
    !hasExactKeys(value.marker, [
      "present",
      "resultValid",
      "resultWithinBounds",
      "resultCounts",
      "appliedAtPresent",
    ]) ||
    typeof value.marker.present !== "boolean" ||
    typeof value.marker.resultValid !== "boolean" ||
    typeof value.marker.resultWithinBounds !== "boolean" ||
    typeof value.marker.appliedAtPresent !== "boolean" ||
    !isRecord(value.marker.resultCounts) ||
    !hasExactKeys(value.marker.resultCounts, [
      "replacements",
      "aliasesInserted",
      "repointedProfiles",
      "repointedRuns",
      "deletedStubs",
    ]) ||
    !isRecord(value.protectedHistory) ||
    !hasExactKeys(value.protectedHistory, ["references"]) ||
    !boundedEvidenceCount(value.protectedHistory.references) ||
    !isRecord(value.idempotencyFingerprint) ||
    !hasExactKeys(value.idempotencyFingerprint, ["algorithm", "value"]) ||
    value.idempotencyFingerprint.algorithm !== "sha256" ||
    !/^[a-f0-9]{64}$/u.test(String(value.idempotencyFingerprint.value ?? "")) ||
    !Array.isArray(value.failures) ||
    value.failures.length > 20
  ) {
    throw new Error(
      "Source-library reconciliation evidence does not match the bounded allowlist.",
    );
  }

  assertBoundedSummary(value.pools, [
    "expected",
    "exactMatches",
    "guardedRenames",
    "missing",
    "mismatches",
  ], "pools");
  assertBoundedSummary(value.aliases, [
    "expected",
    "exactMatches",
    "missing",
    "mismatches",
  ], "aliases");
  assertBoundedSummary(value.profiles, [
    "inspected",
    "canonical",
    "stale",
    "nonCanonical",
  ], "profiles");
  assertBoundedSummary(value.pendingRuns, [
    "inspected",
    "canonical",
    "stale",
    "nonCanonical",
  ], "pendingRuns");
  assertBoundedSummary(value.stubs, [
    "expected",
    "canonicalExact",
    "canonicalMissing",
    "canonicalMismatches",
    "deletedExpected",
    "remainingProtected",
    "unexpectedlyDeleted",
    "unexpectedlyRemaining",
  ], "stubs");
  for (const key of [
    "replacements",
    "aliasesInserted",
    "repointedProfiles",
    "repointedRuns",
    "deletedStubs",
  ]) {
    if (!boundedEvidenceCount(value.marker.resultCounts[key])) {
      throw new Error(
        `Source-library reconciliation evidence has an invalid bounded count (marker.resultCounts.${key}).`,
      );
    }
  }
  for (const failure of value.failures) {
    if (
      !isRecord(failure) ||
      !hasExactKeys(failure, ["check", "count"]) ||
      typeof failure.check !== "string" ||
      !/^[A-Za-z0-9_-]{1,80}$/u.test(failure.check) ||
      !boundedEvidenceCount(failure.count)
    ) {
      throw new Error(
        "Source-library reconciliation evidence contains an invalid failure summary.",
      );
    }
  }
}

export type SourceLibraryPreflightOutput = {
  verifier: "source-library-reconciliation-preflight";
  environment: SourceLibraryEvidenceEnvironment;
  revision: string;
  capturedAt: string;
  healId: string;
  report: {
    sha256: string;
    formatVersion: number;
    automaticProposals: number;
    stubs: number;
  };
  database: "approved-matching" | "partial-fixture" | "unverified";
  expected: { poolRows: number; aliases: number };
  observed: {
    poolRows: number;
    aliasesExact: number;
    aliasesMissing: number;
    aliasesMismatched: number;
    markerPresent: boolean;
    markerValid: boolean;
  };
  failures: Array<{ check: string; count: number }>;
  ok: boolean;
};

export const SOURCE_LIBRARY_PREFLIGHT_DIAGNOSTIC_VERSION = 1 as const;

export type SourceLibraryPreflightDiagnostic = {
  contractVersion: typeof SOURCE_LIBRARY_PREFLIGHT_DIAGNOSTIC_VERSION;
  database: SourceLibraryPreflightOutput["database"];
  expected: SourceLibraryPreflightOutput["expected"];
  observed: SourceLibraryPreflightOutput["observed"];
  failures: Array<{ check: string; count: number }>;
  ok: boolean;
};

const PREFLIGHT_DIAGNOSTIC_MAX_COUNT = 1_000_000;
const PREFLIGHT_DIAGNOSTIC_MAX_FAILURES = 20;
const PREFLIGHT_OUTPUT_KEYS = [
  "verifier",
  "environment",
  "revision",
  "capturedAt",
  "healId",
  "report",
  "database",
  "expected",
  "observed",
  "failures",
  "ok",
] as const;
const PREFLIGHT_DIAGNOSTIC_KEYS = [
  "contractVersion",
  "database",
  "expected",
  "observed",
  "failures",
  "ok",
] as const;
const LEGACY_PREFLIGHT_DIAGNOSTIC_KEYS = PREFLIGHT_DIAGNOSTIC_KEYS.slice(1);

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function boundedPreflightDiagnosticCount(value: unknown): value is number {
  return (
    isFiniteNumber(value) &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= PREFLIGHT_DIAGNOSTIC_MAX_COUNT
  );
}

function parsePreflightFailures(
  value: unknown,
): Array<{ check: string; count: number }> | undefined {
  if (!Array.isArray(value) || value.length > PREFLIGHT_DIAGNOSTIC_MAX_FAILURES) {
    return undefined;
  }
  const failures = value.flatMap((failure) => {
    if (
      !isRecord(failure) ||
      !hasExactKeys(failure, ["check", "count"]) ||
      typeof failure.check !== "string" ||
      !/^[A-Za-z0-9_-]{1,80}$/u.test(failure.check) ||
      !boundedPreflightDiagnosticCount(failure.count)
    ) {
      return [];
    }
    return [{ check: failure.check, count: failure.count }];
  });
  return failures.length === value.length ? failures : undefined;
}

function parsePreflightDiagnosticFields(
  value: Record<string, unknown>,
): Omit<SourceLibraryPreflightDiagnostic, "contractVersion"> | undefined {
  if (
    (value.database !== "approved-matching" &&
      value.database !== "partial-fixture" &&
      value.database !== "unverified") ||
    !isRecord(value.expected) ||
    !hasExactKeys(value.expected, ["poolRows", "aliases"]) ||
    !isRecord(value.observed) ||
    !hasExactKeys(value.observed, [
      "poolRows",
      "aliasesExact",
      "aliasesMissing",
      "aliasesMismatched",
      "markerPresent",
      "markerValid",
    ]) ||
    typeof value.ok !== "boolean" ||
    !boundedPreflightDiagnosticCount(value.expected.poolRows) ||
    !boundedPreflightDiagnosticCount(value.expected.aliases) ||
    !boundedPreflightDiagnosticCount(value.observed.poolRows) ||
    !boundedPreflightDiagnosticCount(value.observed.aliasesExact) ||
    !boundedPreflightDiagnosticCount(value.observed.aliasesMissing) ||
    !boundedPreflightDiagnosticCount(value.observed.aliasesMismatched) ||
    typeof value.observed.markerPresent !== "boolean" ||
    typeof value.observed.markerValid !== "boolean"
  ) {
    return undefined;
  }
  const failures = parsePreflightFailures(value.failures);
  if (failures === undefined) return undefined;
  return {
    database: value.database,
    expected: {
      poolRows: value.expected.poolRows,
      aliases: value.expected.aliases,
    },
    observed: {
      poolRows: value.observed.poolRows,
      aliasesExact: value.observed.aliasesExact,
      aliasesMissing: value.observed.aliasesMissing,
      aliasesMismatched: value.observed.aliasesMismatched,
      markerPresent: value.observed.markerPresent,
      markerValid: value.observed.markerValid,
    },
    failures,
    ok: value.ok,
  };
}

/**
 * Validate the checkpoint-facing diagnostic contract.
 *
 * New writers emit v1. Readers also accept the exact unversioned shape
 * written by earlier release checks and normalize it to v1. Unknown keys,
 * unsupported versions, and any recipe/alias/source payload are rejected.
 */
export function parseSourceLibraryPreflightDiagnostic(
  value: unknown,
): SourceLibraryPreflightDiagnostic | undefined {
  if (!isRecord(value)) return undefined;
  if (hasExactKeys(value, PREFLIGHT_DIAGNOSTIC_KEYS)) {
    if (value.contractVersion !== SOURCE_LIBRARY_PREFLIGHT_DIAGNOSTIC_VERSION) {
      return undefined;
    }
  } else if (!hasExactKeys(value, LEGACY_PREFLIGHT_DIAGNOSTIC_KEYS)) {
    return undefined;
  }
  const fields = parsePreflightDiagnosticFields(value);
  return fields === undefined
    ? undefined
    : { contractVersion: SOURCE_LIBRARY_PREFLIGHT_DIAGNOSTIC_VERSION, ...fields };
}

/**
 * Reduce preflight output to operator-safe diagnostics.
 *
 * Release checkpoints may outlive the process that produced them, so they
 * must not retain the verifier's JSON payload. Keep only the database-shape
 * classification, bounded counts, marker state, and bounded failure names.
 */
export function summarizeSourceLibraryPreflight(
  value: unknown,
): SourceLibraryPreflightDiagnostic | undefined {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, PREFLIGHT_OUTPUT_KEYS) ||
    value.verifier !== "source-library-reconciliation-preflight" ||
    (value.environment !== "development" && value.environment !== "release") ||
    typeof value.revision !== "string" ||
    value.revision.length === 0 ||
    value.revision.length > 128 ||
    typeof value.capturedAt !== "string" ||
    value.capturedAt.length === 0 ||
    value.capturedAt.length > 128 ||
    typeof value.healId !== "string" ||
    value.healId.length === 0 ||
    value.healId.length > 128 ||
    !isRecord(value.report) ||
    !hasExactKeys(value.report, [
      "sha256",
      "formatVersion",
      "automaticProposals",
      "stubs",
    ]) ||
    typeof value.report.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.report.sha256) ||
    !boundedPreflightDiagnosticCount(value.report.formatVersion) ||
    !boundedPreflightDiagnosticCount(value.report.automaticProposals) ||
    !boundedPreflightDiagnosticCount(value.report.stubs) ||
    (value.database !== "approved-matching" &&
      value.database !== "partial-fixture" &&
      value.database !== "unverified") ||
    !isRecord(value.expected) ||
    !isRecord(value.observed) ||
    typeof value.ok !== "boolean" ||
    !boundedPreflightDiagnosticCount(value.expected.poolRows) ||
    !boundedPreflightDiagnosticCount(value.expected.aliases) ||
    !boundedPreflightDiagnosticCount(value.observed.poolRows) ||
    !boundedPreflightDiagnosticCount(value.observed.aliasesExact) ||
    !boundedPreflightDiagnosticCount(value.observed.aliasesMissing) ||
    !boundedPreflightDiagnosticCount(value.observed.aliasesMismatched) ||
    typeof value.observed.markerPresent !== "boolean" ||
    typeof value.observed.markerValid !== "boolean"
  ) {
    return undefined;
  }

  const fields = parsePreflightDiagnosticFields(value);
  return fields === undefined
    ? undefined
    : { contractVersion: SOURCE_LIBRARY_PREFLIGHT_DIAGNOSTIC_VERSION, ...fields };
}

async function selectPoolIds(
  query: ReadOnlyQuery,
  table: RecipeTable,
  ids: string[],
): Promise<Array<Record<string, unknown>>> {
  if (ids.length === 0) return [];
  const result = await query(
    `SELECT id FROM ${table} WHERE scope = 'live' AND id = ANY($1::text[])`,
    [ids],
  );
  return result.rows;
}

function preflightMarkerIsValid(
  marker: Record<string, unknown> | undefined,
  report: Report,
): { present: boolean; valid: boolean } {
  const result = marker?.result;
  const allowed = [
    "replacements",
    "aliasesInserted",
    "repointedProfiles",
    "repointedRuns",
    "deletedStubs",
  ];
  const validResult =
    isRecord(result) &&
    Object.keys(result).sort().join(",") === allowed.slice().sort().join(",") &&
    allowed.every((key) => boundedCount(result[key])) &&
    Number(result.replacements) <=
      report.proposals.filter(
        (proposal) =>
          (proposal as unknown as Proposal).action ===
          "replace-components-from-approved-source",
      ).length &&
    Number(result.aliasesInserted) <=
      report.proposals.filter(
        (proposal) =>
          (proposal as unknown as Proposal).action ===
          "link-source-identity",
      ).length + report.findings.allZeroStubs.length &&
    Number(result.deletedStubs) <= report.findings.allZeroStubs.length;
  return {
    present: Boolean(marker),
    valid:
      validResult &&
      (typeof marker?.appliedAt === "string" ||
        marker?.appliedAt instanceof Date),
  };
}

/**
 * Cheap, bounded identity check used before expensive release gates.
 *
 * This checks only live recipe IDs, alias identities, the marker shape, and
 * the approved owner of a release database. It does not inspect recipe
 * payloads, references, or mutate the database. A complete identity match is
 * not a substitute for the full verifier below; it only prevents a partial or
 * wrong-owner database from allowing expensive release work to start.
 */
export async function preflightSourceLibraryReconciliation(
  report: Report,
  reportBytes: Buffer,
  healId: string,
  query: ReadOnlyQuery,
  environment: SourceLibraryEvidenceEnvironment,
  revision: string,
  expectedDatabaseOwner?: string,
): Promise<SourceLibraryPreflightOutput> {
  const proposals = report.proposals as unknown as Proposal[];
  const idsByTable = Object.fromEntries(
    TABLES.map((table) => [
      table,
      [
        ...new Set(
          proposals
            .filter((proposal) => proposal.table === table)
            .map((proposal) => proposal.before.id),
        ),
      ],
    ]),
  ) as Record<RecipeTable, string[]>;
  const poolRowsByTable = {} as Record<
    RecipeTable,
    Array<Record<string, unknown>>
  >;
  for (const table of TABLES) {
    poolRowsByTable[table] = await selectPoolIds(
      query,
      table,
      idsByTable[table],
    );
  }
  const aliases = compareAliases(await selectAliases(query, report));
  const databaseOwnerAttested = await checkDatabaseOwner(
    query,
    environment,
    expectedDatabaseOwner,
  );
  const markerResult = await query(
    'SELECT applied_at AS "appliedAt", result FROM data_heals WHERE id = $1 LIMIT 1',
    [healId],
  );
  const marker = preflightMarkerIsValid(markerResult.rows[0], report);
  const expectedPoolRows = report.proposals.length;
  const observedPoolRows = TABLES.reduce(
    (total, table) => total + poolRowsByTable[table].length,
    0,
  );
  const expectedAliases =
    report.proposals.filter(
      (proposal) =>
        (proposal as unknown as Proposal).action === "link-source-identity",
    ).length + report.findings.allZeroStubs.length;
  const failureCandidates: Array<[string, number]> = [
    ["databaseShape", expectedPoolRows - observedPoolRows],
    ["aliases", aliases.counts.missing + aliases.counts.mismatches],
    ["databaseOwner", Number(!databaseOwnerAttested)],
    ["marker", Number(!marker.valid)],
  ];
  const failures = failureCandidates
    .filter(([, count]) => count > 0)
    .map(([check, count]) => ({ check, count }));
  const database =
    failures.length === 0
      ? "approved-matching"
      : failures.some(
            (failure) =>
              failure.check === "databaseShape" ||
              failure.check === "aliases" ||
              !marker.present,
          )
        ? "partial-fixture"
        : "unverified";
  return {
    verifier: "source-library-reconciliation-preflight",
    environment,
    revision,
    capturedAt: new Date().toISOString(),
    healId,
    report: {
      sha256: sha256(reportBytes),
      formatVersion: report.formatVersion,
      automaticProposals: report.proposals.length,
      stubs: report.findings.allZeroStubs.length,
    },
    database,
    expected: { poolRows: expectedPoolRows, aliases: expectedAliases },
    observed: {
      poolRows: observedPoolRows,
      aliasesExact: aliases.counts.exactMatches,
      aliasesMissing: aliases.counts.missing,
      aliasesMismatched: aliases.counts.mismatches,
      markerPresent: marker.present,
      markerValid: marker.valid,
    },
    failures,
    ok: failures.length === 0,
  };
}

export function computeSourceLibraryEvidenceId(
  evidence: Record<string, unknown>,
): string {
  const bounded = { ...evidence };
  delete bounded.evidenceId;
  return sha256(stable(bounded));
}

export async function verifySourceLibraryReconciliation(
  report: Report,
  reportBytes: Buffer,
  healId: string,
  query: ReadOnlyQuery,
  fromDate = DEFAULT_FROM_DATE,
  environment: SourceLibraryEvidenceEnvironment = "development",
  revision = "development-unbound",
  expectedDatabaseOwner?: string,
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
  const databaseOwnerAttested = await checkDatabaseOwner(
    query,
    environment,
    expectedDatabaseOwner,
  );
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
    ["databaseOwner", Number(!databaseOwnerAttested)],
    ["pools", poolState.counts.missing + poolState.counts.mismatches],
    ["aliases", aliases.counts.missing + aliases.counts.mismatches],
    ["profiles", profileSummary.stale + profileSummary.nonCanonical],
    ["pendingRuns", pendingSummary.stale + pendingSummary.nonCanonical],
    ["protectedStubs", stubState.counts.canonicalMissing + stubState.counts.canonicalMismatches + stubState.counts.unexpectedlyDeleted + stubState.counts.unexpectedlyRemaining],
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
  const capturedAt = new Date().toISOString();
  const fingerprint = sha256(stable(fingerprintInput));
  const output: Omit<VerificationOutput, "evidenceId"> = {
    verifier: "source-library-reconciliation",
    environment,
    revision,
    capturedAt,
    healId,
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
    idempotencyFingerprint: { algorithm: "sha256", value: fingerprint },
    ok: failures.length === 0,
    failures,
  };
  return {
    ...output,
    evidenceId: computeSourceLibraryEvidenceId(output),
  };
}

function argument(name: string, fallback?: string) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`);
  return value;
}

function outputPathArgument(): string | undefined {
  const value = argument("--output");
  return value ? path.resolve(process.cwd(), value) : undefined;
}

async function writeOutput(outputPath: string | undefined, output: unknown): Promise<void> {
  if (!outputPath) return;
  fs.writeFileSync(outputPath, `${JSON.stringify(output)}\n`, "utf8");
}

export const SOURCE_LIBRARY_PREFLIGHT_DB_ATTEMPTS = RELEASE_PREFLIGHT_DB_ATTEMPTS;
export const isRetryableSourceLibraryDatabaseError =
  isRetryableReleasePreflightDatabaseError;

type ReadOnlyPoolClient = {
  query: (text: string, values?: readonly unknown[]) => Promise<{
    rows: Array<Record<string, unknown>>;
  }>;
  release: (destroy?: boolean) => void;
};

type ReadOnlyPool = {
  connect: () => Promise<ReadOnlyPoolClient>;
};

async function runSourceLibraryReadOnlyCheck<T>(
  pool: ReadOnlyPool,
  retryConnectionFailures: boolean,
  check: (query: ReadOnlyQuery) => Promise<T>,
): Promise<T> {
  return runReleasePreflightDatabaseRetry(async () => {
    let client: ReadOnlyPoolClient | undefined;
    let destroyClient = false;
    try {
      client = await pool.connect();
      await client.query("BEGIN TRANSACTION READ ONLY");
      const query: ReadOnlyQuery = async (text, values) => {
        const result = await client!.query(text, values);
        return { rows: result.rows };
      };
      const output = await check(query);
      await client.query("ROLLBACK");
      return output;
    } catch (error) {
      destroyClient =
        retryConnectionFailures &&
        isRetryableReleasePreflightDatabaseError(error);
      throw error;
    } finally {
      client?.release(destroyClient);
    }
  }, { enabled: retryConnectionFailures });
}

function dateFromHealId(healId: string) {
  const match = healId.match(/(?:^|-)((?:20)\d{2}-\d{2}-\d{2})(?:-|$)/);
  return match?.[1];
}

function currentRevision(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
}

export function resolveSourceLibraryRevision(
  environment: SourceLibraryEvidenceEnvironment,
  configuredRevision: string | undefined,
  deploymentHandoffPath?: string,
  now?: Date,
): string {
  const explicitRevision = configuredRevision?.trim() || undefined;
  const handoffRevision = deploymentHandoffPath
    ? readSourceLibraryDeploymentHandoff(deploymentHandoffPath, now).deployedRevision
    : undefined;
  if (
    explicitRevision !== undefined &&
    handoffRevision !== undefined &&
    explicitRevision !== handoffRevision
  ) {
    throw new Error(
      "Source-library revision conflicts with the deployed revision in the deployment handoff.",
    );
  }
  const revision =
    explicitRevision ||
    handoffRevision ||
    (environment === "development" ? currentRevision() : undefined);
  if (!revision) {
    throw new Error(
      "Missing deployed revision for release evidence; pass --revision or --deployment-handoff with the exact deployed 40-character Git commit SHA",
    );
  }
  if (!/^[a-f0-9]{40}$/u.test(revision)) {
    throw new Error(
      "Invalid --revision; expected the full 40-character Git commit SHA; pass the exact deployed 40-character Git commit SHA.",
    );
  }
  return revision;
}

export function resolveSourceLibraryDatabaseOwner(
  configuredDatabaseOwner: string | undefined,
  deploymentHandoffPath?: string,
  now?: Date,
): string | undefined {
  const explicitOwner = configuredDatabaseOwner?.trim() || undefined;
  const handoffOwner = deploymentHandoffPath
    ? readSourceLibraryDeploymentHandoff(deploymentHandoffPath, now).databaseOwner
    : undefined;
  if (
    explicitOwner !== undefined &&
    handoffOwner !== undefined &&
    explicitOwner !== handoffOwner
  ) {
    throw new Error(
      "Source-library database owner conflicts with the database owner in the deployment handoff.",
    );
  }
  return explicitOwner ?? handoffOwner;
}

export function readSourceLibraryDeploymentHandoff(
  handoffPath: string,
  now?: Date,
): ReadinessDeploymentHandoff {
  const resolvedPath = path.resolve(process.cwd(), handoffPath);
  const stats = fs.lstatSync(resolvedPath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(
      "Source-library deployment handoff must be a regular file.",
    );
  }
  return validateReadinessDeploymentHandoff(fs.readFileSync(resolvedPath), { now });
}

export function assertProductionSourceLibraryCapture(options: {
  environmentArgument: string | undefined;
  configuredRevision: string | undefined;
  revisionArgumentProvided: boolean;
  deploymentHandoffArgumentProvided?: boolean;
  deploymentHandoffPath?: string;
  outputPath: string | undefined;
  preflight: boolean;
  configuredDatabaseOwner?: string;
  environment: NodeJS.ProcessEnv;
}): void {
  const databaseOwner = resolveSourceLibraryDatabaseOwner(
    options.configuredDatabaseOwner,
    options.deploymentHandoffPath,
  );
  if (options.environmentArgument !== "release") {
    throw new Error(
      "Production source-library capture requires the explicit --environment release flag.",
    );
  }
  if (!options.configuredRevision?.trim() && !options.deploymentHandoffPath?.trim()) {
    throw new Error(
      "Production source-library capture requires --revision or --deployment-handoff with the deployed Git SHA.",
    );
  }
  if (!validDatabaseOwner(databaseOwner)) {
    throw new Error(
      "Production source-library capture requires --database-owner or --deployment-handoff with the approved PostgreSQL database owner.",
    );
  }
  if (
    !options.revisionArgumentProvided &&
    options.deploymentHandoffArgumentProvided !== true
  ) {
    throw new Error(
      "Production source-library capture requires --revision or --deployment-handoff on the command line; do not rely on an ambient revision variable.",
    );
  }
  resolveSourceLibraryRevision(
    "release",
    options.configuredRevision,
    options.deploymentHandoffPath,
  );
  if (options.preflight) {
    throw new Error(
      "Production source-library capture does not support --preflight; capture the full bounded verifier result.",
    );
  }
  if (!options.environment.DATABASE_URL?.trim()) {
    throw new Error(
      "Production source-library capture requires DATABASE_URL for the read-only production database.",
    );
  }
  if (options.environment.SOURCE_LIBRARY_VERIFIER_QUERY_FIXTURE?.trim()) {
    throw new Error(
      "Production source-library capture refuses SOURCE_LIBRARY_VERIFIER_QUERY_FIXTURE; do not substitute development fixtures for production.",
    );
  }
  if (options.outputPath !== undefined && options.outputPath.trim() === "") {
    throw new Error("Production source-library capture output path cannot be empty.");
  }
}

async function main() {
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
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(fromDate)) throw new Error("Invalid --from-date; expected YYYY-MM-DD");
  const reportBytes = fs.readFileSync(reportPath);
  const report = parseReport(JSON.parse(reportBytes.toString("utf8")));
  const { pool } = await import("@workspace/db");
  const output = await runSourceLibraryReadOnlyCheck<
    SourceLibraryPreflightOutput | VerificationOutput
  >(pool, preflightOnly, (query) =>
    preflightOnly
      ? preflightSourceLibraryReconciliation(
          report,
          reportBytes,
          healId,
          query,
          environment,
          revision,
          databaseOwner,
        )
      : verifySourceLibraryReconciliation(
          report,
          reportBytes,
          healId,
          query,
          fromDate,
          environment,
          revision,
          databaseOwner,
        ),
  );
  if (!preflightOnly) {
    assertBoundedSourceLibraryReconciliationEvidence(output);
  }
  await writeOutput(outputPath, output);
  process.stdout.write(`${JSON.stringify(output)}\n`);
  if (!output.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
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

export { parseReport, stable, ownedFields, normalizedName };
