export const SPEC_IMPORT_GOLD_REVIEW_FORMAT = "spec-import-gold-review-bundle";
export const SPEC_IMPORT_GOLD_REVIEW_VERSION = 1;
export const SPEC_IMPORT_GOLD_CRITICAL_FIELDS = [
  "profile.brand",
  "profile.flavor",
  "profile.allergens",
  "profile.pizzasPerCase",
  "profile.dieType",
  "profile.doughOrCrust",
  "profile.doughballWeight",
  "profile.doughballsPerTray",
  "profile.sauceIdentity",
  "profile.sauceOzPerPizza",
  "profile.applicatorIdentitiesAndWeights",
  "profile.pepperoniIdentitiesAndWeights",
  "recipe.kind",
  "recipe.name",
  "recipe.ingredientRows",
  "recipe.units",
  "recipe.profileTargets",
] as const;

const MAX_CASES = 5_000;
const MAX_FIELDS_PER_CASE = 250;
const MAX_REVIEW_BUNDLE_BYTES = 25 * 1024 * 1024;

type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type GoldFieldLabel =
  | { state: "value"; value: JsonValue }
  | { state: "not_present" | "not_applicable" | "unclear" | "not_inferable" };

export type GoldReviewBundle = {
  format: typeof SPEC_IMPORT_GOLD_REVIEW_FORMAT;
  version: typeof SPEC_IMPORT_GOLD_REVIEW_VERSION;
  screening: { screenedCaseCount: number };
  evaluation: { parseVersion: string; systemPromptSha256: string };
  authorization: {
    decision: "authorized" | "not_authorized";
    evaluationUse: "spec-import-accuracy";
    ownerAuthorizationRef: string;
    authorizedAt: string;
    termsAndRetentionConfirmed: boolean;
    permittedSourceEvidenceRefs: string[];
  };
  storage: {
    outsideRepository: boolean;
    accessControlConfirmed: boolean;
    accessControlReviewRef: string;
    reviewedAt: string;
  };
  privacyReview: {
    decision: "approved" | "not_approved";
    privacyReviewerRef: string;
    privacyReviewRef: string;
    reviewedAt: string;
    sourceContentExcludedFromReport: boolean;
    identityMappingExcludedFromReport: boolean;
  };
  cases: GoldReviewCase[];
};

export type GoldReviewCase = {
  caseId: string;
  sourceKind: "spec_workbook" | "apply_record_with_source_check";
  sourceEvidenceRef: string;
  reviewers: GoldReviewerRecord[];
  adjudication?: GoldAdjudication;
};

export type GoldReviewerRecord = {
  reviewerRef: string;
  sourceOpenedAt: string;
  reviewedAt: string;
  blindToParserProviderOutput: boolean;
  blindToOtherReviewer: boolean;
  labels: Record<string, GoldFieldLabel>;
};

export type GoldAdjudication = {
  adjudicatorRef: string;
  adjudicatedAt: string;
  sourceChecked: boolean;
  fieldCoverageChecked: boolean;
  outcome: "confirmed_agreement" | "resolved_disagreements";
  resolvedFields: Record<string, GoldFieldLabel>;
};

export type SpecImportGoldReviewReport = {
  format: "spec-import-gold-review-aggregate";
  version: 1;
  status: "blocked" | "in_progress" | "reviewed_no_eligible_cases" | "ready";
  provenance: {
    parseVersion: string | null;
    systemPromptSha256: string | null;
    scope: "provided_private_bundle_only";
  };
  caseCounts: {
    screened: number;
    authorized: number;
    independentlyDoubleLabeled: number;
    adjudicated: number;
    eligible: number;
    notEligibleOrIncomplete: number;
  } | null;
  fieldCounts: {
    applicable: number;
    finalized: number;
    unknown: number;
  } | null;
  authorization: "not_verified" | "recorded_not_independently_verified";
  accessControl: "not_verified" | "attested_not_independently_verified";
  privacyReview: "not_approved" | "approved";
  unreviewedPrivateStoreCaseCount: null;
  unreviewedPrivateStoreCaseCountStatus: "unknown_not_accessed";
  issueCodes: string[];
};

