// @vitest-environment jsdom
//
// relinkCheeseSlotsToMixInProfiles — after a manager moves a misfiled blend
// from Cheese Recipes to Mixes, every saved profile applicator slot
// name-linked to it (app{n}CheeseRecipeName, case-insensitive) with type
// "cheese" must re-type to the generic "Mix" (the link name field is shared
// between the two slot kinds, see mix-applicator-slots). Writes are targeted
// dough-blob writes + edit stamps — never saveProfile (crust clobber).
import { describe, it, expect, beforeEach } from "vitest";

import { relinkCheeseSlotsToMixInProfiles, loadProfile } from "./storage";
import { PROFILE_KEY, BRAND_FLAVORS_KEY } from "./types";

function seedProfile(brand: string, flavor: string, values: Record<string, unknown>) {
  localStorage.setItem(PROFILE_KEY(brand, flavor), JSON.stringify(values));
}

function seedBrandFlavors(map: Record<string, string[]>) {
  localStorage.setItem(BRAND_FLAVORS_KEY, JSON.stringify(map));
}

beforeEach(() => {
  localStorage.clear();
});

describe("relinkCheeseSlotsToMixInProfiles", () => {
  it("re-types a cheese slot linked by name to Mix, keeping the link", () => {
    seedBrandFlavors({ Mauro: ["Italian Beef & Giardiniera"] });
    seedProfile("Mauro", "Italian Beef & Giardiniera", {
      app1Type: "cheese",
      app1CheeseRecipeName: "Italian Beef & Gravy",
      app1OzPerPizza: 4.75,
      app2Type: "pepperoni",
    });

    const changed = relinkCheeseSlotsToMixInProfiles("Italian Beef & Gravy");
    expect(changed).toBe(1);

    const p = loadProfile("Mauro", "Italian Beef & Giardiniera") as unknown as Record<string, unknown>;
    expect(p.app1Type).toBe("Mix");
    expect(p.app1CheeseRecipeName).toBe("Italian Beef & Gravy");
    expect(p.app1OzPerPizza).toBe(4.75); // untouched
    expect(p.app2Type).toBe("pepperoni"); // untouched
  });

  it("matches the link name case-insensitively", () => {
    seedBrandFlavors({ B: ["F"] });
    seedProfile("B", "F", {
      app3Type: "Cheese",
      app3CheeseRecipeName: "ITALIAN BEEF & GRAVY",
    });
    expect(relinkCheeseSlotsToMixInProfiles("italian beef & gravy")).toBe(1);
    const p = loadProfile("B", "F") as unknown as Record<string, unknown>;
    expect(p.app3Type).toBe("Mix");
  });

  it("re-types a legacy slot whose TYPE cell holds the recipe name, filling the link", () => {
    seedBrandFlavors({ B: ["F"] });
    seedProfile("B", "F", { app2Type: "Italian Beef & Gravy" });
    expect(relinkCheeseSlotsToMixInProfiles("Italian Beef & Gravy")).toBe(1);
    const p = loadProfile("B", "F") as unknown as Record<string, unknown>;
    expect(p.app2Type).toBe("Mix");
    expect(p.app2CheeseRecipeName).toBe("Italian Beef & Gravy");
  });

  it("leaves other cheese slots, other recipes' links, and Mix slots alone", () => {
    seedBrandFlavors({ B: ["F"], C: ["G"] });
    seedProfile("B", "F", {
      app1Type: "cheese",
      app1CheeseRecipeName: "Real Cheese Blend",
    });
    seedProfile("C", "G", {
      app1Type: "Mix",
      app1CheeseRecipeName: "Italian Beef & Gravy",
    });
    expect(relinkCheeseSlotsToMixInProfiles("Italian Beef & Gravy")).toBe(0);
    const b = loadProfile("B", "F") as unknown as Record<string, unknown>;
    expect(b.app1Type).toBe("cheese");
    const c = loadProfile("C", "G") as unknown as Record<string, unknown>;
    expect(c.app1Type).toBe("Mix");
  });

  it("returns 0 for a blank name and when nothing is linked", () => {
    seedBrandFlavors({ B: ["F"] });
    seedProfile("B", "F", { app1Type: "cheese" });
    expect(relinkCheeseSlotsToMixInProfiles("  ")).toBe(0);
    expect(relinkCheeseSlotsToMixInProfiles("Unknown")).toBe(0);
  });
});
