import { describe, it, expect } from "vitest";
import {
  parseCheeseSheet,
  parseCheeseWorkbook,
  cheeseImportId,
  summarizeCheeseImport,
  buildCheeseImportCandidates,
  cheeseLinkKey,
  buildCheeseLinkMap,
  buildCheeseAliasLinkMap,
  buildCheeseAliasLinkMaps,
  withCheeseLinks,
  withCheeseBrandPrefixes,
  resolveCheeseCandidate,
  detectCheeseSubMixes,
  collectCheesePrepItems,
  withCheeseSubMixes,
  type CheeseSheetGrid,
} from "./index";
import type { CheeseRecipe } from "@workspace/cheese-recipes";

function cheese(partial: Partial<CheeseRecipe> & { id: string; name: string }): CheeseRecipe {
  return {
    brand: "",
    flavors: [],
    components: [],
    cellulose: "",
    shredderSetting: "",
    notes: "",
    enabled: true,
    ...partial,
  };
}

// Representative rows taken verbatim from the real
// "Cheese_Mix_Recipe_Specs_-_Tabbed_by_Customer" workbook.
const ALDO: CheeseSheetGrid = {
  name: "Aldo",
  rows: [
    ["Aldo's Cheese ", "", "7/7/2025 Revision 6", "", "", "", ""],
    ["Cheese Shredder Setting: #2", "", "", "", "", "", ""],
    ["All Varieties: Aldo's Standard Cheese Mix", "", "", "", "", "", ""],
    ["**NOTE: No more than 2 - 1cup scoops (0.3lbs) of Cellulose per batch of cheese mix**", "", "", "", "", "", ""],
    ["Aldo's Standard Cheese Mix", "", "", "Aldo's Parmesan / Oregano Mix", "", "", ""],
    ["", "LBS", "", "", "LBS", "", ""],
    ["Part Skim Mozzarella", "20", "", "Grated Parmesan", "10", "", ""],
    ["Pizella (Pizza Cheese)", "35", "", "Oregano Flake", "5", "", ""],
    ["Parm / Oregano Mix", "0.3", "", "Total", "15", "", ""],
    ["Cellulose ", "0.3", "", "", "", "", ""],
    ["Total", "55.6", "", "", "", "", ""],
    ["", "LBS", "", "", "", "", ""],
    ["Cellulose ", "0.3", "", "", "", "", ""],
    ["Percent", "0.51", "", "", "", "", ""],
  ],
};

const BASHA_ORIGINAL: CheeseSheetGrid = {
  name: "Basha's Original",
  rows: [
    ["Basha's Original Cheese", ""],
    ["Cheese Shredder Setting: ", ""],
    ["Cheese: Basha's Original Cheese Mix ", ""],
    ["Pepperoni: Whole Mozz Cheese Mix", ""],
    ["S&P: Whole Mozz Cheese Mix", ""],
    ["Supreme: Whole Mozz Cheese Mix", ""],
    [" Basha's Original Cheese Cheese Mix ", ""],
    ["", "LBS"],
    ["Whole Milk Mozzarella", "20"],
    ["Provolone", "10"],
    ["Cellulose", "0.3"],
    ["Total", "30.3"],
    ["", "LBS"],
    ["Cellulose ", "0.3"],
    ["Percent", "0.99"],
    ["Whole Mozzarella Cheese Mix ", ""],
    ["", "LBS"],
    ["Whole Milk Mozzarella", "40"],
    ["Cellulose", "0.3"],
    ["Total", "40.3"],
    ["", "LBS"],
    ["Cellulose ", "0.3"],
    ["Percent", "0.74"],
    ["03/14/25 Rev. 1", ""],
  ],
};

const BASHA_ULTRA: CheeseSheetGrid = {
  name: "Basha's Ultra Thin",
  rows: [
    ["Basha's Ultra Thin Cheese", "", "", "03.27.25 Rev. 02", ""],
    ["Cheese Shredder Setting: ", "#1", "", "", ""],
    ["5 Cheese: Basha's Ultra Thin 5 Cheese Cheese Mix", "", "", "", ""],
    ["Pepperoni: Basha's Ultra Thin Pep/Romano Cheese Mix", "", "", "", ""],
    ["Basha's Ultra Thin 5 Cheese Cheese Mix ", "", "", "Basha's Ultra Thin Pepperoni/Romano Cheese Mix ", ""],
    ["", "LBS", "", "For 1st Cheese Applicator", ""],
    ["Whole Milk Mozzarella", "40", "", "", "LBS"],
    ["White Cheddar", "10", "", "Whole Mozzarella", "20"],
    ["Cellulose ", "0.3", "", "Provolone", "10"],
    ["Total", "50.3", "", "SHEEP Romano", "3"],
    ["", "LBS", "", "Cellulose", "0.3"],
    ["Cellulose ", "0.3", "", "Total", "33.3"],
    ["Percent", "0.6", "", "", "LBS"],
    ["", "", "", "Cellulose ", "0.3"],
    ["", "", "", "Percent", "0.9"],
  ],
};

describe("cheeseImportId", () => {
  it("is stable and slugified", () => {
    expect(cheeseImportId("Aldo", "Aldo's Standard Cheese Mix")).toBe(
      "cheese:aldo:aldo-s-standard-cheese-mix",
    );
    expect(cheeseImportId("Aldo", "Aldo's Standard Cheese Mix")).toBe(
      cheeseImportId(" aldo ", "Aldo's  Standard   Cheese Mix"),
    );
  });
});

