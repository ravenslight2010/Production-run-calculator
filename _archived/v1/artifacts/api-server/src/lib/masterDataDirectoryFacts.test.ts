import { expect, it } from "vitest";
import { directoryFactFingerprint, restoreDirectoryFactValue, scopedDirectoryEvidence } from "./masterDataDirectoryFacts";
import type { MasterDataFact } from "@workspace/db/schema";
it("restores only owned names, preserving later independent additions and capitalization", () => {
  const fact: MasterDataFact = { entity: "directories", key: "run-calc-dough-recipe-names",
    before: { value: ["Old", "Other"] }, after: { value: ["Other", "New"] } };
  const current = { value: ["Other", "New", "Later"] };
  expect(directoryFactFingerprint(fact, current)).toEqual(directoryFactFingerprint(fact, fact.after));
  expect(restoreDirectoryFactValue(fact, current)).toEqual(["Old", "Other", "Later"]);
  expect(directoryFactFingerprint(fact, { value: ["Other", "NEW", "Later"] })).not.toEqual(directoryFactFingerprint(fact, fact.after));
});
it("guards only the originally changed name clocks, including another name in the same namespace", () => {
  const fact: MasterDataFact = { entity: "directories", key: "run-calc-deleted-stamps",
    before: null, after: { value: { doughRecipeNames: { old: 100 } } } };
  expect(directoryFactFingerprint(fact, { value: { doughRecipeNames: { old: 100, later: 200 } } }))
    .toEqual(directoryFactFingerprint(fact, fact.after));
  expect(directoryFactFingerprint(fact, { value: { doughRecipeNames: { old: 101 } } }))
    .not.toEqual(directoryFactFingerprint(fact, fact.after));
});
it("retains only changed directory entries, never unrelated nested recovery or security data", () => {
  const fact: MasterDataFact = { entity: "directories", key: "run-calc-deleted-stamps",
    before: { value: { doughRecipeNames: { unrelated: 50 }, unrelatedDomain: { session: "synthetic-private-sentinel" } } },
    after: { value: { doughRecipeNames: { unrelated: 50, owned: 100 }, unrelatedDomain: { session: "synthetic-private-sentinel" } } } };
  const [scoped] = scopedDirectoryEvidence([fact]);
  expect(scoped.before?.value).toEqual({ doughRecipeNames: {} });
  expect(scoped.after?.value).toEqual({ doughRecipeNames: { owned: 100 } });
  expect(JSON.stringify(scoped)).not.toContain("synthetic-private-sentinel");
  expect(directoryFactFingerprint(scoped, fact.after)).toEqual(directoryFactFingerprint(scoped, scoped.after));
});
