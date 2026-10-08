import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  SPEC_IMPORT_GOLD_CRITICAL_FIELDS,
  SPEC_IMPORT_GOLD_REVIEW_FORMAT,
  validateSpecImportGoldReviewBundle,
  type GoldFieldLabel,
  type GoldReviewBundle,
  type JsonValue,
} from "./spec-import-gold-review.js";

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
const timestampOne = "2026-10-01T10:00:00.000Z";
const timestampTwo = "2026-10-01T10:05:00.000Z";
const timestampThree = "2026-10-01T10:10:00.000Z";
const promptSha256 = "a".repeat(64);

function bundleWithLabels(
  first: GoldFieldLabel = { state: "value", value: "Cheese" },
  second: GoldFieldLabel = first,
): GoldReviewBundle {
  const labelsFor = (flavor: GoldFieldLabel): Record<string, GoldFieldLabel> => Object.fromEntries(
    SPEC_IMPORT_GOLD_CRITICAL_FIELDS.map((field) => [
      field,
      field === "profile.flavor" ? flavor : { state: "not_applicable" },
    ]),
  ) as Record<string, GoldFieldLabel>;
  return {
    format: SPEC_IMPORT_GOLD_REVIEW_FORMAT,
    version: 1,
    screening: { screenedCaseCount: 1 },
    evaluation: { parseVersion: "41", systemPromptSha256: promptSha256 },
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
          reviewedAt: timestampOne,
          blindToParserProviderOutput: true,
          blindToOtherReviewer: true,
          labels: labelsFor(first),
        },
        {
          reviewerRef: refs.reviewerTwo,
          sourceOpenedAt: "2026-10-01T09:55:00.000Z",
          reviewedAt: timestampTwo,
          blindToParserProviderOutput: true,
          blindToOtherReviewer: true,
          labels: labelsFor(second),
        },
      ],
      adjudication: {
        adjudicatorRef: refs.adjudicator,
        adjudicatedAt: timestampThree,
        sourceChecked: true,
        fieldCoverageChecked: true,
        outcome: labelsEqualForTest(first, second) ? "confirmed_agreement" : "resolved_disagreements",
        resolvedFields: labelsEqualForTest(first, second) ? {} : { "profile.flavor": first },
      },
    }],
  };
}

function labelsEqualForTest(left: GoldFieldLabel, right: GoldFieldLabel): boolean {
  return canonicalForTest(left) === canonicalForTest(right);
}

function canonicalForTest(value: JsonValue | GoldFieldLabel): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalForTest(item)).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalForTest(value[key as keyof typeof value] as JsonValue)}`,
  ).join(",")}}`;
}

function reverseObjectKeys(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).reverse().map(([key, item]) => [key, reverseObjectKeys(item)]),
    );
  }
  return value;
}

