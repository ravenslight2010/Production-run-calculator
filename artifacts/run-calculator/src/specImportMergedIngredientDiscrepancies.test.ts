// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedSpecImport } from "@workspace/spec-import";
import type { ReconcileRecipe } from "@workspace/spec-reconcile";

const currentRecipes = vi.hoisted(() => ({
  value: [] as ReconcileRecipe[],
}));

vi.mock("./savedSpecSheets", () => ({
  loadCurrentReconcileRecipes: () => currentRecipes.value,
}));

import { buildDiscrepancies } from "./specImport";

const spinachAlias = [
  {
    externalName: "Fresh Spinach (broken up)",
    canonicalName: "Spinach",
  },
] as const;

beforeEach(() => {
  currentRecipes.value = [];
});

describe("buildDiscrepancies — merged ingredient aliases", () => {
  it("treats a current merged-away ingredient as the canonical sheet ingredient", () => {
    currentRecipes.value = [
      {
        kind: "dough",
        name: "House Dough",
        rows: [
          { ingredient: "Fresh Spinach (broken up)", lbs: 4 },
          { ingredient: "Garlic", lbs: 1 },
        ],
      },
    ];
    const parsed: ParsedSpecImport = {
      profiles: [],
      recipes: [
        {
          kind: "dough",
          name: "House Dough",
          rows: [{ ingredient: "Spinach", lbs: 4 }],
        },
      ],
    };

    const discrepancies = buildDiscrepancies(parsed, spinachAlias);

    expect(discrepancies).toEqual([
      expect.objectContaining({
        kind: "dough",
        recipeName: "House Dough",
        type: "extra-ingredient",
        ingredient: "Garlic",
      }),
    ]);
    expect(discrepancies).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ingredient: "Fresh Spinach (broken up)" }),
        expect.objectContaining({ ingredient: "Spinach" }),
      ]),
    );
  });

  it("does not apply ingredient aliases to recipe-name reconciliation", () => {
    currentRecipes.value = [
      {
        kind: "dough",
        name: "Spinach",
        rows: [{ ingredient: "Spinach", lbs: 4 }],
      },
    ];
    const parsed: ParsedSpecImport = {
      profiles: [],
      recipes: [
        {
          kind: "dough",
          name: "Fresh Spinach (broken up)",
          rows: [{ ingredient: "Spinach", lbs: 4 }],
        },
      ],
    };

    expect(buildDiscrepancies(parsed, spinachAlias)).toEqual([
      expect.objectContaining({
        type: "missing-recipe",
        recipeName: "Fresh Spinach (broken up)",
      }),
    ]);
  });
});