export type SpecImportGoldReviewValidation = {
  valid: boolean;
  issueCodes: string[];
  report: SpecImportGoldReviewReport;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

function isIsoDateTime(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
    && Number.isFinite(Date.parse(value));
}

function isOpaqueRef(value: unknown, prefix: string): value is string {
  return typeof value === "string" && new RegExp(`^${prefix}_[a-f0-9]{16,64}$`, "u").test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > 16) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 10_000 && value.every((item) => isJsonValue(item, depth + 1));
  if (!isRecord(value)) return false;
  return Object.keys(value).length <= 2_000
    && Object.values(value).every((item) => isJsonValue(item, depth + 1));
}

function isFieldLabel(value: unknown): value is GoldFieldLabel {
  if (!isRecord(value)) return false;
  if (value.state === "value") {
    return hasExactKeys(value, ["state", "value"])
      && isJsonValue(value.value);
  }
  return hasExactKeys(value, ["state"])
    && (value.state === "not_present"
      || value.state === "not_applicable"
      || value.state === "unclear"
      || value.state === "not_inferable");
}

function isLabelRecord(value: unknown): value is Record<string, GoldFieldLabel> {
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= MAX_FIELDS_PER_CASE
    && entries.every(([field, label]) =>
      SPEC_IMPORT_GOLD_CRITICAL_FIELDS.includes(field as typeof SPEC_IMPORT_GOLD_CRITICAL_FIELDS[number])
      && isFieldLabel(label));
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, JsonValue>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key]!)}`).join(",")}}`;
}

function labelsEqual(left: GoldFieldLabel, right: GoldFieldLabel): boolean {
  return canonicalJson(left as unknown as JsonValue) === canonicalJson(right as unknown as JsonValue);
}

function addIssue(issues: Set<string>, code: string): void {
  issues.add(code);
}

function blockedReport(
  issues: string[],
  authorization: SpecImportGoldReviewReport["authorization"] = "not_verified",
  accessControl: SpecImportGoldReviewReport["accessControl"] = "not_verified",
  privacyReview: SpecImportGoldReviewReport["privacyReview"] = "not_approved",
): SpecImportGoldReviewReport {
  return {
    format: "spec-import-gold-review-aggregate",
    version: 1,
    status: "blocked",
    provenance: {
      parseVersion: null,
      systemPromptSha256: null,
      scope: "provided_private_bundle_only",
    },
    caseCounts: null,
    fieldCounts: null,
    authorization,
    accessControl,
    privacyReview,
    unreviewedPrivateStoreCaseCount: null,
    unreviewedPrivateStoreCaseCountStatus: "unknown_not_accessed",
    issueCodes: issues,
  };
}

function validateReviewer(value: unknown): value is GoldReviewerRecord {
  if (!isRecord(value)
    || !hasExactKeys(value, [
      "reviewerRef",
      "sourceOpenedAt",
      "reviewedAt",
      "blindToParserProviderOutput",
      "blindToOtherReviewer",
      "labels",
    ])) return false;
  return isOpaqueRef(value.reviewerRef, "reviewer")
    && isIsoDateTime(value.sourceOpenedAt)
    && isIsoDateTime(value.reviewedAt)
    && Date.parse(value.reviewedAt) >= Date.parse(value.sourceOpenedAt)
    && typeof value.blindToParserProviderOutput === "boolean"
    && typeof value.blindToOtherReviewer === "boolean"
    && isLabelRecord(value.labels);
}

