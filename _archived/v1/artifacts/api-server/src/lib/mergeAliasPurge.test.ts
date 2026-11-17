import { describe, it, expect } from "vitest";
import {
  BOGUS_CHEESE_MERGE_ALIAS_PAIRS,
  isBogusMergeAlias,
  toPoolNameSet,
} from "./mergeAliasPurge";

const EMPTY = new Set<string>();

describe("isBogusMergeAlias", () => {
  it("flags every audited poison pair when the canonical has no pool row", () => {
    for (const [external, canonical] of BOGUS_CHEESE_MERGE_ALIAS_PAIRS) {
      expect(
        isBogusMergeAlias({ externalName: external, canonicalName: canonical }, EMPTY),
      ).toBe(true);
    }
  });

  it("matches case-insensitively with whitespace tolerance", () => {
    expect(
      isBogusMergeAlias(
        { externalName: "Aldo's Standard Cheese Mix", canonicalName: " Ald " },
        EMPTY,
      ),
    ).toBe(true);
  });

  it("keeps the legitimate reverse SMD mapping", () => {
    // "SMD Pep Cheese Mix" -> "SMD Pepperoni Cheese Mix" points at the real
    // surviving recipe and must NOT be purged.
    expect(
      isBogusMergeAlias(
        {
          externalName: "SMD Pep Cheese Mix",
          canonicalName: "SMD Pepperoni Cheese Mix",
        },
        EMPTY,
      ),
    ).toBe(false);
  });

  it("keeps legitimate aliases untouched", () => {
    expect(
      isBogusMergeAlias(
        {
          externalName: "Bobo Breakfast Cheese",
          canonicalName: "Bobo's Breakfast Cheese Mix",
        },
        EMPTY,
      ),
    ).toBe(false);
  });

  it("spares a poison pair whose canonical has since become a real pool row", () => {
    const pool = toPoolNameSet(["SMD Pep Cheese Mix", "Other"]);
    expect(
      isBogusMergeAlias(
        {
          externalName: "SMD Pepperoni Cheese Mix",
          canonicalName: "SMD Pep Cheese Mix",
        },
        pool,
      ),
    ).toBe(false);
    // Pool names elsewhere don't rescue an unrelated poison canonical.
    expect(
      isBogusMergeAlias(
        { externalName: "Aldo's Cheese Mix", canonicalName: "Ald" },
        pool,
      ),
    ).toBe(true);
  });
});
