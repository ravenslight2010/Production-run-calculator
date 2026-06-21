import { describe, it, expect } from "vitest";
import type { QualityCheckRow } from "@workspace/db";
import {
  validateRecordQualityCheckBody,
  parseHistoryFilter,
  rowToRecord,
  MAX_THUMBNAIL_CHARS,
} from "./qualityChecks";
import { MAX_ISSUES, MAX_SUMMARY_CHARS } from "./qualityPhoto";

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    productType: "pizza",
    status: "pass",
    confidence: 0.9,
    summary: "Looks well baked and evenly topped.",
    issues: [],
    ...overrides,
  };
}

describe("validateRecordQualityCheckBody", () => {
  it("accepts a well-formed body", () => {
    const result = validateRecordQualityCheckBody(validBody());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.productType).toBe("pizza");
      expect(result.data.status).toBe("pass");
      expect(result.data.confidence).toBe(0.9);
      expect(result.data.notes).toBeNull();
      expect(result.data.thumbnail).toBeNull();
    }
  });

  it("rejects a body missing required fields with 400", () => {
    const result = validateRecordQualityCheckBody({ productType: "pizza" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("clamps confidence into 0..1", () => {
    const hi = validateRecordQualityCheckBody(validBody({ confidence: 5 }));
    const lo = validateRecordQualityCheckBody(validBody({ confidence: -3 }));
    expect(hi.ok && hi.data.confidence).toBe(1);
    expect(lo.ok && lo.data.confidence).toBe(0);
  });

  it("rejects an out-of-enum product type or status with 400", () => {
    const badProduct = validateRecordQualityCheckBody(validBody({ productType: "bogus" }));
    const badStatus = validateRecordQualityCheckBody(validBody({ status: "bogus" }));
    expect(badProduct.ok).toBe(false);
    if (!badProduct.ok) expect(badProduct.status).toBe(400);
    expect(badStatus.ok).toBe(false);
    if (!badStatus.ok) expect(badStatus.status).toBe(400);
  });

  it("caps the number of issues at MAX_ISSUES and drops empty-detail issues", () => {
    const issues = Array.from({ length: MAX_ISSUES + 5 }, (_, i) => ({
      type: "burn",
      severity: "minor",
      detail: `spot ${i}`,
    }));
    issues.push({ type: "x", severity: "minor", detail: "   " });
    const result = validateRecordQualityCheckBody(validBody({ issues }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.issues.length).toBe(MAX_ISSUES);
      expect(result.data.issues.every((i) => i.detail.trim().length > 0)).toBe(true);
    }
  });

  it("rejects an out-of-enum issue severity with 400", () => {
    const result = validateRecordQualityCheckBody(
      validBody({ issues: [{ type: "burn", severity: "weird", detail: "edge char" }] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("truncates an over-long summary", () => {
    const result = validateRecordQualityCheckBody(
      validBody({ summary: "x".repeat(MAX_SUMMARY_CHARS + 500) }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.summary.length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS);
  });

  it("keeps a valid image data-URI thumbnail", () => {
    const thumb = "data:image/jpeg;base64,AAAA";
    const result = validateRecordQualityCheckBody(validBody({ thumbnail: thumb }));
    expect(result.ok && result.data.thumbnail).toBe(thumb);
  });

  it("drops a non-image thumbnail", () => {
    const result = validateRecordQualityCheckBody(
      validBody({ thumbnail: "javascript:alert(1)" }),
    );
    expect(result.ok && result.data.thumbnail).toBeNull();
  });

  it("drops an oversized thumbnail rather than storing it", () => {
    const huge = "data:image/jpeg;base64," + "A".repeat(MAX_THUMBNAIL_CHARS + 10);
    const result = validateRecordQualityCheckBody(validBody({ thumbnail: huge }));
    expect(result.ok && result.data.thumbnail).toBeNull();
  });

  it("trims notes and stores null when blank", () => {
    const withNotes = validateRecordQualityCheckBody(validBody({ notes: "  rim too thick " }));
    const blank = validateRecordQualityCheckBody(validBody({ notes: "    " }));
    expect(withNotes.ok && withNotes.data.notes).toBe("rim too thick");
    expect(blank.ok && blank.data.notes).toBeNull();
  });
});

describe("parseHistoryFilter", () => {
  it("returns allowed product and status filters", () => {
    expect(parseHistoryFilter({ productType: "crust", status: "fail" })).toEqual({
      productType: "crust",
      status: "fail",
    });
  });

  it("ignores unknown values rather than erroring", () => {
    expect(parseHistoryFilter({ productType: "bogus", status: "nope" })).toEqual({});
  });

  it("ignores non-string params", () => {
    expect(parseHistoryFilter({ productType: 5, status: ["fail"] })).toEqual({});
  });
});

describe("rowToRecord", () => {
  const baseRow: QualityCheckRow = {
    id: 7,
    productType: "crust",
    status: "warn",
    confidence: 0.42,
    summary: "Slight under-bake on one edge.",
    issues: [{ type: "underbake", severity: "minor", detail: "left edge pale" }],
    notes: "second batch",
    thumbnail: "data:image/jpeg;base64,AAAA",
    reviewerId: "u_3",
    reviewerName: "Sam",
    createdAt: new Date("2026-06-21T10:00:00.000Z"),
  };

  it("shapes a row into the wire record with ISO createdAt", () => {
    const out = rowToRecord(baseRow);
    expect(out.id).toBe(7);
    expect(out.productType).toBe("crust");
    expect(out.status).toBe("warn");
    expect(out.reviewerName).toBe("Sam");
    expect(out.createdAt).toBe("2026-06-21T10:00:00.000Z");
    expect(out.issues).toHaveLength(1);
  });

  it("survives a malformed issues blob without throwing", () => {
    const out = rowToRecord({
      ...baseRow,
      issues: [null, "bad", { type: "x" }, { detail: "real" }] as unknown as QualityCheckRow["issues"],
    });
    expect(out.issues).toHaveLength(1);
    expect(out.issues[0].detail).toBe("real");
    expect(out.issues[0].type).toBe("issue");
  });

  it("maps nullish optional columns to null", () => {
    const out = rowToRecord({ ...baseRow, notes: null, thumbnail: null, reviewerName: null });
    expect(out.notes).toBeNull();
    expect(out.thumbnail).toBeNull();
    expect(out.reviewerName).toBeNull();
  });
});
