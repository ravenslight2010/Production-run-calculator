import { describe, it, expect } from "vitest";
import {
  parseCheeseSheet,
  parseCheeseWorkbook,
  cheeseImportId,
  summarizeCheeseImport,
  buildCheeseImportCandidates,
  type CheeseSheetGrid,
} from "./index";

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