describe("parseCheeseSheet - Aldo (two columns)", () => {
  const sheet = parseCheeseSheet(ALDO);

  it("reads the brand and shredder setting", () => {
    expect(sheet.brand).toBe("Aldo");
    expect(sheet.shredderSetting).toBe("#2");
  });

  it("collects the assignment lines", () => {
    expect(sheet.assignments).toEqual([
      { flavor: "All Varieties", mixName: "Aldo's Standard Cheese Mix" },
    ]);
  });

  it("parses both side-by-side recipe blocks", () => {
    expect(sheet.recipes.map((r) => r.name)).toEqual([
      "Aldo's Standard Cheese Mix",
      "Aldo's Parmesan / Oregano Mix",
    ]);
  });

  it("keeps per-batch components including cellulose", () => {
    const std = sheet.recipes.find((r) => r.name === "Aldo's Standard Cheese Mix")!;
    expect(std.components).toEqual([
      { ingredient: "Part Skim Mozzarella", lbs: 20 },
      { ingredient: "Pizella (Pizza Cheese)", lbs: 35 },
      { ingredient: "Parm / Oregano Mix", lbs: 0.3 },
      { ingredient: "Cellulose", lbs: 0.3 },
    ]);
    expect(std.cellulose).toBe("0.51");
  });

  it("assigns flavors from the assignment lines, collapsing 'All Varieties' to empty (= all flavors)", () => {
    const std = sheet.recipes.find((r) => r.name === "Aldo's Standard Cheese Mix")!;
    // The sheet assigns this mix to "All Varieties" — a whole-brand catch-all,
    // which the CheeseRecipe model represents as an empty list so the blend is
    // offered for EVERY flavor of the brand instead of a fake "All Varieties" one.
    expect(std.flavors).toEqual([]);
    const parm = sheet.recipes.find((r) => r.name === "Aldo's Parmesan / Oregano Mix")!;
    expect(parm.flavors).toEqual([]);
  });
});

describe("parseCheeseSheet - Basha's Original (stacked single column)", () => {
  const sheet = parseCheeseSheet(BASHA_ORIGINAL);

  it("does not misread ingredient rows as headers", () => {
    expect(sheet.recipes.map((r) => r.name)).toEqual([
      "Basha's Original Cheese Cheese Mix",
      "Whole Mozzarella Cheese Mix",
    ]);
  });

  it("maps multiple flavors to the whole-mozz mix", () => {
    const wm = sheet.recipes.find((r) => r.name === "Whole Mozzarella Cheese Mix")!;
    expect(wm.flavors).toEqual(["Pepperoni", "S&P", "Supreme"]);
  });

  it("has an empty shredder setting when the sheet leaves it blank", () => {
    expect(sheet.shredderSetting).toBe("");
  });
});

describe("parseCheeseSheet - Basha's Ultra Thin (delayed LBS marker)", () => {
  const sheet = parseCheeseSheet(BASHA_ULTRA);

  it("finds the shredder value in the adjacent cell", () => {
    expect(sheet.shredderSetting).toBe("#1");
  });

  it("parses a right-column block whose LBS marker is below a sub-label", () => {
    const pep = sheet.recipes.find((r) =>
      r.name === "Basha's Ultra Thin Pepperoni/Romano Cheese Mix",
    )!;
    expect(pep).toBeTruthy();
    expect(pep.components).toEqual([
      { ingredient: "Whole Mozzarella", lbs: 20 },
      { ingredient: "Provolone", lbs: 10 },
      { ingredient: "SHEEP Romano", lbs: 3 },
      { ingredient: "Cellulose", lbs: 0.3 },
    ]);
  });
});

describe("parseCheeseWorkbook", () => {
  const wb = parseCheeseWorkbook([ALDO, BASHA_ORIGINAL, BASHA_ULTRA]);

  it("flattens all tabs and lists the brands", () => {
    expect(wb.brands).toEqual(["Aldo", "Basha's Original", "Basha's Ultra Thin"]);
    expect(wb.recipes.length).toBe(6);
  });

  it("gives every recipe a unique id", () => {
    const ids = new Set(wb.recipes.map((r) => r.id));
    expect(ids.size).toBe(wb.recipes.length);
  });
});

// Non-recipe "noise" lines (revision stamps, dates, the bare "Cellulose"
// summary label, and example-calculation text) can sit in the name column right
// above a real recipe block. Because the block's "LBS" marker falls within the
// next few rows, the scanner used to latch the ingredients onto the noise line,
// producing a junk-named recipe and losing the real one. These fixtures mirror
// the exact junk seen in the real workbook.
describe("parseCheeseSheet - rejects non-recipe noise headers", () => {
  it("skips a calc-text line and attaches ingredients to the real recipe", () => {
    const sheet = parseCheeseSheet({
      name: "Edwardo",
      rows: [
        ["Edwardo Cheese", ""],
        ["Cheese Shredder Setting: #1", ""],
        ["8.19 total mix in pounds *0.8 = 6.6 pounds total parmesan", ""],
        ["Edwardo's Parmesan Oregano Mix", ""],
        ["", "LBS"],
        ["Parmesan Grated", "5"],
        ["Oregano Flake", "1.25"],
        ["Total", "6.25"],
      ],
    });
    expect(sheet.recipes.map((r) => r.name)).toEqual([
      "Edwardo's Parmesan Oregano Mix",
    ]);
    expect(sheet.recipes[0].components).toEqual([
      { ingredient: "Parmesan Grated", lbs: 5 },
      { ingredient: "Oregano Flake", lbs: 1.25 },
    ]);
  });

  it("skips a date / revision stamp above a real block", () => {
    const sheet = parseCheeseSheet({
      name: "Lowe",
      rows: [
        ["Lowe Cheese", ""],
        ["Cheese Shredder Setting: #1", ""],
        ["3/4/2025 Rev. 20", ""],
        ["Lowe's Grilled Vegetable Cheese Mix", ""],
        ["", "LBS"],
        ["Whole Milk Mozzarella", "20"],
        ["Provolone", "20"],
        ["Fontina", "20"],
        ["Cellulose", "0.3"],
        ["Total", "60.3"],
      ],
    });
    expect(sheet.recipes.map((r) => r.name)).toEqual([
      "Lowe's Grilled Vegetable Cheese Mix",
    ]);
  });

  it("skips a bare 'Cellulose' summary label used as a header", () => {
    const sheet = parseCheeseSheet({
      name: "Corner Booth",
      rows: [
        ["Corner Booth Cheese", ""],
        ["Cheese Shredder Setting: #1", ""],
        ["Cellulose", ""],
        ["Corner Booth Five Cheese Mix", ""],
        ["", "LBS"],
        ["Whole Mozzarella", "40"],
        ["Cellulose", "0.3"],
        ["Total", "40.3"],
      ],
    });
    expect(sheet.recipes.map((r) => r.name)).toEqual([
      "Corner Booth Five Cheese Mix",
    ]);
  });

  it("collapses runs of whitespace in a captured recipe name", () => {
    const sheet = parseCheeseSheet({
      name: "SMD",
      rows: [
        ["Cheese Shredder Setting: #1", ""],
        ["SMD Supreme Cheese Mix          (same as Lowe's Grilled Veggie)", ""],
        ["", "LBS"],
        ["Whole Milk Mozzarella", "20"],
        ["Total", "20"],
      ],
    });
    expect(sheet.recipes.map((r) => r.name)).toEqual([
      "SMD Supreme Cheese Mix (same as Lowe's Grilled Veggie)",
    ]);
  });
});

