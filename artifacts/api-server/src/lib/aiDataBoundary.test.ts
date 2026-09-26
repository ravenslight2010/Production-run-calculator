import { describe, expect, it } from "vitest";
import { AI_ROUTE_BOUNDARIES, validateAiRequestBoundary } from "./aiDataBoundary";

describe("AI operational data boundaries", () => {
  it("catalogs every retained provider route with an explicit policy", () => {
    const entries = Object.values(AI_ROUTE_BOUNDARIES);
    expect(entries.map((entry) => entry.path)).toEqual([
      "/ai/match-import",
      "/ai/parse-spec-sheet",
      "/server-jobs (type: workbook-parse)",
      "/ai/parse-spec-images",
      "/ai/match-premix",
      "/inventory/identify-photo",
      "/inventory/production-sheet-photo",
      "/inventory/count-observations",
    ]);
    for (const entry of entries) {
      expect(entry.capability).toBeTruthy();
      expect(entry.purpose).toBeTruthy();
      expect(entry.provider).toContain("Gemini");
      expect(entry.dataCategories.length).toBeGreaterThan(0);
      expect(entry.topLevelFields.length).toBeGreaterThan(0);
      expect(entry.maxRequestBytes).toBeGreaterThan(0);
      expect(entry.retention).toBeTruthy();
      expect(entry.fallback).toBeTruthy();
    }
  });

  it.each(["password", "token", "authorization", "cookie", "logs", "apiKey"])(
    "rejects prohibited nested field %s",
    (field) => {
      const result = validateAiRequestBoundary(AI_ROUTE_BOUNDARIES.parseSpecSheet, {
        workbookText: "Brand\tFlavor",
        known: { brands: ["A"], [field]: "must-not-leave" },
      });
      expect(result).toEqual({
        ok: false,
        status: 400,
        error: "Sensitive or unrelated fields are not allowed in AI requests",
      });
    },
  );

  it("rejects unknown top-level fields instead of silently stripping them", () => {
    const result = validateAiRequestBoundary(AI_ROUTE_BOUNDARIES.matchPremix, {
      brands: [],
      brandFlavors: {},
      unmatchedNames: ["A"],
      facilitySnapshot: { recipes: ["unrelated"] },
    });
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Field "facilitySnapshot" is not allowed for this AI operation',
    });
  });

  it("rejects payloads over the route-specific byte budget", () => {
    const result = validateAiRequestBoundary(
      { ...AI_ROUTE_BOUNDARIES.matchPremix, maxRequestBytes: 10 },
      { brands: ["too-large"] },
    );
    expect(result).toEqual({ ok: false, status: 413, error: "AI request payload is too large" });
  });

  it("accepts only the documented fields within the byte budget", () => {
    expect(validateAiRequestBoundary(AI_ROUTE_BOUNDARIES.matchPremix, {
      brands: ["Known"],
      brandFlavors: { Known: ["Cheese"] },
      unmatchedNames: ["Known Cheese Mix"],
    })).toEqual({ ok: true });
  });
});