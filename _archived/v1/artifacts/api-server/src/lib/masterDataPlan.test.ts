import { describe, expect, it } from "vitest";
import { buildMasterDataPlan, canonicalMasterJson, masterHash, parseMasterDataCommand, planPendingReferences,
  type MasterDataCommand, type MasterDataWorld } from "./masterDataPlan";

function world(): MasterDataWorld {
  return { ingredients: [], doughRecipes: [], sauceRecipes: [], cheeseRecipes: [], mixes: [], profiles: [], templates: [],
    directories: [], dies: [], specAliases: [], mergeAliases: [], mergedAway: [], ingredientWeights: [] };
}
describe("typed reversible master-data plans", () => {
  it("preserves independent brand recipes during global rename and move", () => {
    const before = world();
    before.doughRecipes = [
      { id: "a", name: "Old", brand: "A", flavors: ["Plain"], components: [{ ingredient: "Flour", lbs: 8.25 }], enabled: true },
      { id: "b", name: "Old", brand: "B", flavors: ["Spicy"], components: [{ ingredient: "Flour", lbs: 12 }], enabled: true },
    ];
    const rename = buildMasterDataPlan(before, { action: "rename", category: "dough", sources: ["Old"], target: "New" }, "rename-brands");
    expect(rename.after.doughRecipes.map((row) => [row.id, row.name, row.enabled, row.components[0].lbs])).toEqual([
      ["a", "New", true, 8.25], ["b", "New", true, 12],
    ]);
    const move = buildMasterDataPlan(before, { action: "move", category: "dough", sources: ["Old"], destination: "sauce" }, "move-brands");
    expect(move.after.sauceRecipes.map((row) => [row.brand, row.flavors, row.components[0].lbs])).toEqual([
      ["A", ["Plain"], 8.25], ["B", ["Spicy"], 12],
    ]);
  });
  it("matches ingredient references by canonical identity, refusing contradictory labels", () => {
    const before = world();
    before.ingredients = [{ id: "old", name: "Old", categories: ["dough"], enabled: true }];
    before.doughRecipes = [{ id: "d", name: "Dough", enabled: true, components: [{ ingredientId: "old", ingredient: "Stale label", lbs: 8.25 }] }];
    const result = buildMasterDataPlan(before, { action: "rename", category: "ingredient", sources: ["Old"], target: "New" }, "identity-reference");
    expect(result.after.doughRecipes[0].components[0]).toEqual({ ingredientId: "old", ingredient: "New", lbs: 8.25 });
    before.doughRecipes[0].components = [{ ingredientId: "another", ingredient: "Old", lbs: 8.25 }];
    expect(() => buildMasterDataPlan(before, { action: "rename", category: "ingredient", sources: ["Old"], target: "New" }, "ambiguous-reference"))
      .toThrow(/identity disagree/iu);
  });
  it("hashes canonical object keys independent of insertion order, without flattening arrays or locale-specific names", () => {
    expect(masterHash({ é: "café", A: [1, 2], 中: { z: 3, a: null } })).toBe(masterHash({ 中: { a: null, z: 3 }, A: [1, 2], é: "café" }));
    expect(masterHash([1, 2])).not.toBe(masterHash([2, 1]));
    expect(canonicalMasterJson({ missing: undefined })).not.toBe(canonicalMasterJson({}));
  });
  it.each(["brand", "flavor", "applicator", "pep", "die", "ingredient", "doughIngredient", "sauceIngredient",
    "cheeseIngredient", "mixIngredient", "dough", "sauce", "cheese", "mix"] as const)("builds a bounded server-owned %s add without mutating its input", (category) => {
    const before = world(); before.directories.push({ key: "run-calc-brands", value: ["Acme"] });
    const copy = JSON.stringify(before);
    const command = parseMasterDataCommand({ action: "add", category, sources: ["New name"], ...(category === "flavor" ? { brand: "Acme" } : {}) });
    const result = buildMasterDataPlan(before, command, "stable-operation-01");
    expect(JSON.stringify(before)).toBe(copy);
    expect(JSON.stringify(result.after)).toContain("New name");
  });
  it("unions categories while preserving the promoted source identity, native row weights and target weight precedence", () => {
    const before = world();
    before.ingredients = [{ id: "old", name: "Old Flour", enabled: true, categories: ["dough"] }];
    before.doughRecipes = [{ id: "dough", name: "Plain", enabled: true, components: [{ ingredient: "Old Flour", lbs: 8.25 }] }];
    before.directories = [{ key: "run-calc-dough-ingredients", value: ["Old Flour"] }, { key: "run-calc-cheese-ingredients", value: ["Old Flour"] }];
    before.ingredientWeights = [{ id: 1, name: "Old Flour", lbsPerBatch: 10 }, { id: 2, name: "New Flour", lbsPerBatch: 20 }];
    const plan = buildMasterDataPlan(before, { action: "merge", category: "ingredient", sources: ["Old Flour"], target: "New Flour" }, "merge-stable-01");
    expect(plan.after.ingredients[0]).toMatchObject({ id: "old", name: "New Flour", enabled: true });
    expect(plan.after.doughRecipes[0].components[0]).toMatchObject({ ingredient: "New Flour", lbs: 8.25 });
    expect(plan.after.ingredientWeights).toEqual([{ id: 2, name: "New Flour", lbsPerBatch: 20 }]);
    expect(plan.after.directories.find((row) => row.key === "run-calc-cheese-ingredients")?.value).toEqual(["New Flour"]);
  });
  it("preserves target-owned profile fields, and never normalizes an unrelated legacy profile key", () => {
    const before = world();
    before.directories.push({ key: "run-calc-brands", value: ["Source", "Target", "Other"] });
    before.profiles = [
      { key: "source__plain", brand: "Source", flavor: "Plain", values: { speed: 1 }, crustValues: {} },
      { key: "target__plain", brand: "Target", flavor: "Plain", values: { speed: 9 }, crustValues: {} },
      { key: "legacy-unrelated-key", brand: "Other", flavor: "Plain", values: { speed: 2 }, crustValues: {} },
    ];
    const plan = buildMasterDataPlan(before, { action: "merge", category: "brand", sources: ["Source"], target: "Target" }, "profile-merge-01");
    expect(plan.after.profiles.find((row) => row.key === "target__plain")?.values.speed).toBe(9);
    expect(plan.after.profiles.find((row) => row.brand === "Other")?.key).toBe("legacy-unrelated-key");
  });
  it("keeps same-named Cheese and Mix references separate by station type", () => {
    const before = world(); before.cheeseRecipes = [{ id: "cheese", name: "Shared", enabled: true, components: [] }];
    const plan = buildMasterDataPlan(before, { action: "rename", category: "cheese", sources: ["Shared"], target: "Cheese target" }, "typed-slot-01");
    const values = plan.rewriteValues({ app1Type: "cheese", app1CheeseRecipeName: "Shared", app2Type: "Mix", app2CheeseRecipeName: "Shared", cases: 20 });
    expect(values).toMatchObject({ app1CheeseRecipeName: "Cheese target", app2CheeseRecipeName: "Shared", cases: 20 });
    expect(() => plan.rewriteValues({ app1CheeseRecipeName: "Shared" })).toThrow(/unambiguous/);
  });
  it("never treats a non-empty mix as batch pounds during a cross-unit move", () => {
    const before = world(); before.mixes = [{ id: "mix", name: "Topping", enabled: true, components: [{ ingredient: "Corn", lbs: 2 }] }];
    expect(() => buildMasterDataPlan(before, { action: "move", category: "mix", sources: ["Topping"], destination: "sauce" }, "units-move-01")).toThrow(/units/);
  });
  it("moves pounds recipes without changing their native component amounts", () => {
    const before = world(); before.doughRecipes = [{ id: "recipe", name: "Batch", enabled: true, components: [{ ingredient: "Flour", lbs: 12.5 }] }];
    const plan = buildMasterDataPlan(before, { action: "move", category: "dough", sources: ["Batch"], destination: "sauce" }, "move-recipe-01");
    expect(plan.after.doughRecipes[0].enabled).toBe(false);
    expect(plan.after.sauceRecipes[0].components).toEqual(before.doughRecipes[0].components);
    expect(plan.rewriteValues({ doughRecipeName: "Batch", doughBatches: 9 })).toEqual({ doughRecipeName: "", doughBatches: 9 });
  });
  it("captures only pending setup references and distinguishes absence from explicit null", () => {
    const before = world(); before.directories = [{ key: "run-calc-brands", value: ["Acme"] }];
    const plan = buildMasterDataPlan(before, { action: "remove", category: "brand", sources: ["Acme"] }, "pending-only-01");
    const result = planPendingReferences([{ date: "2026-10-23", data: { dayState: { runs: [
      { id: "pending", brand: "Acme", flavor: null }, { id: "started", brand: "Acme", startedAt: 1 }, { id: "finished", brand: "Acme", endedAt: 2 },
    ] }, runValues: { pending: { totalCases: 20, doughBatches: 8 }, started: { totalCases: 99 } } } }], plan);
    expect(result.protectedDependency).toBe(true);
    expect(result.references.every((ref) => ref.runId === "pending" && ref.section === "meta")).toBe(true);
    expect(result.references.find((ref) => ref.field === "flavor")).toMatchObject({ before: null, beforeExists: true, after: "" });
  });
  it.each([
    { action: "rename", category: "brand", sources: ["\n"], target: "B" },
    { action: "rename", category: "brand", sources: ["A"], target: "B", before: {} },
    { action: "remove", category: "die", sources: ["A"], target: "B" },
    { action: "move", category: "brand", sources: ["A"], destination: "mix" },
    { action: "add", category: "flavor", sources: ["Plain"] },
  ])("rejects unsupported or secret-bearing intent %j", (input) => {
    expect(() => parseMasterDataCommand(input)).toThrow();
  });
  it.each(["none", "N/A", "Cheese", "Mix"])("protects reserved applicator classification %s", (name) => {
    const command: MasterDataCommand = { action: "rename", category: "applicator", sources: [name], target: "Other" };
    expect(() => buildMasterDataPlan(world(), command, "reserved-name-01")).toThrow(/reserved/);
  });
});
