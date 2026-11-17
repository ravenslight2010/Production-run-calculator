import { describe, it, expect } from "vitest";
import {
  validateQualityPhotoBody,
  buildQualityPrompt,
  sanitizeAssessment,
  MAX_IMAGE_BASE64_CHARS,
  MAX_ISSUES,
  MAX_SUMMARY_CHARS,
} from "./qualityPhoto";

describe("validateQualityPhotoBody", () => {
  const validImage = "a".repeat(32);

  it("rejects a missing imageBase64 with 400", () => {
    const result = validateQualityPhotoBody({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("rejects a too-short imageBase64 with 400", () => {
    const result = validateQualityPhotoBody({ imageBase64: "short" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toBe("imageBase64 required");
    }
  });

  it("rejects an oversized imageBase64 with 413", () => {
    const result = validateQualityPhotoBody({
      imageBase64: "a".repeat(MAX_IMAGE_BASE64_CHARS + 1),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(413);
  });

  it("rejects an invalid productType with 400", () => {
    const result = validateQualityPhotoBody({
      imageBase64: validImage,
      productType: "spaceship",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("accepts a valid body with productType and notes", () => {
    const result = validateQualityPhotoBody({
      imageBase64: validImage,
      productType: "crust",
      notes: "expected 16 inch",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.imageBase64).toBe(validImage);
      expect(result.data.productType).toBe("crust");
    }
  });

  it("accepts a minimal valid body (image only)", () => {
    const result = validateQualityPhotoBody({ imageBase64: validImage });
    expect(result.ok).toBe(true);
  });
});

describe("buildQualityPrompt", () => {
  const validImage = "a".repeat(32);

  it("mentions crust wording when productType is crust", () => {
    const { system } = buildQualityPrompt({ imageBase64: validImage, productType: "crust" });
    expect(system.toLowerCase()).toContain("crust");
  });

  it("includes user notes as context in the prompt", () => {
    const { userText } = buildQualityPrompt({
      imageBase64: validImage,
      notes: "topping looks light",
    });
    expect(userText).toContain("topping looks light");
  });

  it("asks for the strict JSON shape and states it is advisory only", () => {
    const { system, userText } = buildQualityPrompt({ imageBase64: validImage });
    expect(userText).toContain('"status"');
    expect(userText).toContain('"issues"');
    expect(system.toLowerCase()).toContain("advisory");
  });
});

describe("sanitizeAssessment", () => {
  it("returns a safe empty assessment for non-object input", () => {
    for (const bad of [null, "x", 42, []]) {
      const { assessment } = sanitizeAssessment(bad);
      expect(assessment.status).toBe("warn");
      expect(assessment.confidence).toBe(0);
      expect(assessment.issues).toEqual([]);
    }
  });

  it("maps status synonyms to the allowed enum", () => {
    expect(sanitizeAssessment({ status: "rejected" }).assessment.status).toBe("fail");
    expect(sanitizeAssessment({ status: "OK" }).assessment.status).toBe("pass");
    expect(sanitizeAssessment({ status: "caution" }).assessment.status).toBe("warn");
    expect(sanitizeAssessment({ status: "nonsense" }).assessment.status).toBe("warn");
  });

  it("clamps confidence into 0..1 and defaults non-numbers to 0", () => {
    expect(sanitizeAssessment({ confidence: 5 }).assessment.confidence).toBe(1);
    expect(sanitizeAssessment({ confidence: -3 }).assessment.confidence).toBe(0);
    expect(sanitizeAssessment({ confidence: 0.4 }).assessment.confidence).toBeCloseTo(0.4);
    expect(sanitizeAssessment({ confidence: "nope" }).assessment.confidence).toBe(0);
  });

  it("keeps valid issues, maps severity, and drops detail-less ones", () => {
    const { assessment } = sanitizeAssessment({
      summary: "Looks slightly off",
      status: "warn",
      confidence: 0.7,
      issues: [
        { type: "size", severity: "high", detail: "Undersized vs 16in target" },
        { type: "burn", severity: "critical", detail: "Charred edge" },
        { type: "blank", severity: "minor", detail: "   " },
        "garbage",
        null,
      ],
    });
    expect(assessment.issues.map((i) => i.detail)).toEqual([
      "Undersized vs 16in target",
      "Charred edge",
    ]);
    expect(assessment.issues[0].severity).toBe("major");
    expect(assessment.issues[1].severity).toBe("critical");
  });

  it("defaults a blank issue type to 'issue'", () => {
    const { assessment } = sanitizeAssessment({
      issues: [{ type: "  ", severity: "minor", detail: "something" }],
    });
    expect(assessment.issues[0].type).toBe("issue");
  });

  it("caps the number of issues", () => {
    const issues = Array.from({ length: MAX_ISSUES + 5 }, (_, i) => ({
      type: "t",
      severity: "minor",
      detail: `issue ${i}`,
    }));
    const { assessment } = sanitizeAssessment({ issues });
    expect(assessment.issues.length).toBe(MAX_ISSUES);
  });

  it("clamps an overlong summary", () => {
    const { assessment } = sanitizeAssessment({ summary: "z".repeat(MAX_SUMMARY_CHARS + 50) });
    expect(assessment.summary.length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS);
  });

  it("surfaces a model note when present", () => {
    const out = sanitizeAssessment({ status: "warn", note: "photo too dark" });
    expect(out.note).toBe("photo too dark");
  });
});
