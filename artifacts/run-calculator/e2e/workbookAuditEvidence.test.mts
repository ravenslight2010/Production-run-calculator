import assert from "node:assert/strict";
import test from "node:test";
import { getWorkbookAuditFailureEntries } from "./workbookAuditEvidence.mts";

test("reads versioned failure-ledger entries without dropping envelope metadata", () => {
  const ledger = {
    format: "workbook-import-failure-ledger",
    formatVersion: 1,
    source: { baseRevision: "fixture-revision" },
    entries: [{ sha256: "fixture-hash", status: "NEEDS_AI" }],
  };

  assert.equal(getWorkbookAuditFailureEntries(ledger), ledger.entries);
  assert.deepEqual(ledger.source, { baseRevision: "fixture-revision" });
});

test("fails explicitly when the evidence envelope has no entries array", () => {
  assert.throws(() => getWorkbookAuditFailureEntries(null), /missing its entries array/);
  assert.throws(() => getWorkbookAuditFailureEntries([]), /missing its entries array/);
  assert.throws(
    () => getWorkbookAuditFailureEntries({ failures: [] }),
    /missing its entries array/,
  );
});