describe("summary + candidates", () => {
  const wb = parseCheeseWorkbook([ALDO]);
  const existingId = wb.recipes[0].id;
  const existsById = (id: string) => id === existingId;

  it("counts new vs updated", () => {
    expect(summarizeCheeseImport(wb.recipes, existsById)).toEqual({
      total: 2,
      added: 1,
      updated: 1,
    });
  });

  it("labels each candidate", () => {
    const cands = buildCheeseImportCandidates(wb.recipes, existsById);
    expect(cands.map((c) => c.status)).toEqual(["update", "new"]);
  });
});

describe("cheeseLinkKey", () => {
  it("expands abbreviations and drops generic filler tokens", () => {
    expect(cheeseLinkKey("Whole Mozz Cheese Mix")).toBe(
      cheeseLinkKey("Whole Mozzarella Cheese Mix"),
    );
    expect(cheeseLinkKey("Aldo's Cheese Mix")).toBe(
      cheeseLinkKey("Aldo's Standard Cheese Mix"),
    );
    expect(cheeseLinkKey("Aldo's Cheese Mix")).toBe(
      cheeseLinkKey("Aldo's Regular Cheese Mix"),
    );
  });

  it("keeps meaningful qualifiers distinct", () => {
    expect(cheeseLinkKey("5 Cheese Mix")).not.toBe(cheeseLinkKey("Cheese Mix"));
    expect(cheeseLinkKey("Spicy Cheese Mix")).not.toBe(cheeseLinkKey("Cheese Mix"));
  });

  it("never collapses to empty when a name is all filler", () => {
    expect(cheeseLinkKey("Standard Pizza")).not.toBe("");
  });
});

describe("link-to-existing detection", () => {
  const existing: CheeseRecipe[] = [
    cheese({
      id: "cheese:basha:whole-mozzarella-cheese-mix",
      brand: "Basha's",
      name: "Whole Mozzarella Cheese Mix",
    }),
    cheese({
      id: "cheese:aldo:aldo-s-standard-cheese-mix",
      brand: "Aldo",
      name: "Aldo's Standard Cheese Mix",
    }),
  ];

  it("suggests a link for a shorthand name of the same brand", () => {
    const imported = [
      cheese({
        id: "cheese:basha:whole-mozz-cheese-mix",
        brand: "Basha's",
        name: "Whole Mozz Cheese Mix",
      }),
    ];
    const base = buildCheeseImportCandidates(imported, () => false);
    const linked = withCheeseLinks(base, existing);
    expect(linked[0].status).toBe("new");
    expect(linked[0].linkTo).toEqual({
      id: "cheese:basha:whole-mozzarella-cheese-mix",
      name: "Whole Mozzarella Cheese Mix",
    });
  });

  it("suggests a link for a name with one extra word (Craft) — reviewable proposal", () => {
    const imported = [
      cheese({
        id: "cheese:basha:craft-whole-mozzarella-cheese-mix",
        brand: "Basha's",
        name: "Craft Whole Mozzarella Cheese Mix",
      }),
    ];
    const linked = withCheeseLinks(
      buildCheeseImportCandidates(imported, () => false),
      existing,
    );
    expect(linked[0].linkTo).toEqual({
      id: "cheese:basha:whole-mozzarella-cheese-mix",
      name: "Whole Mozzarella Cheese Mix",
    });
  });

  it("suggests a link for a single-typo name of the same brand", () => {
    const imported = [
      cheese({
        id: "cheese:basha:whole-mozzarella-chese-mix",
        brand: "Basha's",
        name: "Whole Mozzarella Chese Mix",
      }),
    ];
    const linked = withCheeseLinks(
      buildCheeseImportCandidates(imported, () => false),
      existing,
    );
    expect(linked[0].linkTo).toEqual({
      id: "cheese:basha:whole-mozzarella-cheese-mix",
      name: "Whole Mozzarella Cheese Mix",
    });
  });

  it("does not suggest a link across brands", () => {
    const imported = [
      cheese({
        id: "cheese:corner:whole-mozz-cheese-mix",
        brand: "Corner Booth",
        name: "Whole Mozz Cheese Mix",
      }),
    ];
    const linked = withCheeseLinks(
      buildCheeseImportCandidates(imported, () => false),
      existing,
    );
    expect(linked[0].linkTo).toBeUndefined();
  });

  it("does not suggest a link when the id already exists (clean update)", () => {
    const imported = [
      cheese({
        id: "cheese:basha:whole-mozzarella-cheese-mix",
        brand: "Basha's",
        name: "Whole Mozzarella Cheese Mix",
      }),
    ];
    const linked = withCheeseLinks(
      buildCheeseImportCandidates(imported, (id) => id === imported[0].id),
      existing,
    );
    expect(linked[0].status).toBe("update");
    expect(linked[0].linkTo).toBeUndefined();
  });

  it("drops both links when two imported blends would target the same existing recipe", () => {
    // Both shorthand names loose-match the one existing "Whole Mozzarella Cheese
    // Mix"; linking both and committing would collide (last-write-wins) and lose
    // one blend's data, so NEITHER link is proposed — they stay new recipes.
    const imported = [
      cheese({
        id: "cheese:basha:whole-mozz-cheese-mix",
        brand: "Basha's",
        name: "Whole Mozz Cheese Mix",
      }),
      cheese({
        id: "cheese:basha:whole-moz-cheese-mix",
        brand: "Basha's",
        name: "Whole Moz Cheese Mix",
      }),
    ];
    const linked = withCheeseLinks(
      buildCheeseImportCandidates(imported, () => false),
      existing,
    );
    expect(linked.every((c) => c.linkTo === undefined)).toBe(true);
  });

  it("drops a link when another candidate already updates that recipe by exact id", () => {
    // One blend IS the existing recipe (exact id → clean update); a second blend
    // loose-matches the SAME recipe. Proposing the link would double-write the id,
    // so the link is dropped and only the exact update applies.
    const imported = [
      cheese({
        id: "cheese:basha:whole-mozzarella-cheese-mix",
        brand: "Basha's",
        name: "Whole Mozzarella Cheese Mix",
      }),
      cheese({
        id: "cheese:basha:whole-mozz-cheese-mix",
        brand: "Basha's",
        name: "Whole Mozz Cheese Mix",
      }),
    ];
    const existsById = (id: string) => id === imported[0].id;
    const linked = withCheeseLinks(
      buildCheeseImportCandidates(imported, existsById),
      existing,
    );
    expect(linked[0].status).toBe("update");
    expect(linked[0].linkTo).toBeUndefined();
    expect(linked[1].linkTo).toBeUndefined();
  });

  it("drops ambiguous loose keys so nothing is silently relabeled", () => {
    const ambiguous: CheeseRecipe[] = [
      cheese({ id: "a", brand: "Zed", name: "Zed Standard Cheese Mix" }),
      cheese({ id: "b", brand: "Zed", name: "Zed Regular Cheese Mix" }),
    ];
    const map = buildCheeseLinkMap(ambiguous);
    expect(map.size).toBe(0);
  });

  it("keeps a duplicate-id / same-name pair as an unambiguous target", () => {
    const dupes: CheeseRecipe[] = [
      cheese({ id: "x", brand: "Zed", name: "Zed Cheese Mix" }),
      cheese({ id: "x", brand: "Zed", name: "Zed Cheese Mix" }),
    ];
    const map = buildCheeseLinkMap(dupes);
    expect(map.size).toBe(1);
  });
});