function validateAdjudication(value: unknown): value is GoldAdjudication {
  if (!isRecord(value)
    || !hasExactKeys(value, [
      "adjudicatorRef",
      "adjudicatedAt",
      "sourceChecked",
      "fieldCoverageChecked",
      "outcome",
      "resolvedFields",
    ])) return false;
  return isOpaqueRef(value.adjudicatorRef, "reviewer")
    && isIsoDateTime(value.adjudicatedAt)
    && typeof value.sourceChecked === "boolean"
    && typeof value.fieldCoverageChecked === "boolean"
    && (value.outcome === "confirmed_agreement" || value.outcome === "resolved_disagreements")
    && isLabelRecord(value.resolvedFields);
}

function validateCaseShape(value: unknown): value is GoldReviewCase {
  if (!isRecord(value)
    || !hasExactKeys(value, [
      "caseId",
      "sourceKind",
      "sourceEvidenceRef",
      "reviewers",
    ], ["adjudication"])) return false;
  if (!isOpaqueRef(value.caseId, "case")
    || (value.sourceKind !== "spec_workbook" && value.sourceKind !== "apply_record_with_source_check")
    || !isOpaqueRef(value.sourceEvidenceRef, "source")
    || !Array.isArray(value.reviewers)
    || value.reviewers.length > 2) return false;
  return value.reviewers.every(validateReviewer)
    && (value.adjudication === undefined || validateAdjudication(value.adjudication));
}

function validateBundleShape(value: unknown): value is GoldReviewBundle {
  if (!isRecord(value)
    || !hasExactKeys(value, [
      "format",
      "version",
      "screening",
      "evaluation",
      "authorization",
      "storage",
      "privacyReview",
      "cases",
    ])) return false;
  if (value.format !== SPEC_IMPORT_GOLD_REVIEW_FORMAT || value.version !== SPEC_IMPORT_GOLD_REVIEW_VERSION
    || !isRecord(value.screening)
    || !hasExactKeys(value.screening, ["screenedCaseCount"])
    || !Number.isSafeInteger(value.screening.screenedCaseCount)
    || (value.screening.screenedCaseCount as number) < 0
    || !isRecord(value.evaluation)
    || !hasExactKeys(value.evaluation, ["parseVersion", "systemPromptSha256"])
    || typeof value.evaluation.parseVersion !== "string"
    || !/^\d{1,8}$/u.test(value.evaluation.parseVersion)
    || !isSha256(value.evaluation.systemPromptSha256)
    || !isRecord(value.authorization)
    || !hasExactKeys(value.authorization, [
      "decision",
      "evaluationUse",
      "ownerAuthorizationRef",
      "authorizedAt",
      "termsAndRetentionConfirmed",
      "permittedSourceEvidenceRefs",
    ])
    || (value.authorization.decision !== "authorized" && value.authorization.decision !== "not_authorized")
    || value.authorization.evaluationUse !== "spec-import-accuracy"
    || !isOpaqueRef(value.authorization.ownerAuthorizationRef, "auth")
    || !isIsoDateTime(value.authorization.authorizedAt)
    || typeof value.authorization.termsAndRetentionConfirmed !== "boolean"
    || !Array.isArray(value.authorization.permittedSourceEvidenceRefs)
    || value.authorization.permittedSourceEvidenceRefs.length > MAX_CASES
    || !value.authorization.permittedSourceEvidenceRefs.every((ref) => isOpaqueRef(ref, "source"))
    || new Set(value.authorization.permittedSourceEvidenceRefs).size !== value.authorization.permittedSourceEvidenceRefs.length
    || !isRecord(value.storage)
    || !hasExactKeys(value.storage, [
      "outsideRepository",
      "accessControlConfirmed",
      "accessControlReviewRef",
      "reviewedAt",
    ])
    || typeof value.storage.outsideRepository !== "boolean"
    || typeof value.storage.accessControlConfirmed !== "boolean"
    || !isOpaqueRef(value.storage.accessControlReviewRef, "access")
    || !isIsoDateTime(value.storage.reviewedAt)
    || !isRecord(value.privacyReview)
    || !hasExactKeys(value.privacyReview, [
      "decision",
      "privacyReviewerRef",
      "privacyReviewRef",
      "reviewedAt",
      "sourceContentExcludedFromReport",
      "identityMappingExcludedFromReport",
    ])
    || (value.privacyReview.decision !== "approved" && value.privacyReview.decision !== "not_approved")
    || !isOpaqueRef(value.privacyReview.privacyReviewerRef, "reviewer")
    || !isOpaqueRef(value.privacyReview.privacyReviewRef, "privacy")
    || !isIsoDateTime(value.privacyReview.reviewedAt)
    || typeof value.privacyReview.sourceContentExcludedFromReport !== "boolean"
    || typeof value.privacyReview.identityMappingExcludedFromReport !== "boolean"
    || !Array.isArray(value.cases)
    || value.cases.length > MAX_CASES
    || (value.screening.screenedCaseCount as number) < value.cases.length
    || !value.cases.every(validateCaseShape)) return false;
  const cases = value.cases as GoldReviewCase[];
  return new Set(cases.map(({ caseId }) => caseId)).size === cases.length;
}

