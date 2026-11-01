import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { parseDeterministicSpecWorkbook } from "@workspace/spec-import";
import {
  SYNTHETIC_REVIEW_BRAND,
  SYNTHETIC_REVIEW_FLAVORS,
  blockUnapprovedRealSourceAudit,
  syntheticReviewParse,
  syntheticReviewWorkbook,
} from "./syntheticWorkbookReview.ts";

const workbook = XLSX.read(syntheticReviewWorkbook(), { type: "buffer" });
assert.deepEqual(workbook.SheetNames, ["OZ"]);
const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets.OZ!, {
  header: 1,
  defval: "",
});
const deterministic = parseDeterministicSpecWorkbook([{ name: "OZ", rows }]);
assert.equal(deterministic.supported, false, "the fixture must actually require fallback");
assert.equal(deterministic.parsed.profiles.length, 0);

const parsed = syntheticReviewParse();
assert.equal(parsed.profiles.length, 3);
assert.deepEqual(parsed.profiles.map((profile) => profile.flavor), SYNTHETIC_REVIEW_FLAVORS);
for (const profile of parsed.profiles) {
  assert.equal(profile.brand, SYNTHETIC_REVIEW_BRAND);
  for (const key of ["brand", "flavor"] as const) {
    const location = profile.sourceLocations[key][0]!;
    assert.equal(location.sheet, "OZ");
    assert.equal(workbook.Sheets.OZ![location.cell]?.v, profile[key]);
  }
}
assert.notEqual(syntheticReviewParse().profiles[0], parsed.profiles[0]);
assert.throws(blockUnapprovedRealSourceAudit, /BLOCKED:.*separate source-use/);

// Guard the local test region against accidentally reintroducing attachment
// reads or a pass-through route when a future fixture is changed.
const source = readFileSync(new URL("./workbook-auto-ai-fallback.spec.ts", import.meta.url), "utf8");
const start = source.indexOf('test("manager gets three synthetic products in review; cancel is read-only"');
assert.ok(start > 0);
const localCases = source.slice(start);
assert.doesNotMatch(localCases, /attached_assets|readFile\(|route\.continue\(/);
assert.equal((localCases.match(/await mockSyntheticNameMatching\(page\)/g) ?? []).length, 2);
assert.match(source, /await page\.route\("\*\*\/api\/ai\/match-import"/);
assert.match(source, /await page\.route\("\*\*\/api\/ai\/\*\*"/);
assert.match(source, /test\.use\(\{ serviceWorkers: "block" \}\)/);
assert.ok(source.indexOf("blockUnapprovedRealSourceAudit();") < start);
console.log("Synthetic workbook boundary: fallback layout, cited cells, fresh payloads and fail-closed source/provider guards passed.");
