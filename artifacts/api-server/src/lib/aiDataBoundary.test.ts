import { describe, expect, it } from "vitest";
import {
  AI_ROUTE_BOUNDARIES,
  safeAiErrorMetadata,
  validateAiRequestBoundary,
} from "./aiDataBoundary";

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

  it("keeps database error payloads out of correction-write diagnostics", () => {
    const error = Object.assign(
      new Error("fixture-source fixture-target"),
      {
        status: 500,
        code: "23505",
        query: "insert into ai_corrections",
        params: ["fixture-source", "fixture-target"],
      },
    );

    const metadata = safeAiErrorMetadata(error);
    expect(metadata).toEqual({
      status: 500,
      code: "23505",
      errorType: "Error",
    });
    expect(JSON.stringify(metadata)).not.toContain("fixture-source");
    expect(JSON.stringify(metadata)).not.toContain("fixture-target");
    expect(metadata).not.toHaveProperty("message");
    expect(metadata).not.toHaveProperty("query");
    expect(metadata).not.toHaveProperty("params");
  });

  it("drops non-machine-readable error fields instead of logging their text", () => {
    const metadata = safeAiErrorMetadata({
      name: "fixture source label",
      status: "fixture target label",
      code: "correction:fixture value",
      message: "private correction text",
    });

    expect(metadata).toEqual({ errorType: "Error" });
  });
});