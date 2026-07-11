// @vitest-environment jsdom
//
// Physical line stations: the pep/stick applicators sit BETWEEN Applicator 2
// and Applicator 3 on the line, so the spec importer's AI may report an
// explicit `slot` for a topping the sheet lists after the pep rows.
// applySpecImport must honor that slot (topping lands on app3/app4 fields, not
// the next free listed position) while keeping the legacy fill-in-order
// behavior when no slots are reported.

import { describe, it, expect, beforeEach } from "vitest";
import { applySpecImport, loadProfile } from "./storage";
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
