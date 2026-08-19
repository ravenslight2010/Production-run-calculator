// @vitest-environment jsdom
//
// Physical line stations: the pep/stick applicators sit BETWEEN Applicator 2
// and Applicator 3 on the line, so the spec importer's AI may report an
// explicit `slot` for a topping the sheet lists after the pep rows.
// applySpecImport must honor that slot (topping lands on app3/app4 fields, not
// the next free listed position) while keeping the legacy fill-in-order
// behavior when no slots are reported.

import { describe, it, expect, beforeEach } from "vitest";
import { applySpecImport, loadProfile, saveList, saveProfile } from "./storage";
import { MIX_RECIPE_NAMES_KEY } from "./types";
import type { ParsedSpecImport } from "@workspace/spec-import";

beforeEach(() => {
  localStorage.clear();
});

const parsedWith = (
  applicators: ParsedSpecImport["profiles"][number]["applicators"],
): ParsedSpecImport => ({
  profiles: [
    {
      brand: "Corner Booth",
      flavor: "SUPREME",
      applicators,
      pepperonis: [{ type: "Pepperoni", sticks: 12, ozPerPizza: 1.4 }],
    },
  ],
  recipes: [],
});

describe("applySpecImport applicator slot assignment", () => {
  it("maps an explicit slot 3 topping onto app3 fields, not app2", () => {
    applySpecImport(
      parsedWith([
        { type: "cheese", ozPerPizza: 4 },
        // Listed 2nd on the sheet, but positioned AFTER the pep rows → App 3.
        { type: "Sausage", ozPerPizza: 2.25, slot: 3 },
      ]),
    );
    const prof = loadProfile("Corner Booth", "SUPREME") as Record<string, unknown>;
    expect(prof.app1Type).toBe("cheese");
    expect(prof.app2Type ?? "").toBe("");
    expect(prof.app3Type).toBe("Sausage");
    expect(prof.app3OzPerPizza).toBe(2.25);
    expect(prof.app4Type ?? "").toBe("");
  });

  it("keeps legacy fill-in-order behavior when no slots are reported", () => {
    applySpecImport(
      parsedWith([
        { type: "cheese", ozPerPizza: 4 },
        { type: "Sausage", ozPerPizza: 2.25 },
      ]),
    );
    const prof = loadProfile("Corner Booth", "SUPREME") as Record<string, unknown>;
    expect(prof.app1Type).toBe("cheese");
    expect(prof.app2Type).toBe("Sausage");
    expect(prof.app3Type ?? "").toBe("");
  });

  it("unslotted applicators flow around an explicitly claimed station", () => {
    applySpecImport(
      parsedWith([
        { type: "Bacon", ozPerPizza: 1.2, slot: 4 },
        { type: "cheese", ozPerPizza: 4 },
        { type: "Sausage", ozPerPizza: 2.25 },
      ]),
    );
    const prof = loadProfile("Corner Booth", "SUPREME") as Record<string, unknown>;
    expect(prof.app1Type).toBe("cheese");
    expect(prof.app2Type).toBe("Sausage");
    expect(prof.app3Type ?? "").toBe("");
    expect(prof.app4Type).toBe("Bacon");
    expect(prof.app4OzPerPizza).toBe(1.2);
  });
});

// ── Cheese blend names must match the EXISTING pool, not just this import ──
// A spec-only workbook often names a blend the factory already has, with no
// cheese recipe in the same file. Without the pool union the resolver found no
// candidate, the raw blend name stayed as the applicator type, and it leaked
// into the shared Type dropdown (user report: "there are cheeses in applicator
// type and not under cheese").
describe("applySpecImport cheese applicator vs existing pool", () => {
  it("re-types a blend-named applicator to 'cheese' when the blend exists only in the local pool mirror", () => {
    localStorage.setItem(
      "run-calc-cheese-recipe-presets",
      JSON.stringify({ "Aldo's Cheese Mix": [{ ingredient: "Mozzarella", lbs: 100 }] }),
    );
    applySpecImport(parsedWith([{ type: "Aldo's Cheese Mix", ozPerPizza: 3.5 }]));
    const prof = loadProfile("Corner Booth", "SUPREME") as Record<string, unknown>;
    expect(prof.app1Type).toBe("cheese");
    expect(prof.app1CheeseRecipeName).toBe("Aldo's Cheese Mix");
  });

  it("does NOT re-type a MIX-named slot to cheese even though mixes share the cheese preset map (case/whitespace-insensitive filter)", () => {
    localStorage.setItem(
      "run-calc-cheese-recipe-presets",
      JSON.stringify({ "White Fajita Mix": [{ ingredient: "Monterey Jack", lbs: 20 }] }),
    );
    // Stale/messy local list entry: extra whitespace + different case.
    saveList(MIX_RECIPE_NAMES_KEY, ["  white fajita MIX  "]);
    applySpecImport(parsedWith([{ type: "White Fajita Mix", ozPerPizza: 3 }]));
    const prof = loadProfile("Corner Booth", "SUPREME") as Record<string, unknown>;
    expect(prof.app1Type).not.toBe("cheese");
  });
});

