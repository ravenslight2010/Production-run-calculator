import { describe, expect, it } from "vitest";
import { goldApprovalInput, goldSourceDigest, completeStoredGoldApproval } from "./importGoldApproval";

const metadata = {
  recordRef: "synthetic-approval", sourceDigest: "a".repeat(64), importType: "spec",
  purpose: "local_spec_import_accuracy", ownerRef: "synthetic-owner",
  ownerApprovedAt: "2020-01-01T00:00:00Z", privacyStatus: "approved",
  privacyReviewerRef: "synthetic-reviewer", privacyReviewedAt: "2020-01-01T00:00:00Z",
  conditionsRef: "synthetic-none", externalCopiesRef: "synthetic-copies",
  backupHandlingRef: "synthetic-backups", manualDeletionAccepted: true,
  retentionDays: 30, conditionsSatisfied: true, validUntil: "2099-01-01T00:00:00Z",
};

describe("Gold source approval metadata", () => {
  it("requires explicit privacy, manual deletion, external copy and backup records without accepting evidence payloads", () => {
    expect(goldApprovalInput.safeParse(metadata).success).toBe(true);
    for (const patch of [
      { privacyStatus: "pending" }, { retentionDays: 31 }, { manualDeletionAccepted: false },
      { conditionsSatisfied: false }, { backupHandlingRef: "" }, { externalCopiesRef: "" },
      { recordRef: "https://private.example/document" }, { ownerRef: "owner@example.com" },
      { ownerApprovedAt: "2099-01-01T00:00:00Z" }, { validUntil: "2020-01-01T00:00:00Z" },
      { workbook: "must not be saved" }, { verifiedBy: "caller-controlled" },
    ]) expect(goldApprovalInput.safeParse({ ...metadata, ...patch }).success).toBe(false);
    expect(completeStoredGoldApproval({
      ...metadata, ownerApprovedAt: new Date(metadata.ownerApprovedAt),
      privacyReviewedAt: new Date(metadata.privacyReviewedAt), validUntil: new Date(metadata.validUntil),
      id: 1, verifiedBy: "synthetic-reviewer",
    })).toBe(true);
  });

  it("sorts object keys but never collapses source array order or distinct values", () => {
    expect(goldSourceDigest({ z: [1, 2], a: { b: 3, a: 4 } }))
      .toBe(goldSourceDigest({ a: { a: 4, b: 3 }, z: [1, 2] }));
    expect(goldSourceDigest({ a: [1, 2] })).not.toBe(goldSourceDigest({ a: [2, 1] }));
    expect(goldSourceDigest({ a: 1 })).not.toBe(goldSourceDigest({ a: "1" }));
  });
});
