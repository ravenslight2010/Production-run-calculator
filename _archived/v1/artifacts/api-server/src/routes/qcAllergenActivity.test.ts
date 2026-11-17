import { describe, expect, it } from "vitest";
import {
  projectActivitySnapshot,
  projectAllergenReview,
} from "./qcAllergenActivity";

describe("QC allergen activity snapshot projection", () => {
  const snapshot = (date: string, runs: unknown[], runValues: Record<string, unknown> = {}) => ({
    dayState: { date, runs },
    runValues,
  });

  it("keeps the manually recorded value separate and does not infer a missing value", () => {
    const result = projectActivitySnapshot(snapshot("2026-10-16", [
      { id: "run-none", brand: "A", flavor: "Plain" },
      { id: "run-missing" },
    ], { "run-none": { allergen: "none" }, "run-missing": {} }), "2026-10-16", "active-day-state");

    expect(result).toMatchObject({
      status: "available",
      runs: [
        { runId: "run-none", manualAllergen: { status: "recorded", value: "none" } },
        { runId: "run-missing", manualAllergen: { status: "unavailable", value: null } },
      ],
    });
  });

  it("rejects snapshots for another production date and malformed or duplicate run identities", () => {
    expect(projectActivitySnapshot(snapshot("2026-10-15", []), "2026-10-16", "completed-snapshot"))
      .toEqual({ status: "unavailable", reason: "date-mismatch" });
    expect(projectActivitySnapshot({ dayState: { date: "2026-10-16", runs: [{}] } }, "2026-10-16", "active-day-state"))
      .toEqual({ status: "unavailable", reason: "invalid-run" });
    expect(projectActivitySnapshot(snapshot("2026-10-16", [{ id: "r" }, { id: "r" }]), "2026-10-16", "active-day-state"))
      .toEqual({ status: "unavailable", reason: "duplicate-run" });
    expect(projectActivitySnapshot(null, "2026-10-16", "completed-snapshot"))
      .toEqual({ status: "unavailable", reason: "invalid-snapshot" });
  });

  it("preserves the reviewed-empty, reviewed, and unknown distinctions", () => {
    const base = {
      footprintReviewed: true,
      footprint: { status: "complete", allergens: [], unknownIngredients: [], missingComponents: [] },
    };
    expect(projectAllergenReview(base).state).toBe("reviewed-empty");
    expect(projectAllergenReview({
      ...base,
      footprint: { ...base.footprint, allergens: ["milk"] },
    }).state).toBe("reviewed");
    expect(projectAllergenReview({
      ...base,
      footprint: { ...base.footprint, status: "incomplete" },
    }).state).toBe("unknown");
    expect(projectAllergenReview({
      ...base,
      footprint: { ...base.footprint, missingComponents: ["sauce"] },
    }).state).toBe("unknown");
    expect(projectAllergenReview({ footprintReviewed: false, footprint: base.footprint }).state).toBe("unknown");
  });
});
