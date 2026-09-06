import { gunzipSync } from "node:zlib";
import { and, eq } from "drizzle-orm";
import {
  brandProfilesTable,
  cheeseRecipesTable,
  dailySyncTable,
  dataHealsTable,
  doughRecipesTable,
  mixesTable,
  sauceRecipesTable,
  specImportAliasesTable,
} from "@workspace/db";
import {
  SOURCE_LIBRARY_RECONCILIATION_PLAN_GZIP_BASE64,
  SOURCE_LIBRARY_RECONCILIATION_PLAN_SHA256,
} from "./sourceLibraryReconciliationPlan.generated";
import type { db } from "@workspace/db";

export const SOURCE_LIBRARY_RECONCILIATION_REPORT =
  "attached_assets/source-library/audits/source-library-reconciliation-2026-08-26.json";
export const SOURCE_LIBRARY_RECONCILIATION_REPORT_SHA256 =
  "1d8a2a3ddda96c32959e43fdcd901f3a14308bf12bc4d65ef4e2e3ce12505294";
export const SOURCE_LIBRARY_RECONCILIATION_SNAPSHOT = {
  path: "attached_assets/source-library/audits/production-snapshot-2026-08-26.json",
  sha256: "4bff312e8176dc5333a2a5982798ea9f9bb951bb50409bb9affbd89c3407e9b6",
  capturedAt: "2026-08-26T00:21:27.339Z",
} as const;
export const SOURCE_LIBRARY_RECONCILIATION_MANIFEST = {
  path: "attached_assets/source-library/audits/source-library-manifest-2026-08-26.json",
  sha256: "def4f820d563eacd26499cbe043d2251d8c48a31993d36fc57553fa69ac0baf9",
  retained: 49,
  excludedOlderDuplicates: 0,
} as const;
export const SOURCE_LIBRARY_RECONCILIATION_HEAL_ID = "source-library-reconciliation-2026-08-26-v1";
export const SOURCE_LIBRARY_RECONCILIATION_FROM_DATE = "2026-08-26";
export type ReconciliationTable = "dough_recipes" | "sauce_recipes" | "cheese_recipes" | "mixes";
export type ReconciliationProposal = {
  classification: "automatic";
  action: "replace-components-from-approved-source" | "link-source-identity";
  table: ReconciliationTable;
  before: { id: string; name: string };
  after: Record<string, unknown>;
};
export type SourceLibraryReconciliationPlan = {
  replacements: ReconciliationProposal[];
  links: ReconciliationProposal[];
  allZeroStubs: Array<{ table: "cheese_recipes"; id: string; name: string; canonicalId: string; canonicalName: string }>;
};
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Reject every report field outside the reviewed automatic action boundary. */
export function parseSourceLibraryReconciliationPlan(value: unknown): SourceLibraryReconciliationPlan {
  if (!isRecord(value)) throw new Error("Invalid source-library reconciliation report");
  const validTables = new Set<ReconciliationTable>(["dough_recipes", "sauce_recipes", "cheese_recipes", "mixes"]);
  const generated = Array.isArray(value.replacements) && Array.isArray(value.links);
  const raw = generated ? [
    ...(value.replacements as unknown[]).map((p) => ({ ...(p as Record<string, unknown>), classification: "automatic", action: "replace-components-from-approved-source" })),
    ...(value.links as unknown[]).map((p) => ({ ...(p as Record<string, unknown>), classification: "automatic", action: "link-source-identity" })),
  ] : value.proposals;
  const proposals = (Array.isArray(raw) ? raw : []).filter((p): p is Record<string, unknown> => isRecord(p) && p.classification === "automatic").map((proposal) => {
    if (
      (proposal.action !== "replace-components-from-approved-source" && proposal.action !== "link-source-identity") ||
      typeof proposal.table !== "string" || !validTables.has(proposal.table as ReconciliationTable) ||
      !isRecord(proposal.before) || typeof proposal.before.id !== "string" || typeof proposal.before.name !== "string" ||
      !isRecord(proposal.after)
    ) throw new Error("Invalid automatic source-library reconciliation proposal");
    if (proposal.action === "link-source-identity" && typeof proposal.after.sourceName !== "string") throw new Error("Invalid source-library identity-link proposal");
    if (proposal.action === "replace-components-from-approved-source" && !Array.isArray(proposal.after.components)) throw new Error("Invalid source-library replacement proposal");
    return proposal as ReconciliationProposal;
  });
  const stubs = generated ? value.allZeroStubs : isRecord(value.findings) ? value.findings.allZeroStubs : undefined;
  if (!Array.isArray(stubs)) throw new Error("Invalid source-library stub list");
  const allZeroStubs = stubs.map((stub) => {
    if (!isRecord(stub) || stub.table !== "cheese_recipes" || typeof stub.id !== "string" || typeof stub.name !== "string" || typeof stub.canonicalId !== "string" || typeof stub.canonicalName !== "string") {
      throw new Error("Invalid source-library zero stub");
    }
    return { table: "cheese_recipes" as const, id: stub.id, name: stub.name, canonicalId: stub.canonicalId, canonicalName: stub.canonicalName };
  });
  if (allZeroStubs.length !== 3) throw new Error("Unexpected source-library zero stub count");
  const replacements = proposals.filter((proposal) => proposal.action === "replace-components-from-approved-source");
  const links = proposals.filter((proposal) => proposal.action === "link-source-identity");
  if (replacements.length !== 46 || links.length !== 22) throw new Error("Unexpected source-library automatic proposal count");
  return { replacements, links, allZeroStubs };
}
export function loadSourceLibraryReconciliationPlan(): SourceLibraryReconciliationPlan {
  return SOURCE_LIBRARY_RECONCILIATION_PLAN;
}
export { SOURCE_LIBRARY_RECONCILIATION_PLAN_SHA256 };
export const SOURCE_LIBRARY_RECONCILIATION_PLAN = parseSourceLibraryReconciliationPlan(
  JSON.parse(gunzipSync(Buffer.from(SOURCE_LIBRARY_RECONCILIATION_PLAN_GZIP_BASE64, "base64")).toString("utf8")),
);

