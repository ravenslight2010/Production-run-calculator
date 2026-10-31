import { createHash } from "node:crypto";
import { z } from "zod";

// Opaque references only: no names, email addresses, URLs, document text or file paths.
const reference = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/);
const instant = z.string().datetime({ offset: true });
const metadataShape = z.object({
  recordRef: reference,
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  importType: z.enum(["spec", "premix", "cheese"]),
  purpose: z.literal("local_spec_import_accuracy"),
  ownerRef: reference,
  ownerApprovedAt: instant,
  privacyStatus: z.enum(["approved", "not_required"]),
  privacyReviewerRef: reference,
  privacyReviewedAt: instant,
  conditionsRef: reference,
  externalCopiesRef: reference,
  backupHandlingRef: reference,
  manualDeletionAccepted: z.literal(true),
  retentionDays: z.literal(30),
  conditionsSatisfied: z.literal(true),
  validUntil: instant,
}).strict();
export const goldApprovalInput = metadataShape.superRefine((value, context) => {
  const now = Date.now();
  if (Date.parse(value.ownerApprovedAt) > now || Date.parse(value.privacyReviewedAt) > now ||
      Date.parse(value.validUntil) <= now) {
    context.addIssue({ code: "custom", message: "Approval dates must be completed and validity must be in the future" });
  }
});

export function completeStoredGoldApproval(row: Record<string, unknown>): boolean {
  const input = Object.fromEntries(Object.keys(metadataShape.shape).map((key) => [
    key, row[key] instanceof Date ? (row[key] as Date).toISOString() : row[key],
  ]));
  return goldApprovalInput.safeParse(input).success;
}

/** Exact JSON input identity: object keys sorted, array order preserved. Not a workbook-file hash. */
export function goldSourceDigest(input: unknown): string {
  function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
    }
    const result = JSON.stringify(value);
    if (typeof result !== "string") throw new Error("Evaluation input must be JSON");
    return result;
  }
  return createHash("sha256").update(canonical(input)).digest("hex");
}
