import { describe, expect, it } from "vitest";
import { workbookCellAddress, workbookCellReference } from "./workbookSource";

describe("workbook source coordinates", () => {
  it.each([
    [0, 0, "A1"],
    [1, 25, "Z2"],
    [26, 26, "AA27"],
    [1048575, 16383, "XFD1048576"],
  ])("converts zero-based row %i and column %i to %s", (row, column, expected) => {
    expect(workbookCellAddress(row, column)).toBe(expected);
  });

  it("includes the sheet and optional uploaded filename", () => {
    expect(workbookCellReference("Sheet 1", 4, 2, "spec.xlsx")).toEqual({
      file: "spec.xlsx",
      sheet: "Sheet 1",
      cell: "C5",
    });
    expect(workbookCellReference("Sheet 1", 4, 2)).toEqual({
      sheet: "Sheet 1",
      cell: "C5",
    });
  });

  it("rejects coordinates outside Excel's worksheet limits", () => {
    expect(() => workbookCellAddress(-1, 0)).toThrow(RangeError);
    expect(() => workbookCellAddress(0, 16384)).toThrow(RangeError);
  });
});
