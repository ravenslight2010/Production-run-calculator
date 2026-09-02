import { describe, expect, it } from "vitest";
import {
  planIngredientDuplicateMerges,
  type IngredientDuplicateHealRow,
} from "./ingredientDuplicateHeal";

function row(
  id: string,
  overrides: Partial<IngredientDuplicateHealRow> = {},
): IngredientDuplicateHealRow {
  return {
    id,
    scope: "live",
    name: "Sheep Romano",
    categories: ["cheese"],
    mergedInto: null,
    enabled: true,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("planIngredientDuplicateMerges", () => {
  it("keeps the oldest active row and unions duplicate categories", () => {
    const plans = planIngredientDuplicateMerges([
      row("newer", {
        name: " SHEEP ROMANO ",
        categories: ["frontline"],
        createdAt: new Date("2026-08-02T00:00:00.000Z"),
      }),
      row("oldest"),
    ]);

    expect(plans).toEqual([
      {
        scope: "live",
        canonicalId: "oldest",
        duplicateIds: ["newer"],
        categories: ["cheese", "frontline"],
      },
    ]);
  });

  it("isolates scopes and ignores disabled or already-merged rows", () => {
    const plans = planIngredientDuplicateMerges([
      row("live-a"),
      row("live-b"),
      row("sandbox-a", { scope: "sandbox:user-1" }),
      row("disabled", { enabled: false }),
      row("merged", { mergedInto: "live-a", enabled: false }),
    ]);

    expect(plans).toHaveLength(1);
    expect(plans[0]?.canonicalId).toBe("live-a");
    expect(plans[0]?.duplicateIds).toEqual(["live-b"]);
  });

  it("uses the lexicographically smaller id when timestamps tie", () => {
    const plans = planIngredientDuplicateMerges([row("z-id"), row("a-id")]);

    expect(plans[0]?.canonicalId).toBe("a-id");
    expect(plans[0]?.duplicateIds).toEqual(["z-id"]);
  });
});
