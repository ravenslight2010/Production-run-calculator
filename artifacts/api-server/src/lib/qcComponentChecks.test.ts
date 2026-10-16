import { describe, expect, it } from "vitest";
import {
  type QcComponentObservation,
  evaluateQcComponents,
  resolveQcExpectedComponents,
} from "./qcComponentChecks";

const completeSettings = () => ({
  doughRecipeName: "House Dough",
  doughRecipe: [
    { ingredient: "Flour", ingredientId: "flour-id", lbs: 10 },
    { ingredient: "Water", lbs: 5 },
  ],
  frontlineRecipeName: "Marinara",
  frontlineRecipe: [{ ingredient: "Tomato", lbs: 3 }],
  app1Type: "cheese",
  app1CheeseRecipeName: "House Cheese",
  app1CheeseRecipe: [{ ingredient: "Mozzarella", lbs: 2 }],
  app2Type: "",
  app2CheeseRecipeName: "",
  app2CheeseRecipe: [],
  app3Type: "",
  app3CheeseRecipeName: "",
  app3CheeseRecipe: [],
  app4Type: "",
  app4CheeseRecipeName: "",
  app4CheeseRecipe: [],
  pep1Type: "Pepperoni",
  pep1TypeB: "",
  pep2Type: "",
  pep2TypeB: "",
});

describe("resolveQcExpectedComponents", () => {
  it("resolves canonical configured identities and applies same-day substitutions", () => {
    const result = resolveQcExpectedComponents(completeSettings(), [
      { id: "swap-flour", ingredient: "Flour", action: "swap", substitute: "Rice Flour" },
      { id: "add-water", ingredient: "Water", action: "add", substitute: "Oil", amount: 0.25 },
      { id: "remove-tomato", ingredient: "Tomato", action: "remove" },
      { id: "swap-pep", ingredient: "Pepperoni", action: "swap", substitute: "Plant Pepperoni" },
    ]);

    expect(result.status).toBe("complete");
    expect(result.components).toEqual([
      { componentId: "dough:0", group: "Dough", name: "Rice Flour" },
      { componentId: "dough:1", group: "Dough", name: "Water" },
      { componentId: "dough:2", group: "Dough", name: "Oil" },
      { componentId: "sauce:product", group: "Frontline (Sauce)", name: "Marinara" },
      { componentId: "app1:0", group: "Applicator 1", name: "Mozzarella" },
      { componentId: "pep1:type", group: "Pepperoni 1", name: "Plant Pepperoni" },
    ]);
  });

  it("uses a named ready-made sauce as the expected identity", () => {
    const settings = completeSettings();
    settings.frontlineRecipe = [];
    const result = resolveQcExpectedComponents(settings, []);
    expect(result.components).toContainEqual({
      componentId: "sauce:product",
      group: "Frontline (Sauce)",
      name: "Marinara",
    });
  });

  it("does not convert missing configuration fields into empty defaults", () => {
    const settings = completeSettings();
    const { app4Type: _missing, ...incomplete } = settings;
    const result = resolveQcExpectedComponents(incomplete, []);
    expect(result.status).toBe("incomplete");
    expect(result.components).toEqual([]);
    expect(result.reason).toMatch(/missing or invalid/i);
  });

  it("keeps a configured recipe with no identifiable rows not evaluated", () => {
    const settings = completeSettings();
    settings.doughRecipe = [];
    const result = resolveQcExpectedComponents(settings, [], "dough");
    expect(result.status).toBe("incomplete");
    expect(result.reason).toMatch(/no component rows/i);
  });

  it("does not pass when no expected components can be resolved", () => {
    const settings = completeSettings();
    settings.doughRecipeName = "";
    settings.doughRecipe = [];
    settings.frontlineRecipeName = "";
    settings.frontlineRecipe = [];
    settings.app1Type = "";
    settings.app1CheeseRecipeName = "";
    settings.app1CheeseRecipe = [];
    settings.pep1Type = "";
    const result = resolveQcExpectedComponents(settings, []);
    expect(result.status).toBe("incomplete");
    expect(result.components).toEqual([]);
  });

  it("rejects malformed substitution data instead of silently ignoring it", () => {
    const result = resolveQcExpectedComponents(completeSettings(), [
      { id: "missing-substitute", ingredient: "Flour", action: "swap" },
    ]);
    expect(result.status).toBe("incomplete");
    expect(result.components).toEqual([]);
    expect(result.reason).toMatch(/substitution list is invalid/i);
  });
});

describe("evaluateQcComponents", () => {
  it("passes only when every expected item is present and identified correctly", () => {
    const resolution = resolveQcExpectedComponents(completeSettings(), []);
    const observations = new Map<string, QcComponentObservation>(
      resolution.components.map((item) => [item.componentId, "present-correct" as const]),
    );
    expect(evaluateQcComponents(resolution, observations).outcome).toBe("pass");
  });

  it("fails when any evaluated item is missing or mismatched", () => {
    const resolution = resolveQcExpectedComponents(completeSettings(), []);
    const observations = new Map<string, QcComponentObservation>(
      resolution.components.map((item) => [item.componentId, "present-correct" as const]),
    );
    observations.set("pep1:type", "present-mismatch");
    expect(evaluateQcComponents(resolution, observations).outcome).toBe("fail");
  });

  it("keeps an incomplete expected list not evaluated even when resolved items pass", () => {
    const settings = completeSettings();
    settings.doughRecipe = [];
    const resolution = resolveQcExpectedComponents(settings, []);
    const observations = new Map(
      resolution.components.map((item) => [item.componentId, "present-correct" as const]),
    );
    expect(evaluateQcComponents(resolution, observations).outcome).toBe("not-evaluated");
  });

  it("returns not evaluated when a required observation is omitted", () => {
    const resolution = resolveQcExpectedComponents(completeSettings(), []);
    const observations = new Map(
      resolution.components.slice(1).map((item) => [item.componentId, "present-correct" as const]),
    );
    expect(evaluateQcComponents(resolution, observations).outcome).toBe("not-evaluated");
  });
});
