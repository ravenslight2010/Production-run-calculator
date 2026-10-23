import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import { makeImportGoldInput } from "@/importGold";

afterEach(() => cleanup());

describe("Import Gold input preparation", () => {
  it("drops workbook-location and filename metadata while preserving reviewed fields", () => {
    expect(makeImportGoldInput({
      recipes: [{ name: "Blend", sourceLocations: { name: [{ file: "customer.xlsx", cell: "A1" }] }, components: [{ ingredient: "Salt", lbs: 1 }] }],
      sourceNames: ["customer.xlsx"],
    })).toEqual({
      recipes: [{ name: "Blend", components: [{ ingredient: "Salt", lbs: 1 }] }],
    });
  });

  it("rejects inputs above the capture size limit", () => {
    expect(() => makeImportGoldInput({ recipes: [{ notes: "x".repeat(101 * 1024) }] }))
      .toThrow("too large");
  });
});
