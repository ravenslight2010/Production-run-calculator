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

import { loadProfileSubTab, saveProfileSubTab, saveProfile, setProfileWritesAllowed } from "./storage";
import { DEFAULT_VALUES } from "./types";
import { resetProfileCacheForTests, setProfileCacheIdentity, writeCachedProfileBlobs, readCachedProfileBlobs } from "./profileCache";

describe("profile line-type preference", () => {
  beforeEach(() => {
    localStorage.clear();
    resetProfileCacheForTests();
    markProfileEdited.mockClear();
    setProfileWritesAllowed(true);
  });

  it("saves the product default in its shared profile without losing recipe fields", () => {
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
    expect(markProfileEdited).toHaveBeenCalledExactlyOnceWith("acme__pepperoni");
    saveProfileSubTab("Acme", "Pepperoni", "crusts");
    expect(markProfileEdited).toHaveBeenCalledTimes(1);
  });

  it("adopts the server profile default instead of stale device navigation", () => {
    localStorage.setItem(
      "run-calc-profile-acme__pepperoni",
      JSON.stringify({ _subTab: "crusts" }),
    );

    localStorage.setItem("acme__pepperoni:subtab", "dough");
    expect(loadProfileSubTab("Acme", "Pepperoni")).toBe("crusts");
    expect(markProfileEdited).not.toHaveBeenCalled();
  });

  it("does not recreate a missing profile from a mode toggle", () => {
    saveProfileSubTab("Acme", "Pepperoni", "crusts");
    expect(markProfileEdited).not.toHaveBeenCalled();
    expect(localStorage.getItem("acme__pepperoni:subtab")).toBeNull();
  });

  it("includes the selected default when explicitly creating or editing a profile", () => {
    const values = {
      ...DEFAULT_VALUES,
      doughRecipeName: "Standard",
      doughRecipe: [{ ingredient: "Flour", lbs: 100 }],
      app1Type: "Mozzarella",
      app1OzPerPizza: 2,
      app1BatchLbs: 40,
    };
    expect(saveProfile("Acme", "Pepperoni", values, { subTab: "crusts" })).toBe(true);
    expect(loadProfileSubTab("Acme", "Pepperoni")).toBe("crusts");
    expect(saveProfile("Acme", "Pepperoni", values, { subTab: "dough" })).toBe(true);
    expect(loadProfileSubTab("Acme", "Pepperoni")).toBe("dough");
  });

  it("does not write shared defaults without manage-profiles capability", () => {
    localStorage.setItem("run-calc-profile-acme__pepperoni", JSON.stringify({ _subTab: "dough" }));
    setProfileWritesAllowed(false);
    saveProfileSubTab("Acme", "Pepperoni", "crusts");
    expect(loadProfileSubTab("Acme", "Pepperoni")).toBe("dough");
    expect(markProfileEdited).not.toHaveBeenCalled();
  });

  it("uses the authenticated profile cache and never leaks defaults across identities", () => {
    localStorage.setItem("acme__pepperoni:subtab", "crusts");
    setProfileCacheIdentity({ userId: "manager-a", scope: "live" });
    writeCachedProfileBlobs("acme__pepperoni", { dough: JSON.stringify({ doughRecipeName: "Standard", _subTab: "dough" }) });
    expect(loadProfileSubTab("Acme", "Pepperoni")).toBe("dough");
    saveProfileSubTab("Acme", "Pepperoni", "crusts");
    expect(JSON.parse(readCachedProfileBlobs("acme__pepperoni").dough!)).toEqual({
      doughRecipeName: "Standard", _subTab: "crusts",
    });
    expect(markProfileEdited).toHaveBeenCalledExactlyOnceWith("acme__pepperoni");
    setProfileCacheIdentity({ userId: "manager-b", scope: "sandbox" });
    expect(loadProfileSubTab("Acme", "Pepperoni")).toBeNull();
  });
});