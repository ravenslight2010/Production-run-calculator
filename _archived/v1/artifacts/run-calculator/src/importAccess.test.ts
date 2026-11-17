import { describe, expect, it } from "vitest";
import { getImportAccess } from "./importAccess";

describe("import/export capability visibility", () => {
  it("allows a fully capable manager to use every import and export control", () => {
    expect(
      getImportAccess(new Set(["manage-profiles", "manage-inventory", "use-ai-tools"])),
    ).toEqual({
      canImportSpec: true,
      canImportPremixOrCheese: true,
      canImportProfileGuide: true,
      canExportSpec: true,
    });
  });

  it("lets an inventory manager import inventory workbooks without profile access", () => {
    expect(getImportAccess(new Set(["manage-inventory"]))).toEqual({
      canImportSpec: false,
      canImportPremixOrCheese: true,
      canImportProfileGuide: false,
      canExportSpec: true,
    });
  });

  it("lets a profile manager import profile guides without unrelated inventory actions", () => {
    expect(getImportAccess(new Set(["manage-profiles"]))).toEqual({
      canImportSpec: false,
      canImportPremixOrCheese: false,
      canImportProfileGuide: true,
      canExportSpec: true,
    });
  });

  it("does not let manage-staff or AI access substitute for a required write capability", () => {
    expect(getImportAccess(new Set(["manage-staff", "use-ai-tools"]))).toEqual({
      canImportSpec: false,
      canImportPremixOrCheese: false,
      canImportProfileGuide: false,
      canExportSpec: false,
    });
  });
});