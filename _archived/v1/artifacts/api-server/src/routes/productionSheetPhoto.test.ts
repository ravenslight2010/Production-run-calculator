import { describe, it, expect } from "vitest";
import {
  validateProductionSheetBody,
  buildProductionSheetPrompt,
  sanitizeSheetRows,
  MAX_IMAGE_BASE64_CHARS,
  MAX_ROWS,
} from "./productionSheetPhoto";

const validImage = "a".repeat(64);

describe("validateProductionSheetBody", () => {
  it("accepts a valid body", () => {
    const r = validateProductionSheetBody({ imageBase64: validImage, mimeType: "image/png" });
    expect(r.ok).toBe(true);
  });

  it("rejects a missing image with 400", () => {
    const r = validateProductionSheetBody({});
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects a too-short image with 400", () => {
    const r = validateProductionSheetBody({ imageBase64: "abc" });
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects an oversized image with 413", () => {
    const r = validateProductionSheetBody({ imageBase64: "a".repeat(MAX_IMAGE_BASE64_CHARS + 1) });
    expect(r).toMatchObject({ ok: false, status: 413 });
  });
});

describe("buildProductionSheetPrompt", () => {
  it("returns advisory system + JSON-shape instruction", () => {
    const { system, userText } = buildProductionSheetPrompt({ imageBase64: validImage });
    expect(system.toLowerCase()).toContain("advisory");
    expect(userText).toContain('"rows"');
    expect(userText).toContain("casesNeeded");
  });

  it("includes user notes when provided", () => {
    const { userText } = buildProductionSheetPrompt({
      imageBase64: validImage,
      notes: "Line 2 sheet for tomorrow",
    });
    expect(userText).toContain("Line 2 sheet for tomorrow");
  });

  it("clamps very long notes", () => {
    const { userText } = buildProductionSheetPrompt({
      imageBase64: validImage,
      notes: "x".repeat(5000),
    });
    expect(userText.length).toBeLessThan(5000);
  });
});

describe("sanitizeSheetRows", () => {
  it("keeps valid rows and clamps confidence/cases", () => {
    const { rows } = sanitizeSheetRows({
      rows: [
        { brand: "DiGiorno", flavor: "Pepperoni", dieType: "12in", casesNeeded: 40.6, date: "2026-06-26", confidence: 2 },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      brand: "DiGiorno",
      flavor: "Pepperoni",
      dieType: "12in",
      casesNeeded: 41,
      date: "2026-06-26",
      confidence: 1,
    });
  });

  it("drops rows with neither brand nor flavor", () => {
    const { rows } = sanitizeSheetRows({ rows: [{ dieType: "12in", casesNeeded: 10 }] });
    expect(rows).toHaveLength(0);
  });

  it("nulls a non-ISO date", () => {
    const { rows } = sanitizeSheetRows({
      rows: [{ brand: "X", flavor: "Y", date: "next tuesday" }],
    });
    expect(rows[0]?.date).toBeNull();
  });

  it("clamps negative cases to 0", () => {
    const { rows } = sanitizeSheetRows({ rows: [{ brand: "X", casesNeeded: -5 }] });
    expect(rows[0]?.casesNeeded).toBe(0);
  });

  it("coerces string cases via lenient parse", () => {
    const { rows } = sanitizeSheetRows({ rows: [{ flavor: "Cheese", casesNeeded: "30" }] });
    expect(rows[0]?.casesNeeded).toBe(30);
  });

  it("caps the number of rows", () => {
    const many = Array.from({ length: MAX_ROWS + 10 }, (_, i) => ({ brand: `B${i}` }));
    const { rows } = sanitizeSheetRows({ rows: many });
    expect(rows.length).toBe(MAX_ROWS);
  });

  it("returns empty rows for garbage input", () => {
    expect(sanitizeSheetRows(null).rows).toEqual([]);
    expect(sanitizeSheetRows("nope").rows).toEqual([]);
    expect(sanitizeSheetRows({ rows: "x" }).rows).toEqual([]);
  });

  it("surfaces a model note when present", () => {
    const { note } = sanitizeSheetRows({ rows: [], note: "Blurry photo" });
    expect(note).toBe("Blurry photo");
  });
});