describe("buildCheeseAliasLinkMap", () => {
  it("keeps only context-free appType aliases, lowercased by external name", () => {
    const map = buildCheeseAliasLinkMap([
      { kind: "appType", externalName: " Shorthand Mix ", canonicalName: "Real Mix", context: null },
      { kind: "appType", externalName: "Scoped", canonicalName: "Nope", context: "brand:x" },
      { kind: "brand", externalName: "Brandish", canonicalName: "Nope" },
      { kind: "appType", externalName: "", canonicalName: "Nope", context: null },
    ]);
    expect(map.size).toBe(1);
    expect(map.get("shorthand mix")).toBe("Real Mix");
  });

  it("drops an external name mapped to two different canonicals", () => {
    const map = buildCheeseAliasLinkMap([
      { kind: "appType", externalName: "Mix A", canonicalName: "Target 1", context: null },
      { kind: "appType", externalName: "mix a", canonicalName: "Target 2", context: null },
      { kind: "appType", externalName: "Mix B", canonicalName: "Target 1", context: null },
    ]);
    expect(map.has("mix a")).toBe(false);
    expect(map.get("mix b")).toBe("Target 1");
  });

  it("keeps a repeated identical mapping (ci canonical)", () => {
    const map = buildCheeseAliasLinkMap([
      { kind: "appType", externalName: "Mix A", canonicalName: "Target 1", context: null },
      { kind: "appType", externalName: "Mix A", canonicalName: "target 1", context: null },
    ]);
    expect(map.get("mix a")).toBe("Target 1");
  });

  it("rejects generic slot-type names ('Mix'/'cheese') on either side", () => {
    const map = buildCheeseAliasLinkMap([
      // Poison shape observed in production: real blend name → literal "Mix".
      { kind: "appType", externalName: "Sweet Chili Veggie Cheese Mix", canonicalName: "Mix", context: null },
      { kind: "appType", externalName: "BBQ Chicken Cheese Mix", canonicalName: "cheese", context: null },
      { kind: "appType", externalName: "Mix", canonicalName: "Lowe's Red Hot Chicken Mix", context: null },
      { kind: "appType", externalName: "Cheese Mix", canonicalName: "Some Blend", context: null },
      // A legit blend-to-blend link must survive.
      { kind: "appType", externalName: "Shorthand Blend", canonicalName: "Real Blend Mix", context: null },
    ]);
    expect(map.size).toBe(1);
    expect(map.get("shorthand blend")).toBe("Real Blend Mix");
  });
});

