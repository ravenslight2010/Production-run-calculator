import { describe, expect, it } from "vitest";
import {
  normalizeMix,
  normalizeMixCustomerMetadata,
} from "./index";

describe("normalizeMixCustomerMetadata", () => {
  it("trims customer fields and converts malformed values to blanks", () => {
    expect(normalizeMixCustomerMetadata({ brand: " Bobo ", flavor: " Fajita " }))
      .toEqual({ brand: "Bobo", flavor: "Fajita" });
    expect(normalizeMixCustomerMetadata({ brand: null, flavor: 42 }))
      .toEqual({ brand: "", flavor: "" });
  });

  it("is used by the full mix normalizer", () => {
    expect(normalizeMix({
      id: "mix-1",
      name: "Veggie",
      brand: " Bobo ",
      flavor: " Fajita ",
    })).toMatchObject({ brand: "Bobo", flavor: "Fajita" });
  });
});