function caseProgress(
  item: GoldReviewCase,
  permittedSourceRefs: ReadonlySet<string>,
): { doubleLabeled: boolean; adjudicated: boolean; eligible: boolean; applicable: number; finalized: number; unknown: number; issue?: string } {
  if (!permittedSourceRefs.has(item.sourceEvidenceRef)) {
    return { doubleLabeled: false, adjudicated: false, eligible: false, applicable: 0, finalized: 0, unknown: 0, issue: "case_source_outside_authorized_scope" };
  }

  if (item.reviewers.length !== 2) {
    return { doubleLabeled: false, adjudicated: false, eligible: false, applicable: 0, finalized: 0, unknown: 0, issue: "case_review_incomplete" };
  }

  const [left, right] = item.reviewers as [GoldReviewerRecord, GoldReviewerRecord];
  const completeCoverage = SPEC_IMPORT_GOLD_CRITICAL_FIELDS.every((field) =>
    Object.hasOwn(left.labels, field) && Object.hasOwn(right.labels, field));
  const independent = left.reviewerRef !== right.reviewerRef;
  const blind = left.blindToParserProviderOutput
    && right.blindToParserProviderOutput
    && left.blindToOtherReviewer
    && right.blindToOtherReviewer;
  const doubleLabeled = completeCoverage && independent && blind;
  if (!doubleLabeled) {
    const issue = !independent
      ? "reviewers_not_independent"
      : !blind
        ? "blind_review_attestation_missing"
        : "case_label_coverage_incomplete";
    return { doubleLabeled: false, adjudicated: false, eligible: false, applicable: 0, finalized: 0, unknown: 0, issue };
  }

  const differingFields = SPEC_IMPORT_GOLD_CRITICAL_FIELDS.filter((field) =>
    !labelsEqual(left.labels[field]!, right.labels[field]!));
  const adjudication = item.adjudication;
  if (!adjudication) {
    return {
      doubleLabeled: true,
      adjudicated: false,
      eligible: false,
      applicable: 0,
      finalized: 0,
      unknown: 0,
      issue: differingFields.length ? "case_disagreements_pending_adjudication" : "case_adjudication_pending",
    };
  }

  const adjudicatorIndependent = adjudication.adjudicatorRef !== left.reviewerRef
    && adjudication.adjudicatorRef !== right.reviewerRef;
  const timeOrderValid = Date.parse(adjudication.adjudicatedAt) >= Math.max(
    Date.parse(left.reviewedAt),
    Date.parse(right.reviewedAt),
  );
  const resolutionFields = Object.keys(adjudication.resolvedFields).sort();
  const expectedResolutionFields = [...differingFields].sort();
  const correctOutcome = differingFields.length
    ? adjudication.outcome === "resolved_disagreements"
    : adjudication.outcome === "confirmed_agreement";
  const resolutionCoverage = resolutionFields.length === expectedResolutionFields.length
    && resolutionFields.every((field, index) => field === expectedResolutionFields[index]);
  if (!adjudicatorIndependent || !timeOrderValid || !adjudication.sourceChecked
    || !adjudication.fieldCoverageChecked || !correctOutcome || !resolutionCoverage) {
    return {
      doubleLabeled: true,
      adjudicated: false,
      eligible: false,
      applicable: 0,
      finalized: 0,
      unknown: 0,
      issue: !adjudicatorIndependent
        ? "adjudicator_not_independent"
        : !timeOrderValid
          ? "adjudication_time_invalid"
          : !adjudication.sourceChecked
            ? "adjudication_source_check_missing"
            : !adjudication.fieldCoverageChecked
              ? "adjudication_field_coverage_check_missing"
              : !correctOutcome
                ? "adjudication_outcome_mismatch"
                : "adjudication_resolution_coverage_mismatch",
    };
  }

  let unknown = 0;
  let applicable = 0;
  for (const field of SPEC_IMPORT_GOLD_CRITICAL_FIELDS) {
    const finalLabel = Object.hasOwn(adjudication.resolvedFields, field)
      ? adjudication.resolvedFields[field]!
      : left.labels[field]!;
    if (finalLabel.state === "not_applicable") continue;
    applicable += 1;
    if (finalLabel.state === "unclear" || finalLabel.state === "not_inferable") unknown += 1;
  }
  if (applicable === 0) {
    return {
      doubleLabeled: true,
      adjudicated: true,
      eligible: false,
      applicable: 0,
      finalized: 0,
      unknown: 0,
      issue: "case_no_applicable_critical_fields",
    };
  }
  return {
    doubleLabeled: true,
    adjudicated: true,
    eligible: true,
    applicable,
    finalized: applicable,
    unknown,
  };
}

