import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runSpecImportGoldReviewCli } from "./spec-import-gold-review.mts";
import {
  SPEC_IMPORT_GOLD_CRITICAL_FIELDS,
  SPEC_IMPORT_GOLD_REVIEW_FORMAT,
  type GoldFieldLabel,
  type GoldReviewBundle,
} from "@workspace/ai-evaluation/spec-import-gold-review";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "spec-import-gold-review-"));
const repositoryRoot = path.join(tempRoot, "repo");
const privateRoot = path.join(tempRoot, "private");
fs.mkdirSync(repositoryRoot, { recursive: true });
fs.mkdirSync(privateRoot, { recursive: true, mode: 0o700 });

const refs = {
  auth: `auth_${"a".repeat(16)}`,
  access: `access_${"b".repeat(16)}`,
  privacy: `privacy_${"c".repeat(16)}`,
  privacyReviewer: `reviewer_${"d".repeat(16)}`,
  source: `source_${"e".repeat(16)}`,
  case: `case_${"f".repeat(16)}`,
  reviewerOne: `reviewer_${"1".repeat(16)}`,
  reviewerTwo: `reviewer_${"2".repeat(16)}`,
  adjudicator: `reviewer_${"3".repeat(16)}`,
};

const labels = (): Record<string, GoldFieldLabel> => Object.fromEntries(
  SPEC_IMPORT_GOLD_CRITICAL_FIELDS.map((field) => [
    field,
    field === "profile.flavor"
      ? { state: "value", value: "Synthetic test flavor" }
      : { state: "not_applicable" },
  ]),
) as Record<string, GoldFieldLabel>;

const bundle: GoldReviewBundle = {
  format: SPEC_IMPORT_GOLD_REVIEW_FORMAT,
  version: 1,
  screening: { screenedCaseCount: 1 },
  evaluation: { parseVersion: "41", systemPromptSha256: "a".repeat(64) },
  authorization: {
    decision: "authorized",
    evaluationUse: "spec-import-accuracy",
    ownerAuthorizationRef: refs.auth,
    authorizedAt: "2026-10-01T09:00:00.000Z",
    termsAndRetentionConfirmed: true,
    permittedSourceEvidenceRefs: [refs.source],
  },
  storage: {
    outsideRepository: true,
    accessControlConfirmed: true,
    accessControlReviewRef: refs.access,
    reviewedAt: "2026-10-01T09:05:00.000Z",
  },
  privacyReview: {
    decision: "approved",
    privacyReviewerRef: refs.privacyReviewer,
    privacyReviewRef: refs.privacy,
    reviewedAt: "2026-10-01T10:15:00.000Z",
    sourceContentExcludedFromReport: true,
    identityMappingExcludedFromReport: true,
  },
  cases: [{
    caseId: refs.case,
    sourceKind: "spec_workbook",
    sourceEvidenceRef: refs.source,
    reviewers: [
      {
        reviewerRef: refs.reviewerOne,
        sourceOpenedAt: "2026-10-01T09:55:00.000Z",
        reviewedAt: "2026-10-01T10:00:00.000Z",
        blindToParserProviderOutput: true,
        blindToOtherReviewer: true,
        labels: labels(),
      },
      {
        reviewerRef: refs.reviewerTwo,
        sourceOpenedAt: "2026-10-01T09:55:00.000Z",
        reviewedAt: "2026-10-01T10:05:00.000Z",
        blindToParserProviderOutput: true,
        blindToOtherReviewer: true,
        labels: labels(),
      },
    ],
    adjudication: {
      adjudicatorRef: refs.adjudicator,
      adjudicatedAt: "2026-10-01T10:10:00.000Z",
      sourceChecked: true,
      fieldCoverageChecked: true,
      outcome: "confirmed_agreement",
      resolvedFields: {},
    },
  }],
};

const outputs: string[] = [];
const errors: string[] = [];
const dependencies = {
  repositoryRoot,
  stdout: (text: string) => outputs.push(text),
  stderr: (text: string) => errors.push(text),
};

try {
  const bundlePath = path.join(privateRoot, "review-bundle.json");
  fs.writeFileSync(bundlePath, JSON.stringify(bundle), { mode: 0o600 });

  assert.equal(runSpecImportGoldReviewCli(["--bundle", bundlePath], dependencies), 0);
  const reportText = outputs.pop()!;
  const report = JSON.parse(reportText) as {
    status: string;
    caseCounts: { eligible: number };
    unreviewedPrivateStoreCaseCount: number | null;
  };
  assert.equal(report.status, "ready");
  assert.equal(report.caseCounts.eligible, 1);
  assert.equal(report.unreviewedPrivateStoreCaseCount, null);
  for (const privateValue of [
    refs.case,
    refs.source,
    refs.reviewerOne,
    refs.auth,
    "Synthetic test flavor",
    privateRoot,
  ]) {
    assert.equal(reportText.includes(privateValue), false);
  }

  const repoBundle = path.join(repositoryRoot, "review-bundle.json");
  fs.writeFileSync(repoBundle, JSON.stringify(bundle));
  assert.equal(runSpecImportGoldReviewCli(["--bundle", repoBundle], dependencies), 2);
  assert.match(outputs.pop()!, /bundle_must_be_outside_repository/u);

  const privateSymlink = path.join(privateRoot, "repository-bundle-link.json");
  fs.symlinkSync(repoBundle, privateSymlink);
  assert.equal(runSpecImportGoldReviewCli(["--bundle", privateSymlink], dependencies), 2);
  assert.match(outputs.pop()!, /bundle_must_be_outside_repository/u);

  assert.equal(runSpecImportGoldReviewCli(["--bundle", "relative.json"], dependencies), 2);
  assert.match(outputs.pop()!, /bundle_path_must_be_absolute/u);

  assert.equal(runSpecImportGoldReviewCli([], dependencies), 2);
  assert.match(outputs.pop()!, /private_review_bundle_required/u);

  assert.equal(runSpecImportGoldReviewCli(["--help"], dependencies), 0);
  assert.match(outputs.pop()!, /Usage:/u);
  assert.equal(runSpecImportGoldReviewCli(["--", "--help"], dependencies), 0);
  assert.match(outputs.pop()!, /Usage:/u);
  assert.deepEqual(errors, []);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