describe("alias-driven link precedence", () => {
  const existing: CheeseRecipe[] = [
    cheese({
      id: "cheese:basha:whole-mozzarella-cheese-mix",
      brand: "Basha's",
      name: "Whole Mozzarella Cheese Mix",
    }),
    cheese({
      id: "cheese:basha:five-cheese-mix",
      brand: "Basha's",
      name: "5 Cheese Mix",
    }),
  ];

  it("an alias link wins even when the loose/near-dup matchers find nothing", () => {
    // "House Blend" shares no tokens with any existing name — only the learned
    // alias can link it.
    const imported = [
      cheese({ id: "cheese:basha:house-blend", brand: "Basha's", name: "House Blend" }),
    ];
    const aliasLinks = buildCheeseAliasLinkMap([
      { kind: "appType", externalName: "House Blend", canonicalName: "5 Cheese Mix", context: null },
    ]);
    const linked = withCheeseLinks(
      buildCheeseImportCandidates(imported, () => false),
      existing,
      aliasLinks,
    );
    expect(linked[0].linkTo).toEqual({
      id: "cheese:basha:five-cheese-mix",
      name: "5 Cheese Mix",
    });
  });

  it("an alias link overrides a different loose-key match", () => {
    // The shorthand would loose-match "Whole Mozzarella Cheese Mix", but the
    // manager previously redirected it to "5 Cheese Mix" — the alias wins.
    const imported = [
      cheese({
        id: "cheese:basha:whole-mozz-cheese-mix",
        brand: "Basha's",
        name: "Whole Mozz Cheese Mix",
      }),
    ];
    const aliasLinks = buildCheeseAliasLinkMap([
      {
        kind: "appType",
        externalName: "Whole Mozz Cheese Mix",
        canonicalName: "5 Cheese Mix",
        context: null,
      },
    ]);
    const linked = withCheeseLinks(
      buildCheeseImportCandidates(imported, () => false),
      existing,
      aliasLinks,
    );
    expect(linked[0].linkTo).toEqual({
      id: "cheese:basha:five-cheese-mix",
      name: "5 Cheese Mix",
    });
  });

  it("alias links still respect the one-to-one claims guard", () => {
    // Both blends alias to the SAME existing recipe → both links are dropped
    // rather than colliding in the last-write-wins merge.
    const imported = [
      cheese({ id: "cheese:basha:blend-a", brand: "Basha's", name: "Blend A" }),
      cheese({ id: "cheese:basha:blend-b", brand: "Basha's", name: "Blend B" }),
    ];
    const aliasLinks = buildCheeseAliasLinkMap([
      { kind: "appType", externalName: "Blend A", canonicalName: "5 Cheese Mix", context: null },
      { kind: "appType", externalName: "Blend B", canonicalName: "5 Cheese Mix", context: null },
    ]);
    const linked = withCheeseLinks(
      buildCheeseImportCandidates(imported, () => false),
      existing,
      aliasLinks,
    );
    expect(linked.every((c) => c.linkTo === undefined)).toBe(true);
  });

  it("an alias link survives the target's own exact-id update (merge → re-import)", () => {
    // Merge-learned alias scenario: the survivor's own block re-imports as an
    // exact-id update AND the merged-away block aliases onto it. The link must
    // survive (shown in review to accept/clear) or the merged-away blend
    // silently resurrects as "new" on every re-import of the same workbook.
    const imported = [
      cheese({ id: "cheese:basha:five-cheese-mix", brand: "Basha's", name: "5 Cheese Mix" }),
      cheese({ id: "cheese:basha:old-blend", brand: "Basha's", name: "Old Blend" }),
    ];
    const aliasLinks = buildCheeseAliasLinkMap([
      { kind: "appType", externalName: "Old Blend", canonicalName: "5 Cheese Mix", context: null },
    ]);
    const linked = withCheeseLinks(
      buildCheeseImportCandidates(imported, (id) => id === "cheese:basha:five-cheese-mix"),
      existing,
      aliasLinks,
    );
    expect(linked[0].status).toBe("update");
    expect(linked[0].linkTo).toBeUndefined();
    expect(linked[1].linkTo).toEqual({
      id: "cheese:basha:five-cheese-mix",
      name: "5 Cheese Mix",
    });
  });

  it("a HEURISTIC link is still vetoed by the target's own exact-id update", () => {
    // "Whole Mozz Cheese Mix" loose-matches "Whole Mozzarella Cheese Mix", but
    // that recipe's own block is also in the import — the guess stays dropped.
    const imported = [
      cheese({
        id: "cheese:basha:whole-mozzarella-cheese-mix",
        brand: "Basha's",
        name: "Whole Mozzarella Cheese Mix",
      }),
      cheese({
        id: "cheese:basha:whole-mozz-cheese-mix",
        brand: "Basha's",
        name: "Whole Mozz Cheese Mix",
      }),
    ];
    const linked = withCheeseLinks(
      buildCheeseImportCandidates(
        imported,
        (id) => id === "cheese:basha:whole-mozzarella-cheese-mix",
      ),
      existing,
    );
    expect(linked[1].linkTo).toBeUndefined();
  });

  it("no alias link when the candidate already updates by exact id", () => {
    const imported = [
      cheese({
        id: "cheese:basha:five-cheese-mix",
        brand: "Basha's",
        name: "5 Cheese Mix",
      }),
    ];
    const aliasLinks = buildCheeseAliasLinkMap([
      {
        kind: "appType",
        externalName: "5 Cheese Mix",
        canonicalName: "Whole Mozzarella Cheese Mix",
        context: null,
      },
    ]);
    const linked = withCheeseLinks(
      buildCheeseImportCandidates(imported, (id) => id === imported[0].id),
      existing,
      aliasLinks,
    );
    expect(linked[0].status).toBe("update");
    expect(linked[0].linkTo).toBeUndefined();
  });

  it("ambiguous canonical name across brands without a same-brand winner links nothing", () => {
    const pool: CheeseRecipe[] = [
      cheese({ id: "p1", brand: "Zed", name: "Duplicate Mix" }),
      cheese({ id: "p2", brand: "Wye", name: "Duplicate Mix" }),
    ];
    const imported = [
      cheese({ id: "cheese:other:blend", brand: "Other", name: "Blend X" }),
    ];
    const aliasLinks = buildCheeseAliasLinkMap([
      { kind: "appType", externalName: "Blend X", canonicalName: "Duplicate Mix", context: null },
    ]);
    const linked = withCheeseLinks(
      buildCheeseImportCandidates(imported, () => false),
      pool,
      aliasLinks,
    );
    expect(linked[0].linkTo).toBeUndefined();
  });
});

