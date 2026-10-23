import { describe, it, expect, beforeEach, vi } from "vitest";

const { markProfileEdited } = vi.hoisted(() => ({
  markProfileEdited: vi.fn(),
}));

vi.mock("./profileServerSync", () => ({
  canonicalProfileKey: (brand: string, flavor: string) =>
    `${brand.trim().toLowerCase()}__${flavor.trim().toLowerCase()}`,
  markProfileEdited,
  markProfileDeleted: vi.fn(),
}));

import { loadProfileSubTab, saveProfileSubTab } from "./storage";

describe("profile line-type preference", () => {
  beforeEach(() => {
    localStorage.clear();
    markProfileEdited.mockClear();
  });

  it("keeps the selected navigation sub-tab device-local without editing shared setup", () => {
    localStorage.setItem(
      "run-calc-profile-acme__pepperoni",
      JSON.stringify({ doughRecipeName: "Standard" }),
    );

    saveProfileSubTab("Acme", "Pepperoni", "crusts");

    expect(
      JSON.parse(localStorage.getItem("run-calc-profile-acme__pepperoni")!),
    ).toMatchObject({
      doughRecipeName: "Standard",
    });
    expect(localStorage.getItem("acme__pepperoni:subtab")).toBe("crusts");
    expect(markProfileEdited).not.toHaveBeenCalled();
  });

  it("does not adopt navigation from shared profile metadata", () => {
    localStorage.setItem(
      "run-calc-profile-acme__pepperoni",
      JSON.stringify({ _subTab: "crusts" }),
    );

    expect(loadProfileSubTab("Acme", "Pepperoni")).toBeNull();
    expect(localStorage.getItem("acme__pepperoni:subtab")).toBeNull();
  });
});