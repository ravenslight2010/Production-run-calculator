// @vitest-environment node
import { expect, it } from "vitest";
import { adoptGuardedPendingReferences } from "./guardedMasterDataAdoption";
const values = { doughRecipeName: "New", cases: 55, doughBatches: 8, totalSkids: 2 };
const operation = { status: "undone" as const, affectedRunReferences: [
  { date: "2026-10-23", runId: "pending", section: "values" as const, field: "doughRecipeName", before: "Old", after: "New", beforeExists: true, afterExists: true },
] };
const input = { date: "2026-10-23", originRunId: "pending", run: { id: "pending" },
  original: values, current: values, canonical: { ...values, doughRecipeName: "Old", cases: 0, doughBatches: 0 }, operation };
it("adopts only confirmed setup references and leaves every counter unchanged", () => {
  expect(adoptGuardedPendingReferences(input)).toEqual({ ...values, doughRecipeName: "Old" });
});
it.each([{ id: "pending", startedAt: 1 }, { id: "pending", endedAt: 1 }, { id: "another" }])("never resets a live, ended or newly selected run %j", (run) => {
  expect(adoptGuardedPendingReferences({ ...input, run })).toBeNull();
});
it("retains unrelated local edits and reference changes made before or during the request", () => {
  expect(adoptGuardedPendingReferences({ ...input, current: { ...values, cases: 99 } })).toEqual({ ...values, cases: 99, doughRecipeName: "Old" });
  expect(adoptGuardedPendingReferences({ ...input, current: { ...values, doughRecipeName: "Unsent edit" } })).toBeNull();
  expect(adoptGuardedPendingReferences({ ...input, original: { ...values, doughRecipeName: "Unsent edit" } })).toBeNull();
});
it("rejects counter, auth and outbox fields even in a malformed server receipt", () => {
  const references = ["cases", "doughBatches", "supervisorPin", "outbox"].map((field) => ({ ...operation.affectedRunReferences[0], field }));
  expect(adoptGuardedPendingReferences({ ...input, operation: { ...operation, affectedRunReferences: references } })).toBeNull();
});
