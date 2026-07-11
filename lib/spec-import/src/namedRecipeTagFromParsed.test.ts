import { describe, it, expect } from "vitest";
import {
  namedRecipeTagFromParsed,
  type ParsedProfile,
  type ParsedRecipe,
} from "./index";

// Minimal builders — only the fields the tag derivation reads.
function profile(brand: string, flavor: string): ParsedProfile {
  return {
    brand,
    flavor,
    applicators: [],
    pepperonis: [],
  } as unknown as ParsedProfile;
}

function recipe(over: Partial<ParsedRecipe> = {}): ParsedRecipe {
  return {
    kind: "dough",
    name: "CRB Dough",
    rows: [],
    ...over,
  } as ParsedRecipe;
}

const pool = [
  profile("Hannaford", "Cheese"),
  profile("Hannaford", "Pepperoni"),
  profile("Lucia", "Cheese"),
];

describe("namedRecipeTagFromParsed", () => {
  it("singular brand+flavor → that brand with its one flavor", () => {
    const tag = namedRecipeTagFromParsed(
      recipe({ brand: "Hannaford", flavor: "Cheese" }),
      pool,
    );
    expect(tag).toEqual({ brand: "Hannaford", flavors: ["Cheese"] });
  });

  it("explicit targets list → distinct flavors of the one brand (ci-deduped)", () => {
    const tag = namedRecipeTagFromParsed(
      recipe({
        targets: [
          { brand: "Hannaford", flavor: "Cheese" },
          { brand: "hannaford", flavor: "cheese" },
          { brand: "Hannaford", flavor: "Pepperoni" },
        ],
      }),
      pool,
    );
    expect(tag).toEqual({ brand: "Hannaford", flavors: ["Cheese", "Pepperoni"] });
  });

  it("brand anchor (catch-all) → all varieties (empty flavors)", () => {
    const tag = namedRecipeTagFromParsed(
      recipe({ brandAnchors: ["Hannaford"] }),
      pool,
    );
    expect(tag).toEqual({ brand: "Hannaford", flavors: [] });
  });

  it("singular brand with no flavor → all varieties", () => {
    const tag = namedRecipeTagFromParsed(recipe({ brand: "Hannaford" }), pool);
    expect(tag).toEqual({ brand: "Hannaford", flavors: [] });
  });

  it("multi-brand recipe stays untagged (null)", () => {
    expect(
      namedRecipeTagFromParsed(
        recipe({ brandAnchors: ["Hannaford", "Lucia"] }),
        pool,
      ),
    ).toBeNull();
    expect(
      namedRecipeTagFromParsed(
        recipe({
          targets: [
            { brand: "Hannaford", flavor: "Cheese" },
            { brand: "Lucia", flavor: "Cheese" },
          ],
        }),
        pool,
      ),
    ).toBeNull();
  });

  it("no brand anchor at all → null (shared)", () => {
    expect(namedRecipeTagFromParsed(recipe(), pool)).toBeNull();
  });

  it("anchored brand beats fanned per-flavor targets (stays all-varieties)", () => {
    const tag = namedRecipeTagFromParsed(
      recipe({
        brandAnchors: ["Hannaford"],
        targets: [{ brand: "Hannaford", flavor: "Cheese" }],
      }),
      pool,
    );
    expect(tag).toEqual({ brand: "Hannaford", flavors: [] });
  });
});
