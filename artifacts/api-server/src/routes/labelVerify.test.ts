import { describe, it, expect } from "vitest";
import {
  validateLabelVerifyBody,
  buildLabelVerifyPrompt,
  expectedToMap,
  sanitizeLabelVerification,
  MAX_IMAGE_BASE64_CHARS,
  LABEL_FIELDS,
} from "./labelVerify";

const validImage = "a".repeat(64);

describe("validateLabelVerifyBody", () => {
  it("accepts a valid body", () => {
    const r = validateLabelVerifyBody({
      imageBase64: validImage,
      expected: { brand: "DiGiorno", caseCount: 48 },
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a missing image with 400", () => {
    expect(validateLabelVerifyBody({})).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects an oversized image with 413", () => {
    const r = validateLabelVerifyBody({ imageBase64: "a".repeat(MAX_IMAGE_BASE64_CHARS + 1) });
    expect(r).toMatchObject({ ok: false, status: 413 });
  });
});

describe("expectedToMap", () => {
  it("stringifies caseCount and drops blanks", () => {
    const m = expectedToMap({ brand: "X", flavor: "  ", caseCount: 48 });
    expect(m.brand).toBe("X");
    expect(m.caseCount).toBe("48");
    expect(m.flavor).toBeUndefined();
  });

  it("returns empty for undefined", () => {
    expect(expectedToMap(undefined)).toEqual({});
  });
});

describe("buildLabelVerifyPrompt", () => {
  it("lists expected values and advisory framing", () => {
    const { system, userText } = buildLabelVerifyPrompt({
      imageBase64: validImage,
      expected: { brand: "DiGiorno", lotCode: "L123" },
    });
    expect(system.toLowerCase()).toContain("advisory");
    expect(userText).toContain("DiGiorno");
    expect(userText).toContain("L123");
    expect(userText).toContain('"verdict"');
  });

  it("handles no expected values", () => {
    const { userText } = buildLabelVerifyPrompt({ imageBase64: validImage });
    expect(userText.toLowerCase()).toContain("no expected values");
  });
});

describe("sanitizeLabelVerification", () => {
  it("returns one row per known field in fixed order", () => {
    const { result } = sanitizeLabelVerification({ fields: [] }, {});
    expect(result.fields.map((f) => f.field)).toEqual([...LABEL_FIELDS]);
  });

  it("recomputes verdict=fail when a compared field mismatches", () => {
    const expected = { brand: "DiGiorno", flavor: "Pepperoni" };
    const { result } = sanitizeLabelVerification(
      {
        verdict: "pass", // model lies; must be overridden
        summary: "Looks fine",
        confidence: 0.9,
        fields: [
          { field: "brand", observed: "DiGiorno", match: "match" },
          { field: "flavor", observed: "Cheese", match: "mismatch" },
        ],
      },
      expected,
    );
    expect(result.verdict).toBe("fail");
  });

  it("recomputes verdict=pass when all compared fields match", () => {
    const expected = { brand: "DiGiorno", caseCount: "48" };
    const { result } = sanitizeLabelVerification(
      {
        verdict: "warn",
        fields: [
          { field: "brand", observed: "DiGiorno", match: "match" },
          { field: "caseCount", observed: "48", match: "match" },
        ],
      },
      expected,
    );
    expect(result.verdict).toBe("pass");
  });

  it("recomputes verdict=warn when a compared field is unreadable", () => {
    const expected = { brand: "DiGiorno", date: "2026-06-26" };
    const { result } = sanitizeLabelVerification(
      {
        verdict: "pass",
        fields: [
          { field: "brand", observed: "DiGiorno", match: "match" },
          { field: "date", observed: null, match: "unreadable" },
        ],
      },
      expected,
    );
    expect(result.verdict).toBe("warn");
  });

  it("marks fields without an expected value as unreadable (not checked)", () => {
    const { result } = sanitizeLabelVerification(
      { fields: [{ field: "brand", observed: "DiGiorno", match: "match" }] },
      {},
    );
    const brand = result.fields.find((f) => f.field === "brand");
    expect(brand?.match).toBe("unreadable");
    expect(brand?.observed).toBe("DiGiorno");
  });

  it("always reflects server-supplied expected values, never model-supplied", () => {
    const { result } = sanitizeLabelVerification(
      { fields: [{ field: "brand", observed: "X", match: "match" }] },
      { brand: "DiGiorno" },
    );
    const brand = result.fields.find((f) => f.field === "brand");
    expect(brand?.expected).toBe("DiGiorno");
  });

  it("clamps confidence to 0..1", () => {
    const { result } = sanitizeLabelVerification({ confidence: 5, fields: [] }, {});
    expect(result.confidence).toBe(1);
  });

  it("falls back gracefully on garbage", () => {
    const { result } = sanitizeLabelVerification(null, { brand: "X" });
    expect(result.verdict).toBe("warn");
    expect(result.fields).toHaveLength(LABEL_FIELDS.length);
    expect(result.fields.find((f) => f.field === "brand")?.expected).toBe("X");
  });

  it("surfaces a model note when present", () => {
    const { note } = sanitizeLabelVerification({ fields: [], note: "Glare on label" }, {});
    expect(note).toBe("Glare on label");
  });
});