type JsonRecord = Record<string, unknown>;
type ReconciliationCategory =
  | "pool-mismatch"
  | "alias-gap"
  | "stale-profile-link"
  | "stale-pending-run-link"
  | "protected-stub"
  | "unexpected-stub";
type ReconciliationSeverity = "info" | "warning" | "error";
const MAX_FINDINGS_PER_CATEGORY = 50;

export type SourceLibraryReconciliationFinding = {
  id: string;
  category: ReconciliationCategory;
  severity: ReconciliationSeverity;
  affectedRecord: string;
  currentValue: string;
  proposedOutcome: string;
  protectedValue: boolean;
  sourceRoute: "dough" | "sauce" | "cheeseRecipes" | "mixes" | "import" | "setupProfiles" | "audit";
};

export type SourceLibraryReconciliationStatus = {
  report: {
    path: string;
    sha256: string;
    formatVersion: 1;
    automaticProposals: number;
    stubs: number;
    planSha256: string;
    snapshot: typeof SOURCE_LIBRARY_RECONCILIATION_SNAPSHOT;
    manifest: typeof SOURCE_LIBRARY_RECONCILIATION_MANIFEST;
  };
  heal: {
    id: string;
    fromDate: string;
    appliedAt: string | null;
    markerValid: boolean;
    result: Record<string, number>;
  };
  checkedAt: string;
  status: "clean" | "warning" | "error" | "not-verified";
  freshness: "current" | "stale";
  summary: {
    poolMismatches: number;
    aliasGaps: number;
    staleProfileLinks: number;
    stalePendingRunLinks: number;
    protectedStubs: number;
    unexpectedStubs: number;
    protectedHistoryReferences: number;
    omittedFindings: number;
    findingLimitPerCategory: number;
  };
  findings: SourceLibraryReconciliationFinding[];
};

type ReconciliationExecutor = Pick<typeof db, "select">;