describe("resolveCheeseCandidate", () => {
  const linkTo = { id: "existing-id", name: "Existing Name" };
  const candidate = {
    recipe: cheese({ id: "workbook-id", brand: "Basha's", name: "Workbook Name" }),
    status: "new" as const,
    linkTo,
  };

  it("swaps id + name onto the existing recipe when linking is enabled", () => {
    const resolved = resolveCheeseCandidate(candidate, true);
    expect(resolved.id).toBe("existing-id");
    expect(resolved.name).toBe("Existing Name");
    expect(resolved.brand).toBe("Basha's");
  });

  it("keeps the workbook id + name when linking is disabled", () => {
    const resolved = resolveCheeseCandidate(candidate, false);
    expect(resolved.id).toBe("workbook-id");
    expect(resolved.name).toBe("Workbook Name");
  });

  it("is a no-op passthrough when there is no link", () => {
    const noLink = { recipe: cheese({ id: "z", name: "Z" }), status: "new" as const };
    expect(resolveCheeseCandidate(noLink, true)).toEqual(noLink.recipe);
  });
});

// ---------------------------------------------------------------------------
// Sub-mix detection (workbook "depth")
// ---------------------------------------------------------------------------

describe("detectCheeseSubMixes", () => {
  it("flags a blend that is itself an ingredient inside another blend on the tab", () => {
    const { sheets } = parseCheeseWorkbook([ALDO]);
    const map = detectCheeseSubMixes(sheets);
    // "Aldo's Parmesan / Oregano Mix" appears as the "Parm / Oregano Mix" row
    // inside "Aldo's Standard Cheese Mix".
    const subMix = sheets[0].recipes.find(
      (r) => r.name === "Aldo's Parmesan / Oregano Mix",
    );
    expect(subMix).toBeDefined();
    expect(map.get(subMix!.id)).toBe("Aldo's Standard Cheese Mix");
  });

  it("does NOT flag the parent blend itself", () => {
    const { sheets } = parseCheeseWorkbook([ALDO]);
    const map = detectCheeseSubMixes(sheets);
    const parent = sheets[0].recipes.find(
      (r) => r.name === "Aldo's Standard Cheese Mix",
    );
    expect(parent).toBeDefined();
    expect(map.has(parent!.id)).toBe(false);
  });

  it("does NOT mistake a raw-cheese component for a same-named 'X Cheese Mix' block", () => {
    // "Whole Mozzarella Cheese Mix" is a standalone blend; "Whole Mozzarella"
    // (a raw cheese) is a component of other blends. They must NOT link.
    const grid: CheeseSheetGrid = {
      name: "Acme",
      rows: [
        ["Five Cheese Mix", "", "", "Whole Mozzarella Cheese Mix", ""],
        ["", "LBS", "", "", "LBS"],
        ["Whole Mozzarella", "20", "", "Whole Mozzarella", "40"],
        ["Provolone", "5", "", "Total", "40"],
        ["Total", "25", "", "", ""],
      ],
    };
    const { sheets } = parseCheeseWorkbook([grid]);
    const map = detectCheeseSubMixes(sheets);
    expect(map.size).toBe(0);
  });

  it("scopes detection per tab (no cross-tab sub-mix links)", () => {
    const a: CheeseSheetGrid = {
      name: "A",
      rows: [
        ["Base Mix", ""],
        ["", "LBS"],
        ["Spice Mix", "0.3"],
        ["Total", "0.3"],
      ],
    };
    const b: CheeseSheetGrid = {
      name: "B",
      rows: [
        ["Spice Mix", ""],
        ["", "LBS"],
        ["Salt", "1"],
        ["Total", "1"],
      ],
    };
    const { sheets } = parseCheeseWorkbook([a, b]);
    const map = detectCheeseSubMixes(sheets);
    // "Spice Mix" block lives on tab B; its component reference lives on tab A —
    // different tabs, so no link.
    expect(map.size).toBe(0);
  });
});

