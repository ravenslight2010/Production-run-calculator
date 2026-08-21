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

  it("embeds the selected sub-tab in the dough profile and marks it edited", () => {
    localStorage.setItem(
      "run-calc-profile-acme__pepperoni",
      JSON.stringify({ doughRecipeName: "Standard" }),
    );

    saveProfileSubTab("Acme", "Pepperoni", "crusts");

    expect(
      JSON.parse(localStorage.getItem("run-calc-profile-acme__pepperoni")!),
    ).toMatchObject({
      doughRecipeName: "Standard",
      _subTab: "crusts",
    });
    expect(localStorage.getItem("acme__pepperoni:subtab")).toBe("crusts");
    expect(markProfileEdited).toHaveBeenCalledWith("acme__pepperoni");
  });

  it("loads the embedded sub-tab when the fast-access key is absent", () => {
    localStorage.setItem(
      "run-calc-profile-acme__pepperoni",
      JSON.stringify({ _subTab: "crusts" }),
    );

    expect(loadProfileSubTab("Acme", "Pepperoni")).toBe("crusts");
    expect(localStorage.getItem("acme__pepperoni:subtab")).toBe("crusts");
  });
});