// ── Merged-away names resolve through the factory merge history ──
// A sheet can name a blend/mix that has since been merged into another recipe
// (merge_aliases row). A spec-only workbook carries no recipe under the old
// name and the pool holds only the canonical one, so the resolvers must accept
// the merged-away name as a candidate and the written slot link must be the
// CANONICAL name — never the resurrected old one.
describe("applySpecImport merged-away applicator names", () => {
  it("links an old merged-away MIX name to the surviving canonical mix (profile-only workbook)", () => {
    saveList(MIX_RECIPE_NAMES_KEY, ["Fajita Blend Mix"]);
    applySpecImport(
      parsedWith([{ type: "White Fajita Mix", ozPerPizza: 3 }]),
      undefined,
      undefined,
      undefined,
      undefined,
      { mixes: [{ externalName: "White Fajita Mix", canonicalName: "Fajita Blend Mix" }] },
    );
    const prof = loadProfile("Corner Booth", "SUPREME") as Record<string, unknown>;
    expect(prof.app1Type).toBe("Mix");
    expect(prof.app1CheeseRecipeName).toBe("Fajita Blend Mix");
  });

  it("links an old merged-away CHEESE blend name to the surviving canonical blend (profile-only workbook)", () => {
    localStorage.setItem(
      "run-calc-cheese-recipe-presets",
      JSON.stringify({ "House Blend Cheese": [{ ingredient: "Mozzarella", lbs: 100 }] }),
    );
    applySpecImport(
      parsedWith([{ type: "Old House Blend", ozPerPizza: 3.5 }]),
      undefined,
      undefined,
      undefined,
      undefined,
      { cheese: [{ externalName: "Old House Blend", canonicalName: "House Blend Cheese" }] },
    );
    const prof = loadProfile("Corner Booth", "SUPREME") as Record<string, unknown>;
    expect(prof.app1Type).toBe("cheese");
    expect(prof.app1CheeseRecipeName).toBe("House Blend Cheese");
  });

  it("follows a chained merge on a slot link to the current canonical name", () => {
    saveList(MIX_RECIPE_NAMES_KEY, ["Fajita Blend Mix"]);
    applySpecImport(
      parsedWith([{ type: "Fajita Mix", ozPerPizza: 3 }]),
      undefined,
      undefined,
      undefined,
      undefined,
      {
        mixes: [
          { externalName: "Fajita Mix", canonicalName: "White Fajita Mix" },
          { externalName: "White Fajita Mix", canonicalName: "Fajita Blend Mix" },
        ],
      },
    );
    const prof = loadProfile("Corner Booth", "SUPREME") as Record<string, unknown>;
    expect(prof.app1Type).toBe("Mix");
    expect(prof.app1CheeseRecipeName).toBe("Fajita Blend Mix");
  });
});

// ── Profile's own generic-typed links count as resolver candidates ──
// A mix the factory never defined as a Mixes recipe (e.g. "Hot Giardiniera
// Mix") can exist ONLY as a profile's slot link. A re-import whose sheet names
// the applicator by that raw name must keep the generic "Mix" type + link,
// not clobber the type back to the raw sheet name (user report: Auto-Fill
// flagged "now Mix · import says Hot Giardiniera Mix").
describe("applySpecImport profile-link candidates", () => {
  it("keeps a generic Mix slot when the sheet's raw name matches only the profile's own link", () => {
    saveProfile("Corner Booth", "SUPREME", {
      app1Type: "Mix",
      app1CheeseRecipeName: "Hot Giardiniera Mix",
      app1OzPerPizza: 1.75,
    } as never);
    applySpecImport(parsedWith([{ type: "Hot Giardiniera Mix", ozPerPizza: 1.75 }]));
    const prof = loadProfile("Corner Booth", "SUPREME") as Record<string, unknown>;
    expect(prof.app1Type).toBe("Mix");
    expect(prof.app1CheeseRecipeName).toBe("Hot Giardiniera Mix");
  });
});