describe("withCheeseSubMixes", () => {
  it("attaches subMixOf only to candidates in the map", () => {
    const candidates = [
      { recipe: cheese({ id: "sub", name: "Spice Mix" }), status: "new" as const },
      { recipe: cheese({ id: "top", name: "Base Mix" }), status: "new" as const },
    ];
    const out = withCheeseSubMixes(candidates, new Map([["sub", "Base Mix"]]));
    expect(out.find((c) => c.recipe.id === "sub")?.subMixOf).toBe("Base Mix");
    expect(out.find((c) => c.recipe.id === "top")?.subMixOf).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Prep-item detection
// ---------------------------------------------------------------------------

describe("collectCheesePrepItems", () => {
  const CORNER: CheeseSheetGrid = {
    name: "Corner Booth",
    rows: [
      ["Corner Booth White Spinach & Mushroom Cheese Mix", ""],
      ["", "LBS"],
      ["Whole Mozzarella", "20"],
      ["Fresh Spinach", "17.5"],
      ["Parmesan, Grated", "2.5"],
      ["Total", "40"],
    ],
  };

  it("surfaces fresh/perishable ingredient rows inside blends", () => {
    const { sheets } = parseCheeseWorkbook([CORNER]);
    const prep = collectCheesePrepItems(sheets);
    const spinach = prep.find((p) => /spinach/i.test(p.ingredient));
    expect(spinach).toBeDefined();
    expect(spinach!.blend).toBe(
      "Corner Booth White Spinach & Mushroom Cheese Mix",
    );
    expect(spinach!.lbs).toBe(17.5);
  });

  it("leaves shelf-stable cheeses out of the prep list", () => {
    const { sheets } = parseCheeseWorkbook([CORNER]);
    const prep = collectCheesePrepItems(sheets);
    expect(prep.some((p) => /mozzarella|parmesan/i.test(p.ingredient))).toBe(
      false,
    );
  });

  it("dedupes the same prep item across tabs", () => {
    const { sheets } = parseCheeseWorkbook([CORNER, CORNER]);
    const prep = collectCheesePrepItems(sheets);
    expect(prep.filter((p) => /spinach/i.test(p.ingredient)).length).toBe(1);
  });
});

describe("detectCheeseSubMixes — shared sub-mix", () => {
  it("still flags a sub-mix referenced by two parent blends on one tab", () => {
    // "Spice Blend" is a component of BOTH "Blend A" and "Blend B" and has its
    // own block. It must be flagged as a sub-mix; the parent label is one of the
    // two (last-seen wins by design — label fidelity only, not correctness).
    const grid: CheeseSheetGrid = {
      name: "Shared",
      rows: [
        ["Blend A", "", "", "Blend B", ""],
        ["", "LBS", "", "", "LBS"],
        ["Whole Mozzarella", "20", "", "Provolone", "20"],
        ["Spice Blend", "0.3", "", "Spice Blend", "0.3"],
        ["Total", "20.3", "", "Total", "20.3"],
        ["Spice Blend", "", "", "", ""],
        ["", "LBS", "", "", ""],
        ["Oregano", "1", "", "", ""],
        ["Total", "1", "", "", ""],
      ],
    };
    const { sheets } = parseCheeseWorkbook([grid]);
    const map = detectCheeseSubMixes(sheets);
    const sub = sheets[0].recipes.find((r) => r.name === "Spice Blend");
    expect(sub).toBeDefined();
    expect(["Blend A", "Blend B"]).toContain(map.get(sub!.id));
  });
});

describe("buildCheeseAliasLinkMaps + brand-scoped precedence", () => {
  const existing: CheeseRecipe[] = [
    cheese({ id: "lucia-blend", brand: "Lucia's", name: "House Blend" }),
    cheese({ id: "marco-blend", brand: "Marco's", name: "Marco Special" }),
  ];

  it("a brand-scoped alias only fires for that brand's imports", () => {
    const maps = buildCheeseAliasLinkMaps([
      { kind: "appType", externalName: "Shorthand", canonicalName: "House Blend", context: "Lucia's" },
    ]);
    const lucia = withCheeseLinks(
      buildCheeseImportCandidates([cheese({ id: "l1", brand: "Lucia's", name: "Shorthand" })], () => false),
      existing,
      maps,
    );
    expect(lucia[0].linkTo).toEqual({ id: "lucia-blend", name: "House Blend" });
    const marco = withCheeseLinks(
      buildCheeseImportCandidates([cheese({ id: "m1", brand: "Marco's", name: "Shorthand" })], () => false),
      existing,
      maps,
    );
    expect(marco[0].linkTo).toBeUndefined();
  });

  it("a brand-scoped alias beats the context-free one for the same external name", () => {
    const maps = buildCheeseAliasLinkMaps([
      { kind: "appType", externalName: "Shorthand", canonicalName: "Marco Special", context: null },
      { kind: "appType", externalName: "Shorthand", canonicalName: "House Blend", context: "Lucia's" },
    ]);
    const linked = withCheeseLinks(
      buildCheeseImportCandidates([cheese({ id: "l1", brand: "Lucia's", name: "Shorthand" })], () => false),
      existing,
      maps,
    );
    expect(linked[0].linkTo).toEqual({ id: "lucia-blend", name: "House Blend" });
  });

  it("never alias-links across brands, even when the other brand's row is the only name match", () => {
    // A context-free alias learned from Marco's must NOT redirect a Bobos
    // import onto Marco's recipe.
    const maps = buildCheeseAliasLinkMaps([
      { kind: "appType", externalName: "Shorthand", canonicalName: "Marco Special", context: null },
    ]);
    const linked = withCheeseLinks(
      buildCheeseImportCandidates([cheese({ id: "x1", brand: "Bobos", name: "Shorthand" })], () => false),
      existing,
      maps,
    );
    expect(linked[0].linkTo).toBeUndefined();
  });

  it("context-free alias still resolves to an UNBRANDED shared row for any brand", () => {
    const pool: CheeseRecipe[] = [
      ...existing,
      cheese({ id: "shared-special", brand: "", name: "Shared Special" }),
    ];
    const maps = buildCheeseAliasLinkMaps([
      { kind: "appType", externalName: "Shorthand2", canonicalName: "Shared Special", context: null },
    ]);
    const linked = withCheeseLinks(
      buildCheeseImportCandidates([cheese({ id: "x2", brand: "Bobos", name: "Shorthand2" })], () => false),
      pool,
      maps,
    );
    expect(linked[0].linkTo).toEqual({ id: "shared-special", name: "Shared Special" });
  });

  it("an alias whose canonical name exists under two brands prefers the candidate's own brand", () => {
    const two: CheeseRecipe[] = [
      cheese({ id: "lucia-taco", brand: "Lucia's", name: "Taco Mix" }),
      cheese({ id: "marco-taco", brand: "Marco's", name: "Taco Mix" }),
    ];
    const maps = buildCheeseAliasLinkMaps([
      { kind: "appType", externalName: "Taco Blend", canonicalName: "Taco Mix", context: null },
    ]);
    const linked = withCheeseLinks(
      buildCheeseImportCandidates([cheese({ id: "l2", brand: "Lucia's", name: "Taco Blend" })], () => false),
      two,
      maps,
    );
    expect(linked[0].linkTo).toEqual({ id: "lucia-taco", name: "Taco Mix" });
    // Unknown third brand → ambiguous, no guess.
    const other = withCheeseLinks(
      buildCheeseImportCandidates([cheese({ id: "b1", brand: "Bobos", name: "Taco Blend" })], () => false),
      two,
      maps,
    );
    expect(other[0].linkTo).toBeUndefined();
  });
});

describe("withCheeseBrandPrefixes", () => {
  it("renames a cross-brand name collision to the brand-prefixed name, keeping the id", () => {
    const existing = [cheese({ id: "marco-taco", brand: "Marco's", name: "Taco Mix" })];
    const cands = buildCheeseImportCandidates(
      [cheese({ id: "cheese:import:lucia:taco-mix", brand: "Lucia's", name: "Taco Mix" })],
      () => false,
    );
    const out = withCheeseBrandPrefixes(withCheeseLinks(cands, existing), existing);
    expect(out[0].recipe.name).toBe("Lucia's Taco Mix");
    expect(out[0].recipe.id).toBe("cheese:import:lucia:taco-mix");
  });

  it("is idempotent on re-import (prefixed name stays, no double prefix)", () => {
    const existing = [
      cheese({ id: "marco-taco", brand: "Marco's", name: "Taco Mix" }),
      cheese({ id: "cheese:import:lucia:taco-mix", brand: "Lucia's", name: "Lucia's Taco Mix" }),
    ];
    const cands = buildCheeseImportCandidates(
      [cheese({ id: "cheese:import:lucia:taco-mix", brand: "Lucia's", name: "Taco Mix" })],
      (id) => existing.some((r) => r.id === id),
    );
    const out = withCheeseBrandPrefixes(withCheeseLinks(cands, existing), existing);
    expect(out[0].recipe.name).toBe("Lucia's Taco Mix");
  });

  it("same-brand and unbranded collisions are untouched", () => {
    const existing = [
      cheese({ id: "lucia-old", brand: "Lucia's", name: "Taco Mix" }),
      cheese({ id: "shared", brand: "", name: "House Blend" }),
    ];
    const cands = buildCheeseImportCandidates(
      [
        cheese({ id: "l1", brand: "Lucia's", name: "Taco Mix" }),
        cheese({ id: "l2", brand: "Lucia's", name: "House Blend" }),
      ],
      () => false,
    );
    const out = withCheeseBrandPrefixes(cands, existing);
    expect(out[0].recipe.name).toBe("Taco Mix");
    expect(out[1].recipe.name).toBe("House Blend");
  });

  it("a candidate with a proposed link keeps its link and is not renamed", () => {
    const existing = [
      cheese({ id: "shared-taco", brand: "", name: "Taco Mix" }),
      cheese({ id: "marco-other", brand: "Marco's", name: "Taco Mix" }),
    ];
    const maps = buildCheeseAliasLinkMaps([
      { kind: "appType", externalName: "Taco Mix", canonicalName: "Taco Mix", context: "Lucia's" },
    ]);
    const linked = withCheeseLinks(
      buildCheeseImportCandidates([cheese({ id: "l1", brand: "Lucia's", name: "Taco Mix" })], () => false),
      existing,
      maps,
    );
    const out = withCheeseBrandPrefixes(linked, existing);
    expect(out[0].linkTo).toEqual({ id: "shared-taco", name: "Taco Mix" });
    expect(out[0].recipe.name).toBe("Taco Mix");
  });

  it("two different brands colliding within the same batch both get prefixed", () => {
    const cands = buildCheeseImportCandidates(
      [
        cheese({ id: "l1", brand: "Lucia's", name: "Taco Mix" }),
        cheese({ id: "m1", brand: "Marco's", name: "Taco Mix" }),
      ],
      () => false,
    );
    const out = withCheeseBrandPrefixes(cands, []);
    expect(out.map((c) => c.recipe.name)).toEqual(["Lucia's Taco Mix", "Marco's Taco Mix"]);
  });
});

describe("unbranded pool fallback (same-brand first, then unbranded, never cross-brand)", () => {
  const shared = cheese({
    id: "cheese:shared:house-cheese-mix",
    brand: "",
    name: "House Cheese Mix",
  });

  it("exact loose-key: a branded import links to an unbranded pool row", () => {
    const linked = withCheeseLinks(
      buildCheeseImportCandidates(
        [cheese({ id: "cheese:lucia:house-cheese-mix", brand: "Lucia's", name: "House Cheese Mix" })],
        () => false,
      ),
      [shared],
    );
    expect(linked[0].linkTo).toEqual({ id: shared.id, name: "House Cheese Mix" });
  });

  it("same-brand row wins over an unbranded row with the same loose key", () => {
    const luciaRow = cheese({
      id: "cheese:lucia:house-cheese-mix",
      brand: "Lucia's",
      name: "House Cheese Mix",
    });
    const linked = withCheeseLinks(
      buildCheeseImportCandidates(
        [cheese({ id: "cheese:lucia:house-chees-mix-2", brand: "Lucia's", name: "House Standard Cheese Mix" })],
        () => false,
      ),
      [shared, luciaRow],
    );
    expect(linked[0].linkTo).toEqual({ id: luciaRow.id, name: "House Cheese Mix" });
  });

  it("near-dup: a branded typo import links to an unbranded pool row", () => {
    const linked = withCheeseLinks(
      buildCheeseImportCandidates(
        [cheese({ id: "cheese:lucia:house-chese-mix", brand: "Lucia's", name: "House Chese Mix" })],
        () => false,
      ),
      [shared],
    );
    expect(linked[0].linkTo).toEqual({ id: shared.id, name: "House Cheese Mix" });
  });

  it("alias: a learned redirect resolves to an unbranded row when names collide across other brands", () => {
    const marcoRow = cheese({
      id: "cheese:marco:house-cheese-mix",
      brand: "Marco's",
      name: "House Cheese Mix",
    });
    const linked = withCheeseLinks(
      buildCheeseImportCandidates(
        [cheese({ id: "cheese:lucia:hcm", brand: "Lucia's", name: "HCM Blend" })],
        () => false,
      ),
      [shared, marcoRow],
      buildCheeseAliasLinkMaps([
        { kind: "appType", externalName: "HCM Blend", canonicalName: "House Cheese Mix", context: null },
      ]),
    );
    expect(linked[0].linkTo).toEqual({ id: shared.id, name: "House Cheese Mix" });
  });

  it("never links to ANOTHER brand's row when no unbranded row exists", () => {
    const marcoRow = cheese({
      id: "cheese:marco:secret-cheese-mix",
      brand: "Marco's",
      name: "Secret Cheese Mix",
    });
    const linked = withCheeseLinks(
      buildCheeseImportCandidates(
        [cheese({ id: "cheese:lucia:secret-cheese-mix", brand: "Lucia's", name: "Secret Cheese Mix" })],
        () => false,
      ),
      [marcoRow],
    );
    expect(linked[0].linkTo).toBeUndefined();
  });
});