const record = (value: unknown): JsonRecord => isRecord(value) ? value : {};
const key = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
const rows = (value: unknown): JsonRecord[] => Array.isArray(value)
  ? value.filter(isRecord)
  : [];
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (!isRecord(value)) return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((field) => `${JSON.stringify(field)}:${stable(value[field])}`).join(",")}}`;
};
const numberValue = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const positive = (value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0;

function sourceMappings() {
  return [
    ...SOURCE_LIBRARY_RECONCILIATION_PLAN.links.map((proposal) => ({
      old: String(proposal.after.sourceName),
      canonical: proposal.before.name,
    })),
    ...SOURCE_LIBRARY_RECONCILIATION_PLAN.allZeroStubs.map((stub) => ({
      old: stub.name,
      canonical: stub.canonicalName,
    })),
  ];
}

function mappingFor(value: string) {
  const normalized = key(value);
  return sourceMappings().filter((mapping) => key(mapping.old) === normalized || key(mapping.canonical) === normalized);
}

function referenceState(value: string) {
  const matches = mappingFor(value);
  const old = matches.some((mapping) => key(value) === key(mapping.old));
  const canonicalExact = !old && matches.some((mapping) => value === mapping.canonical);
  const nonCanonical = !old && !canonicalExact && matches.some((mapping) => key(value) === key(mapping.canonical));
  return { old, nonCanonical, canonical: canonicalExact };
}

function poolFields(proposal: ReconciliationProposal): JsonRecord {
  const after = proposal.after;
  const fields = ["components"];
  if (proposal.table === "dough_recipes") fields.push("doughballVariants", "doughballWeightOz", "doughballsPerTray");
  if (proposal.table === "cheese_recipes") fields.push("brand", "flavors", "shredderSetting", "cellulose", "notes");
  if (proposal.table === "mixes") {
    fields.push("brand", "flavor", "daysEarly", "batchSize");
    if (Object.prototype.hasOwnProperty.call(after, "notes")) fields.push("notes");
  }
  return Object.fromEntries(fields.filter((field) => Object.prototype.hasOwnProperty.call(after, field))
    .map((field) => [field, after[field]]));
}

function poolRoute(table: ReconciliationTable): SourceLibraryReconciliationFinding["sourceRoute"] {
  return table === "dough_recipes" ? "dough"
    : table === "sauce_recipes" ? "sauce"
      : table === "cheese_recipes" ? "cheeseRecipes" : "mixes";
}

function poolLabel(table: ReconciliationTable) {
  return table.replace("_recipes", "").replace("mixes", "mix");
}

function poolFindings(rowsByTable: Record<ReconciliationTable, JsonRecord[]>): SourceLibraryReconciliationFinding[] {
  const findings: SourceLibraryReconciliationFinding[] = [];
  for (const raw of [...SOURCE_LIBRARY_RECONCILIATION_PLAN.replacements, ...SOURCE_LIBRARY_RECONCILIATION_PLAN.links]) {
    const proposal = raw as ReconciliationProposal;
    const row = rowsByTable[proposal.table].find((candidate) => candidate.id === proposal.before.id);
    const affectedRecord = `${poolLabel(proposal.table)}:${proposal.before.id}`;
    if (!row) {
      findings.push({
        id: `source:pool-missing:${proposal.table}:${proposal.before.id}`,
        category: "pool-mismatch",
        severity: "error",
        affectedRecord,
        currentValue: "Missing from the current pool",
        proposedOutcome: `Restore the approved ${poolLabel(proposal.table)} source record "${proposal.before.name}" after manager review.`,
        protectedValue: true,
        sourceRoute: poolRoute(proposal.table),
      });
      continue;
    }
    if (row.name !== proposal.before.name) {
      findings.push({
        id: `source:pool-renamed:${proposal.table}:${proposal.before.id}`,
        category: "pool-mismatch",
        severity: "warning",
        affectedRecord,
        currentValue: `Current name "${String(row.name ?? "unnamed")}"`,
        proposedOutcome: `Review the renamed pool record against approved source name "${proposal.before.name}"; preserve manager history until confirmed.`,
        protectedValue: true,
        sourceRoute: poolRoute(proposal.table),
      });
      continue;
    }
    if (proposal.action !== "replace-components-from-approved-source") continue;
    const expected = poolFields(proposal);
    const actual = Object.fromEntries(Object.keys(expected).map((field) => [field, row[field]]));
    if (stable(expected) !== stable(actual)) {
      findings.push({
        id: `source:pool-mismatch:${proposal.table}:${proposal.before.id}`,
        category: "pool-mismatch",
        severity: "warning",
        affectedRecord,
        currentValue: "Current pool values differ from the approved source",
        proposedOutcome: `Review the exact approved source values for "${proposal.before.name}" before replacing manager-owned recipe data.`,
        protectedValue: true,
        sourceRoute: poolRoute(proposal.table),
      });
    }
  }
  return findings;
}

function aliasFindings(aliasRows: JsonRecord[]): SourceLibraryReconciliationFinding[] {
  const expected = sourceMappings();
  const findings: SourceLibraryReconciliationFinding[] = [];
  for (const mapping of expected) {
    const matches = aliasRows.filter((row) => key(row.externalName) === key(mapping.old));
    const exact = matches.find((row) => key(row.canonicalName) === key(mapping.canonical));
    if (exact) continue;
    const current = matches.map((row) => String(row.canonicalName ?? "")).filter(Boolean).join(", ");
    findings.push({
      id: `source:alias-gap:${key(mapping.old)}`,
      category: "alias-gap",
      severity: current ? "warning" : "error",
      affectedRecord: `appType alias:${mapping.old}`,
      currentValue: current ? `Mapped to "${current}"` : "No matching alias",
      proposedOutcome: `Review and map "${mapping.old}" to approved source name "${mapping.canonical}" in Import Review.`,
      protectedValue: true,
      sourceRoute: "import",
    });
  }
  return findings;
}

function referenceFindings(
  profiles: JsonRecord[],
  days: JsonRecord[],
): {
  findings: SourceLibraryReconciliationFinding[];
  protectedHistoryReferences: number;
  protectedHistoryReferenceKeys: Set<string>;
} {
  const findings: SourceLibraryReconciliationFinding[] = [];
  let protectedHistoryReferences = 0;
  const protectedHistoryReferenceKeys = new Set<string>();
  const fields = ["doughRecipeName", "frontlineRecipeName", "app1CheeseRecipeName", "app2CheeseRecipeName", "app3CheeseRecipeName", "app4CheeseRecipeName"];
  for (const profile of profiles) {
    const sources = [record(profile.values), record(profile.crustValues)];
    for (const source of sources) {
      for (const field of fields) {
        const value = String(source[field] ?? "");
        if (!value) continue;
        const state = referenceState(value);
        if (!state.old && !state.nonCanonical) continue;
        const mapping = mappingFor(value)[0];
        findings.push({
          id: `source:profile-link:${String(profile.key)}:${field}:${key(value)}`,
          category: "stale-profile-link",
          severity: state.old ? "warning" : "info",
          affectedRecord: `profile:${String(profile.key)}:${field}`,
          currentValue: value,
          proposedOutcome: `Review profile link and use approved source name "${mapping?.canonical ?? value}".`,
          protectedValue: true,
          sourceRoute: "setupProfiles",
        });
      }
    }
  }
  for (const day of days) {
    const data = record(day.data);
    const state = record(data.dayState);
    const runValues = record(data.runValues);
    const runs = Array.isArray(state.runs) ? state.runs : [];
    for (const rawRun of runs) {
      const run = record(rawRun);
      const runId = String(run.id ?? "");
      if (!runId) continue;
      const started = run.startedAt != null || run.endedAt != null;
      const runValue = record(runValues[runId]);
      for (const field of fields) {
        const value = String(runValue[field] ?? "");
        if (!value) continue;
        const reference = referenceState(value);
        if (!reference.old && !reference.nonCanonical) continue;
        if (started || String(day.date) < SOURCE_LIBRARY_RECONCILIATION_FROM_DATE) {
          protectedHistoryReferences++;
          protectedHistoryReferenceKeys.add(key(value));
          continue;
        }
        const mapping = mappingFor(value)[0];
        findings.push({
          id: `source:pending-link:${String(day.date)}:${runId}:${field}:${key(value)}`,
          category: "stale-pending-run-link",
          severity: reference.old ? "warning" : "info",
          affectedRecord: `pending run:${String(day.date)}/${runId}:${field}`,
          currentValue: value,
          proposedOutcome: `Review the pending run link and use approved source name "${mapping?.canonical ?? value}".`,
          protectedValue: false,
          sourceRoute: "setupProfiles",
        });
      }
    }
  }
  return { findings, protectedHistoryReferences, protectedHistoryReferenceKeys };
}

function stubFindings(
  rows: JsonRecord[],
  protectedHistoryReferenceKeys: ReadonlySet<string>,
): SourceLibraryReconciliationFinding[] {
  const findings: SourceLibraryReconciliationFinding[] = [];
  for (const stub of SOURCE_LIBRARY_RECONCILIATION_PLAN.allZeroStubs) {
    const current = rows.find((row) => row.id === stub.id);
    const canonical = rows.find((row) => row.id === stub.canonicalId);
    const protectedByHistory = protectedHistoryReferenceKeys.has(key(stub.name));
    if (!canonical) {
      findings.push({
        id: `source:stub-canonical-missing:${stub.canonicalId}`,
        category: "protected-stub",
        severity: "error",
        affectedRecord: `cheese stub:${stub.id}`,
        currentValue: "Approved canonical record is missing",
        proposedOutcome: `Restore or link the approved canonical cheese recipe "${stub.canonicalName}" before removing any stub.`,
        protectedValue: true,
        sourceRoute: "cheeseRecipes",
      });
    }
    if (!current) continue;
    const hasPositive = rowsOf(current.components).some((component) =>
      positive(component.lbs) || positive(component.ozPerPizza) || positive(component.perPizza));
    if (hasPositive || protectedByHistory) {
      findings.push({
        id: `source:stub-protected:${stub.id}`,
        category: "protected-stub",
        severity: "info",
        affectedRecord: `cheese stub:${stub.id}`,
        currentValue: `Protected record "${String(current.name ?? stub.name)}" remains`,
        proposedOutcome: `Preserve this stub until its historical references are reviewed; canonical target is "${stub.canonicalName}".`,
        protectedValue: true,
        sourceRoute: "cheeseRecipes",
      });
    } else {
      findings.push({
        id: `source:stub-unexpected:${stub.id}`,
        category: "unexpected-stub",
        severity: "warning",
        affectedRecord: `cheese stub:${stub.id}`,
        currentValue: `Zero-value record "${String(current.name ?? stub.name)}" remains`,
        proposedOutcome: `Review whether this zero-value stub can be removed; canonical target is "${stub.canonicalName}".`,
        protectedValue: false,
        sourceRoute: "cheeseRecipes",
      });
    }
  }
  return findings;
}

function rowsOf(value: unknown): JsonRecord[] {
  return rows(value);
}

export async function sourceLibraryReconciliationStatus(
  executor: ReconciliationExecutor,
  scope: string,
): Promise<SourceLibraryReconciliationStatus> {
  const [dough, sauce, cheese, mixes, profiles, days, aliases, marker] = await Promise.all([
    executor.select().from(doughRecipesTable).where(eq(doughRecipesTable.scope, scope)),
    executor.select().from(sauceRecipesTable).where(eq(sauceRecipesTable.scope, scope)),
    executor.select().from(cheeseRecipesTable).where(eq(cheeseRecipesTable.scope, scope)),
    executor.select().from(mixesTable).where(eq(mixesTable.scope, scope)),
    executor.select().from(brandProfilesTable).where(eq(brandProfilesTable.scope, scope)),
    executor.select().from(dailySyncTable).where(eq(dailySyncTable.scope, scope)),
    executor.select().from(specImportAliasesTable).where(and(
      eq(specImportAliasesTable.scope, scope),
      eq(specImportAliasesTable.kind, "appType"),
    )),
    executor.select({
      appliedAt: dataHealsTable.appliedAt,
      result: dataHealsTable.result,
    }).from(dataHealsTable).where(eq(dataHealsTable.id, SOURCE_LIBRARY_RECONCILIATION_HEAL_ID)).limit(1),
  ]);
  const rowsByTable = {
    dough_recipes: rows(dough),
    sauce_recipes: rows(sauce),
    cheese_recipes: rows(cheese),
    mixes: rows(mixes),
  } as Record<ReconciliationTable, JsonRecord[]>;
  const findings = [
    ...poolFindings(rowsByTable),
    ...aliasFindings(rows(aliases)),
  ];
  const references = referenceFindings(rows(profiles), rows(days));
  findings.push(...references.findings);
  findings.push(...stubFindings(rows(cheese), references.protectedHistoryReferenceKeys));
  findings.sort((left, right) => left.id.localeCompare(right.id));
  const markerRow = scope === "live" ? marker[0] : undefined;
  const markerResult = record(markerRow?.result);
  const markerKeys = ["replacements", "aliasesInserted", "repointedProfiles", "repointedRuns", "deletedStubs"];
  const markerValid = scope === "live" && Boolean(markerRow?.appliedAt) &&
    markerKeys.every((field) => Number.isInteger(Number(markerResult[field])) && Number(markerResult[field]) >= 0);
  const hasErrors = findings.some((finding) => finding.severity === "error");
  const status = scope !== "live" || !markerRow ? "not-verified"
    : !markerValid || hasErrors ? "error"
      : findings.length > 0 ? "warning" : "clean";
  const categoryCounts = new Map<ReconciliationCategory, number>();
  const boundedFindings = findings.filter((finding) => {
    const count = categoryCounts.get(finding.category) ?? 0;
    categoryCounts.set(finding.category, count + 1);
    return count < MAX_FINDINGS_PER_CATEGORY;
  });
  const summary = {
    poolMismatches: findings.filter((finding) => finding.category === "pool-mismatch").length,
    aliasGaps: findings.filter((finding) => finding.category === "alias-gap").length,
    staleProfileLinks: findings.filter((finding) => finding.category === "stale-profile-link").length,
    stalePendingRunLinks: findings.filter((finding) => finding.category === "stale-pending-run-link").length,
    protectedStubs: findings.filter((finding) => finding.category === "protected-stub").length,
    unexpectedStubs: findings.filter((finding) => finding.category === "unexpected-stub").length,
    protectedHistoryReferences: references.protectedHistoryReferences,
    omittedFindings: findings.length - boundedFindings.length,
    findingLimitPerCategory: MAX_FINDINGS_PER_CATEGORY,
  };
  return {
    report: {
      path: SOURCE_LIBRARY_RECONCILIATION_REPORT,
      sha256: SOURCE_LIBRARY_RECONCILIATION_REPORT_SHA256,
      formatVersion: 1,
      automaticProposals: SOURCE_LIBRARY_RECONCILIATION_PLAN.replacements.length + SOURCE_LIBRARY_RECONCILIATION_PLAN.links.length,
      stubs: SOURCE_LIBRARY_RECONCILIATION_PLAN.allZeroStubs.length,
      planSha256: SOURCE_LIBRARY_RECONCILIATION_PLAN_SHA256,
      snapshot: SOURCE_LIBRARY_RECONCILIATION_SNAPSHOT,
      manifest: SOURCE_LIBRARY_RECONCILIATION_MANIFEST,
    },
    heal: {
      id: SOURCE_LIBRARY_RECONCILIATION_HEAL_ID,
      fromDate: SOURCE_LIBRARY_RECONCILIATION_FROM_DATE,
      appliedAt: markerRow?.appliedAt?.toISOString?.() ?? null,
      markerValid,
      result: Object.fromEntries(markerKeys.map((field) => [field, numberValue(markerResult[field])])),
    },
    checkedAt: new Date().toISOString(),
    status,
    freshness: markerValid ? "current" : "stale",
    summary,
    findings: boundedFindings,
  };
}