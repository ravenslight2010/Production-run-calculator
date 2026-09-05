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
console.log("Source library reconciliation verifier tests passed.");
