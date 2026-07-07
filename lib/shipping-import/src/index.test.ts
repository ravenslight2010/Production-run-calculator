import { describe, it, expect } from "vitest";
import {
  parseShippingGuide,
  shippingPatchFromRow,
  mapShipper,
  mapCircles,
  mapStacking,
  mapGripSheets,
  mapCount,
  matchShippingBrand,
  buildShippingCandidates,
  describeShippingPatch,
  type ShippingGuideRow,
} from "./index";

const HEADER = [
  "PIZZA", "BOX", "DIMENSIONS", "CIRCLE", "PIZZAS/CS", "CASES ",
  "GRIPSHEEETS", "PALLET TYPE", "STACKING", "FILM", "PALLET HEIGHT",
];

function grid(rows: string[][]) {
  return [{ name: "Sheet1", rows }];
}

describe("parseShippingGuide", () => {
  it("finds the header, skips the title and spacer rows, and reads each brand row", () => {
    const rows = parseShippingGuide(
      grid([
        ["SHIPPING BOXES AND PALLETIZING GUIDE  07/02/2026"],
        HEADER,
        ["Aldo's", '12" shipper ', "24.5 x 12.125 x 5.75", "12''", "12", "60", "N/A", "Regular", "Lucia's", '16" or 15"', '66"'],
        ["", "", "", "", "", "", "", "", "", "", ""],
        ["Hannaford", '11" shipper', "22.875 x 11.375 x 7.875", '11"', "12", "48", "X", "Good Ones", "Hannaford", '16" or 15"', '72"'],
      ]),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      name: "Aldo's",
      box: '12" shipper',
      circle: "12''",
      pizzasPerCase: "12",
      casesPerSkid: "60",
      gripSheets: "N/A",
      stacking: "Lucia's",
    });
    expect(rows[1].name).toBe("Hannaford");
  });

  it("returns [] when no sheet has a recognizable header", () => {
    expect(parseShippingGuide(grid([["random"], ["stuff", "here"]]))).toEqual([]);
  });

  it("tolerates the GRIPSHEEETS typo and punctuation in headers", () => {
    const rows = parseShippingGuide(
      grid([
        ["PIZZA", "BOX", "CIRCLE", "PIZZAS/CS", "CASES", "GRIPSHEETS", "STACKING"],
        ["Bobo's", '12" shipper', "12''", "12", "60", "N/A", "Column"],
      ]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].gripSheets).toBe("N/A");
    expect(rows[0].stacking).toBe("Column");
  });
});

describe("value mappings", () => {
  it("maps BOX to shipper options", () => {
    expect(mapShipper('12" shipper')).toBe("12in");
    expect(mapShipper('White 12" shipper')).toBe("12in");
    expect(mapShipper('11" shipper')).toBe("11in");
    expect(mapShipper('BC-7" shipper')).toBe("7in");
    expect(mapShipper('7" Microwave Shipper')).toBe("7in");
    expect(mapShipper("EDW2 shipper")).toBe("edwardos");
    expect(mapShipper("4 pk. HSC")).toBe("costco");
    expect(mapShipper("")).toBeUndefined();
    expect(mapShipper("mystery box")).toBeUndefined();
  });

  it("maps CIRCLE to circles options", () => {
    expect(mapCircles("12''")).toBe("12in");
    expect(mapCircles('11"')).toBe("11in");
    expect(mapCircles('7"')).toBe("7in");
    expect(mapCircles("Susceptor")).toBe("microwave");
    expect(mapCircles("N/A")).toBe("none");
    expect(mapCircles("")).toBe("none");
  });

  it("maps STACKING to skid-stacking options", () => {
    expect(mapStacking("Lucia's")).toBe("lucia");
    expect(mapStacking("Hannaford")).toBe("hannaford");
    expect(mapStacking("Column")).toBe("column");
    expect(mapStacking("Pinwheel")).toBeUndefined();
  });

  it("maps GRIPSHEETS: only N/A maps (to none); X keeps the current setting", () => {
    expect(mapGripSheets("N/A")).toBe("none");
    expect(mapGripSheets("X")).toBeUndefined();
    expect(mapGripSheets("x+cardboard")).toBeUndefined();
  });

  it("maps counts only when strictly numeric", () => {
    expect(mapCount("12")).toBe(12);
    expect(mapCount("48")).toBe(48);
    expect(mapCount("4 - 3PACK")).toBeUndefined();
    expect(mapCount("")).toBeUndefined();
    expect(mapCount("0")).toBeUndefined();
  });
});

describe("shippingPatchFromRow", () => {
  const base: ShippingGuideRow = {
    name: "Aldo's",
    box: '12" shipper',
    circle: "12''",
    pizzasPerCase: "12",
    casesPerSkid: "60",
    gripSheets: "N/A",
    stacking: "Lucia's",
  };

  it("maps a fully-recognized row with nothing unmapped", () => {
    const { patch, unmapped } = shippingPatchFromRow(base);
    expect(patch).toEqual({
      shipper: "12in",
      circles: "12in",
      skidStacking: "lucia",
      gripSheets: "none",
      pizzasPerCase: 12,
      casesPerSkid: 60,
    });
    expect(unmapped).toEqual([]);
  });

  it("omits unmappable values and lists them as kept-as-is", () => {
    const { patch, unmapped } = shippingPatchFromRow({
      ...base,
      gripSheets: "X",
      pizzasPerCase: "4 - 3PACK",
    });
    expect(patch.gripSheets).toBeUndefined();
    expect(patch.pizzasPerCase).toBeUndefined();
    expect(unmapped).toEqual(["Gripsheets: X", "Pizzas/case: 4 - 3PACK"]);
  });
});

describe("matchShippingBrand", () => {
  const brands = ["Aldo's", "Hannaford", "Lucia's", "Corner Booth Pizza"];

  it("matches exact (case-insensitive)", () => {
    expect(matchShippingBrand("aldo's", brands)).toBe("Aldo's");
  });

  it("matches on the loose key (punctuation/spacing differences)", () => {
    expect(matchShippingBrand("Aldos", brands)).toBe("Aldo's");
  });

  it("returns null for names with extra qualifier words (manager picks)", () => {
    expect(matchShippingBrand("Lucia's w Cartons", brands)).toBeNull();
    expect(matchShippingBrand("Costco (Lucia's)", brands)).toBeNull();
  });

  it("returns null for unknown names and blanks", () => {
    expect(matchShippingBrand("Brand MR07CH24", brands)).toBeNull();
    expect(matchShippingBrand("", brands)).toBeNull();
  });
});

describe("buildShippingCandidates + describeShippingPatch", () => {
  it("builds a review row per guide row with stable ids", () => {
    const rows = parseShippingGuide(
      grid([
        HEADER,
        ["Aldo's", '12" shipper', "", "12''", "12", "60", "N/A", "Regular", "Lucia's", "", ""],
        ["Mystery Brand", '11" shipper', "", '11"', "12", "48", "X", "Regular", "Hannaford", "", ""],
      ]),
    );
    const cands = buildShippingCandidates(rows, ["Aldo's"]);
    expect(cands).toHaveLength(2);
    expect(cands[0]).toMatchObject({ id: "ship-0", brand: "Aldo's" });
    expect(cands[1]).toMatchObject({ id: "ship-1", brand: null });
    expect(describeShippingPatch(cands[0].patch)).toEqual([
      "Shipper: 12in",
      "Circles: 12in",
      "Stacking: lucia",
      "Grip sheets: none",
      "Pizzas/case: 12",
      "Cases/skid: 60",
    ]);
  });
});
