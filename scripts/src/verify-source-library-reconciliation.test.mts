import assert from "node:assert/strict";
import fs from "node:fs";
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
  if (text.includes("FROM daily_sync")) return { rows: [] };
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
      rows: report.findings.allZeroStubs.map((stub) => ({
        id: (stub as Record<string, unknown>).canonicalId,
        name: (stub as Record<string, unknown>).canonicalName,
        components: [{ lbs: 1 }],
      })),
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
assert.equal(output.stubs.canonicalExact, 3);
assert.equal(output.stubs.deletedExpected, 3);
assert.match(output.idempotencyFingerprint.value, /^[a-f0-9]{64}$/);
assert.ok(queries.length > 0);
console.log("Source library reconciliation verifier tests passed.");