describe("spec-import gold review validation", () => {
  it("counts only authorized, blind, independently labeled, source-adjudicated cases", () => {
    const result = validateSpecImportGoldReviewBundle(bundleWithLabels());

    expect(result.valid).toBe(true);
    expect(result.report.status).toBe("ready");
    expect(result.report.caseCounts).toEqual({
      screened: 1,
      authorized: 1,
      independentlyDoubleLabeled: 1,
      adjudicated: 1,
      eligible: 1,
      notEligibleOrIncomplete: 0,
    });
    expect(result.report.fieldCounts).toEqual({ applicable: 1, finalized: 1, unknown: 0 });
  });

  it("resolves disagreements only when a separate adjudicator records a source check", () => {
    const bundle = bundleWithLabels(
      { state: "value", value: 12 },
      { state: "value", value: 10 },
    );
    const result = validateSpecImportGoldReviewBundle(bundle);
    expect(result.report.caseCounts?.eligible).toBe(1);

    bundle.cases[0]!.adjudication!.sourceChecked = false;
    const unresolved = validateSpecImportGoldReviewBundle(bundle);
    expect(unresolved.report.caseCounts?.eligible).toBe(0);
    expect(unresolved.issueCodes).toContain("adjudication_source_check_missing");
  });

  it("retains explicit unknown field states in aggregate coverage", () => {
    const result = validateSpecImportGoldReviewBundle(bundleWithLabels(
      { state: "unclear" },
      { state: "unclear" },
    ));
    expect(result.report.caseCounts?.eligible).toBe(1);
    expect(result.report.fieldCounts).toEqual({ applicable: 1, finalized: 1, unknown: 1 });
  });

  it("rejects narrowed field coverage instead of counting a partial critical-field review", () => {
    const bundle = bundleWithLabels();
    delete bundle.cases[0]!.reviewers[1]!.labels["recipe.ingredientRows"];

    const result = validateSpecImportGoldReviewBundle(bundle);
    expect(result.valid).toBe(true);
    expect(result.report.caseCounts?.independentlyDoubleLabeled).toBe(0);
    expect(result.report.caseCounts?.eligible).toBe(0);
    expect(result.issueCodes).toContain("case_label_coverage_incomplete");
  });

  it("does not count cases where every critical field is marked not applicable", () => {
    const bundle = bundleWithLabels();
    const allNotApplicable = Object.fromEntries(
      SPEC_IMPORT_GOLD_CRITICAL_FIELDS.map((field) => [field, { state: "not_applicable" }]),
    ) as Record<string, GoldFieldLabel>;
    for (const reviewer of bundle.cases[0]!.reviewers) reviewer.labels = { ...allNotApplicable };

    const result = validateSpecImportGoldReviewBundle(bundle);
    expect(result.report.status).toBe("reviewed_no_eligible_cases");
    expect(result.report.caseCounts?.eligible).toBe(0);
    expect(result.report.fieldCounts).toEqual({ applicable: 0, finalized: 0, unknown: 0 });
    expect(result.issueCodes).toContain("case_no_applicable_critical_fields");
  });

  it("does not describe an empty, unscreened bundle as a completed review", () => {
    const bundle = bundleWithLabels();
    bundle.screening.screenedCaseCount = 0;
    bundle.cases = [];
    const result = validateSpecImportGoldReviewBundle(bundle);
    expect(result.report.status).toBe("in_progress");
    expect(result.report.caseCounts).toEqual({
      screened: 0,
      authorized: 0,
      independentlyDoubleLabeled: 0,
      adjudicated: 0,
      eligible: 0,
      notEligibleOrIncomplete: 0,
    });
  });

  it("fails closed without authorization, private-store, and privacy attestations", () => {
    const bundle = bundleWithLabels();
    bundle.authorization.decision = "not_authorized";
    bundle.storage.accessControlConfirmed = false;
    bundle.privacyReview.decision = "not_approved";

    const result = validateSpecImportGoldReviewBundle(bundle);
    expect(result.valid).toBe(false);
    expect(result.report.status).toBe("blocked");
    expect(result.report.caseCounts).toBeNull();
    expect(result.report.fieldCounts).toBeNull();
    expect(result.report.unreviewedPrivateStoreCaseCount).toBeNull();
    expect(result.report.unreviewedPrivateStoreCaseCountStatus).toBe("unknown_not_accessed");
  });

  it("does not count source records outside the authorized scope", () => {
    const bundle = bundleWithLabels();
    bundle.cases[0]!.sourceEvidenceRef = `source_${"9".repeat(16)}`;
    const result = validateSpecImportGoldReviewBundle(bundle);
    expect(result.valid).toBe(false);
    expect(result.report.caseCounts).toBeNull();
    expect(result.issueCodes).toEqual(["case_source_outside_authorized_scope"]);
  });

  it("blocks source opening before owner authorization or access-control review", () => {
    const beforeAuthorization = bundleWithLabels();
    beforeAuthorization.authorization.authorizedAt = "2026-10-01T10:00:00.000Z";
    const unauthorizedOpen = validateSpecImportGoldReviewBundle(beforeAuthorization);
    expect(unauthorizedOpen.report.caseCounts).toBeNull();
    expect(unauthorizedOpen.issueCodes).toContain("source_opened_before_authorization");

    const beforeAccessReview = bundleWithLabels();
    beforeAccessReview.storage.reviewedAt = "2026-10-01T10:00:00.000Z";
    const accessNotReady = validateSpecImportGoldReviewBundle(beforeAccessReview);
    expect(accessNotReady.report.caseCounts).toBeNull();
    expect(accessNotReady.issueCodes).toContain("storage_review_after_source_open");
  });

  it("blocks a privacy review that predates source labeling or is performed by a label reviewer", () => {
    const earlyPrivacyReview = bundleWithLabels();
    earlyPrivacyReview.privacyReview.reviewedAt = "2026-10-01T10:00:00.000Z";
    const early = validateSpecImportGoldReviewBundle(earlyPrivacyReview);
    expect(early.report.caseCounts).toBeNull();
    expect(early.issueCodes).toContain("privacy_review_predates_review_records");

    const conflictedPrivacyReviewer = bundleWithLabels();
    conflictedPrivacyReviewer.privacyReview.privacyReviewerRef = refs.reviewerOne;
    const conflicted = validateSpecImportGoldReviewBundle(conflictedPrivacyReviewer);
    expect(conflicted.report.caseCounts).toBeNull();
    expect(conflicted.issueCodes).toContain("privacy_reviewer_not_independent");
  });

  it("does not publish case IDs, source references, reviewer identities, or labels", () => {
    const bundle = bundleWithLabels(
      { state: "value", value: "Synthetic private label 9417" },
    );
    const reportText = JSON.stringify(validateSpecImportGoldReviewBundle(bundle).report);
    for (const privateValue of [
      refs.case,
      refs.source,
      refs.reviewerOne,
      refs.reviewerTwo,
      "Synthetic private label 9417",
    ]) {
      expect(reportText).not.toContain(privateValue);
    }
    expect(reportText).toContain('"unreviewedPrivateStoreCaseCount":null');
  });

  it("is invariant to JSON object key order in independently matching labels", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const label: GoldFieldLabel = { state: "value", value: value as JsonValue };
        const reordered: GoldFieldLabel = {
          state: "value",
          value: reverseObjectKeys(value as JsonValue),
        };
        const result = validateSpecImportGoldReviewBundle(bundleWithLabels(label, reordered));
        expect(result.valid).toBe(true);
        expect(result.report.caseCounts?.eligible).toBe(1);
      }),
      { numRuns: 150 },
    );
  });
});
