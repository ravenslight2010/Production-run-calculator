export const QC_LABEL_FIELDS = ["productName", "lotText", "dateText"] as const;

export type QcLabelField = typeof QC_LABEL_FIELDS[number];
export type QcLabelFieldState = "pass" | "fail" | "not-evaluated";
export type QcLabelExpectedFields = Partial<Record<QcLabelField, string>>;

export type QcLabelFieldResult = {
  observed: string;
  expected: string | null;
  state: QcLabelFieldState;
  reason: string | null;
};

export type QcLabelComparison = {
  fields: Record<QcLabelField, QcLabelFieldResult>;
  outcome: QcLabelFieldState;
};

export type QcLabelReferenceForComparison = {
  expected: QcLabelExpectedFields;
  requiredFields: QcLabelField[];
};

const FIELD_LABELS: Record<QcLabelField, string> = {
  productName: "product name",
  lotText: "lot text",
  dateText: "date text",
};

function comparableText(value: string): string {
  // Label/date content is text only: preserve case and punctuation, and do not
  // parse dates or infer production/shelf-life rules.
  return value.normalize("NFC").trim();
}

export function evaluateQcLabelCheck(input: {
  observed: Record<QcLabelField, string>;
  reference: QcLabelReferenceForComparison | null;
  referenceUnavailableReason?: string;
}): QcLabelComparison {
  const fields = Object.fromEntries(QC_LABEL_FIELDS.map((field) => {
    const observed = input.observed[field];
    const expectedValue = input.reference?.expected[field];
    const expected = typeof expectedValue === "string" && expectedValue.trim()
      ? expectedValue
      : null;
    if (!input.reference) {
      return [field, {
        observed,
        expected: null,
        state: "not-evaluated" as const,
        reason: input.referenceUnavailableReason ?? "No approved applicable reference is available.",
      }];
    }
    if (expected === null) {
      return [field, {
        observed,
        expected: null,
        state: "not-evaluated" as const,
        reason: `The approved reference has no ${FIELD_LABELS[field]} value.`,
      }];
    }
    if (!comparableText(observed)) {
      return [field, {
        observed,
        expected,
        state: "not-evaluated" as const,
        reason: `No observed ${FIELD_LABELS[field]} text was entered.`,
      }];
    }
    const matches = comparableText(observed) === comparableText(expected);
    return [field, {
      observed,
      expected,
      state: matches ? "pass" as const : "fail" as const,
      reason: matches ? null : `Observed ${FIELD_LABELS[field]} does not match the approved reference.`,
    }];
  })) as Record<QcLabelField, QcLabelFieldResult>;

  const states = QC_LABEL_FIELDS.map((field) => fields[field].state);
  const outcome: QcLabelFieldState = states.includes("fail")
    ? "fail"
    : input.reference
      && input.reference.requiredFields.length > 0
      && input.reference.requiredFields.every((field) => fields[field].state === "pass")
      ? "pass"
      : "not-evaluated";
  return { fields, outcome };
}

export function normalizeQcLabelObserved(value: Record<QcLabelField, string>): Record<QcLabelField, string> {
  return Object.fromEntries(QC_LABEL_FIELDS.map((field) => [
    field,
    value[field].normalize("NFC").trim(),
  ])) as Record<QcLabelField, string>;
}
