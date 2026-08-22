import { describe, expect, it } from "vitest";
import { classifyFormulaChanges } from "./index";

const recipe = (name: string, rows: Array<[string, number]>, kind: "cheese" | "mix" = "cheese", unit: "batch" | "perPizza" = "batch") => ({
  name, kind, unit, rows: rows.map(([ingredient, amount]) => ({ ingredient, amount })),
});

describe("classifyFormulaChanges", () => {
  it("classifies added, removed, and quantity-changed ingredients", () => {
    const result = classifyFormulaChanges(
      [recipe("Blend", [["A", 10], ["B", 5]])],
      [recipe("Blend", [["A", 12], ["C", 2]])],
    );
    expect(result.changes.map((change) => change.type)).toEqual(
      expect.arrayContaining(["quantity-changed", "added", "removed"]),
    );
    expect(result.requiresConfirmation).toBe(true);
  });

  it("recognizes a pure recipe rename without calling it destructive", () => {
    const result = classifyFormulaChanges(
      [recipe("Old Name", [["A", 10]])],
      [recipe("New Name", [["A", 10]])],
    );
    expect(result.changes).toEqual([expect.objectContaining({
      type: "renamed", previousRecipeName: "Old Name", recipeName: "New Name",
    })]);
    expect(result.requiresConfirmation).toBe(false);
  });

  it("requires confirmation when a formula is emptied", () => {
    const result = classifyFormulaChanges(
      [recipe("Blend", [["A", 10]])],
      [recipe("Blend", [])],
    );
    expect(result.changes).toEqual([expect.objectContaining({ type: "removed", ingredient: "A", requiresConfirmation: true })]);
  });

  it("keeps batch and per-pizza formulas independent", () => {
    const result = classifyFormulaChanges(
      [recipe("Same", [["A", 2]], "cheese", "batch")],
      [recipe("Same", [["A", 2]], "mix", "perPizza")],
    );
    expect(result.changes.map((change) => change.type)).toEqual(["removed", "added"]);
  });

  it("marks a 25 percent component change as requiring confirmation", () => {
    const result = classifyFormulaChanges(
      [recipe("Blend", [["A", 8]])],
      [recipe("Blend", [["A", 10]])],
    );
    expect(result.changes[0]?.requiresConfirmation).toBe(true);
  });
});