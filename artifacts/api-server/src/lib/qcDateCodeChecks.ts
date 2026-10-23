import * as z from "zod";

export const QC_DATE_CODE_FIELDS = ["productionCode", "bestByCode", "otherCode"] as const;
export const dateCodeObservedSchema = z.object({
  productionCode: z.string().max(200),
  bestByCode: z.string().max(200),
  otherCode: z.string().max(200),
}).strict();
export const dateCodeReadabilitySchema = z.object({
  productionCode: z.enum(["readable", "missing", "unreadable", "ambiguous"]),
  bestByCode: z.enum(["readable", "missing", "unreadable", "ambiguous"]),
  otherCode: z.enum(["readable", "missing", "unreadable", "ambiguous"]),
}).strict();
export type DateCodeField = typeof QC_DATE_CODE_FIELDS[number];
type Outcome = "pass" | "fail" | "not-evaluated";
export type DateCodeReference = {
  expected: Partial<Record<DateCodeField, string>>;
  requiredFields: DateCodeField[];
};

// Literal Unicode text comparison only. No calendar parsing, format validation,
// shelf-life arithmetic, or interpretation of ingredient expiration dates.
export function evaluateDateCodeCheck(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const observed = dateCodeObservedSchema.parse(payload.observed);
  const readability = dateCodeReadabilitySchema.parse(payload.readability);
  const snapshot = payload.referenceSnapshot as (DateCodeReference & {
    state?: string; approvalEventId?: number;
  }) | null;
  const reference = snapshot?.state === "approved" && snapshot.approvalEventId
    ? snapshot : null;
  const fieldResults = Object.fromEntries(QC_DATE_CODE_FIELDS.map((field) => {
    const expected = reference?.expected[field] || null;
    let state: Outcome = "not-evaluated";
    let reason: string | null = String(payload.referenceUnavailableReason ?? "No approved applicable reference.");
    if (reference && expected) {
      if (readability[field] !== "readable" || !observed[field].trim()) {
        reason = "Code is missing, unreadable or ambiguous.";
      } else {
        state = observed[field].normalize("NFC").trim() === expected.normalize("NFC").trim() ? "pass" : "fail";
        reason = state === "fail" ? "Observed code differs from approved exact text." : null;
      }
    } else if (reference) reason = "No approved expected text for this field.";
    return [field, { observed: observed[field], expected, state, reason }];
  })) as Record<DateCodeField, { observed: string; expected: string | null; state: Outcome; reason: string | null }>;
  const outcome: Outcome = Object.values(fieldResults).some((field) => field.state === "fail")
    ? "fail"
    : reference && reference.requiredFields.length > 0
      && reference.requiredFields.every((field) => fieldResults[field].state === "pass")
      ? "pass" : "not-evaluated";
  return { ...payload, fieldResults, outcome };
}