export function validateSpecImportGoldReviewBundle(input: unknown): SpecImportGoldReviewValidation {
  const structureIssues = new Set<string>();
  if (!validateBundleShape(input)) {
    addIssue(structureIssues, "review_bundle_schema_invalid");
    return {
      valid: false,
      issueCodes: [...structureIssues],
      report: blockedReport([...structureIssues]),
    };
  }

  const authorizationApproved = input.authorization.decision === "authorized"
    && input.authorization.termsAndRetentionConfirmed;
  const accessApproved = input.storage.outsideRepository && input.storage.accessControlConfirmed;
  const privacyApproved = input.privacyReview.decision === "approved"
    && input.privacyReview.sourceContentExcludedFromReport
    && input.privacyReview.identityMappingExcludedFromReport;

  const gateIssues = new Set<string>();
  if (!authorizationApproved) addIssue(gateIssues, "source_owner_authorization_missing");
  if (!accessApproved) addIssue(gateIssues, "access_control_attestation_missing");
  if (!privacyApproved) addIssue(gateIssues, "privacy_review_not_approved");
  if (gateIssues.size) {
    return {
      valid: false,
      issueCodes: [...gateIssues].sort(),
      report: blockedReport(
        [...gateIssues].sort(),
        authorizationApproved ? "recorded_not_independently_verified" : "not_verified",
        accessApproved ? "attested_not_independently_verified" : "not_verified",
        privacyApproved ? "approved" : "not_approved",
      ),
    };
  }

  const permittedSourceRefs = new Set(input.authorization.permittedSourceEvidenceRefs);
  if (input.cases.some((item) => !permittedSourceRefs.has(item.sourceEvidenceRef))) {
    const issues = ["case_source_outside_authorized_scope"];
    return {
      valid: false,
      issueCodes: issues,
      report: blockedReport(
        issues,
        "recorded_not_independently_verified",
        "attested_not_independently_verified",
        "approved",
      ),
    };
  }
  if (input.cases.some((item) => item.reviewers.some((reviewer) =>
    Date.parse(reviewer.sourceOpenedAt) < Date.parse(input.authorization.authorizedAt)))) {
    const issues = ["source_opened_before_authorization"];
    return {
      valid: false,
      issueCodes: issues,
      report: blockedReport(
        issues,
        "recorded_not_independently_verified",
        "attested_not_independently_verified",
        "approved",
      ),
    };
  }
  if (input.cases.some((item) => item.reviewers.some((reviewer) =>
    Date.parse(reviewer.sourceOpenedAt) < Date.parse(input.storage.reviewedAt)))) {
    const issues = ["storage_review_after_source_open"];
    return {
      valid: false,
      issueCodes: issues,
      report: blockedReport(
        issues,
        "recorded_not_independently_verified",
        "attested_not_independently_verified",
        "approved",
      ),
    };
  }
  const latestReviewAt = input.cases.reduce((latest, item) => Math.max(
    latest,
    ...item.reviewers.map((reviewer) => Date.parse(reviewer.reviewedAt)),
    ...(item.adjudication ? [Date.parse(item.adjudication.adjudicatedAt)] : []),
  ), 0);
  if (Date.parse(input.privacyReview.reviewedAt) < latestReviewAt) {
    const issues = ["privacy_review_predates_review_records"];
    return {
      valid: false,
      issueCodes: issues,
      report: blockedReport(
        issues,
        "recorded_not_independently_verified",
        "attested_not_independently_verified",
        "approved",
      ),
    };
  }
  const privacyReviewerRef = input.privacyReview.privacyReviewerRef;
  if (input.cases.some((item) =>
    item.reviewers.some((reviewer) => reviewer.reviewerRef === privacyReviewerRef)
    || item.adjudication?.adjudicatorRef === privacyReviewerRef)) {
    const issues = ["privacy_reviewer_not_independent"];
    return {
      valid: false,
      issueCodes: issues,
      report: blockedReport(
        issues,
        "recorded_not_independently_verified",
        "attested_not_independently_verified",
        "approved",
      ),
    };
  }
  const progress = input.cases.map((item) => caseProgress(item, permittedSourceRefs));
  const issues = new Set<string>();
  for (const row of progress) if (row.issue) addIssue(issues, row.issue);

  const eligible = progress.filter((row) => row.eligible).length;
  const authorized = input.cases.filter((item) => permittedSourceRefs.has(item.sourceEvidenceRef)).length;
  const doubleLabeled = progress.filter((row) => row.doubleLabeled).length;
  const adjudicated = progress.filter((row) => row.adjudicated).length;
  const status = authorized === 0 && input.screening.screenedCaseCount === 0
    ? "in_progress"
    : adjudicated !== authorized
      ? "in_progress"
    : eligible > 0
      ? "ready"
      : "reviewed_no_eligible_cases";
  const report: SpecImportGoldReviewReport = {
    format: "spec-import-gold-review-aggregate",
    version: 1,
    status,
    provenance: {
      parseVersion: input.evaluation.parseVersion,
      systemPromptSha256: input.evaluation.systemPromptSha256,
      scope: "provided_private_bundle_only",
    },
    caseCounts: {
      screened: input.screening.screenedCaseCount,
      authorized,
      independentlyDoubleLabeled: doubleLabeled,
      adjudicated,
      eligible,
      notEligibleOrIncomplete: authorized - eligible,
    },
    fieldCounts: {
      applicable: progress.reduce((sum, row) => sum + row.applicable, 0),
      finalized: progress.reduce((sum, row) => sum + row.finalized, 0),
      unknown: progress.reduce((sum, row) => sum + row.unknown, 0),
    },
    authorization: "recorded_not_independently_verified",
    accessControl: "attested_not_independently_verified",
    privacyReview: "approved",
    unreviewedPrivateStoreCaseCount: null,
    unreviewedPrivateStoreCaseCountStatus: "unknown_not_accessed",
    issueCodes: [...issues].sort(),
  };
  return { valid: true, issueCodes: report.issueCodes, report };
}

export { MAX_REVIEW_BUNDLE_BYTES };
