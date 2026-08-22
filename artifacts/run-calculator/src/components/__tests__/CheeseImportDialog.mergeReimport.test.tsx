import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { CheeseImportCandidate } from "@workspace/cheese-import";
import type { CheeseRecipe } from "@workspace/cheese-recipes";
import type { CheeseImportPrepared } from "@/cheeseImport";
import CheeseImportDialog from "../CheeseImportDialog";

afterEach(() => cleanup());

function recipe(id: string, name: string): CheeseRecipe {
  return {
    id,
    name,
    brand: "Basha's",
    flavors: [],
    shredderSetting: "3",
    cellulose: "",
    notes: "",
    components: [],
  } as unknown as CheeseRecipe;
}

// A re-import after a Manage Lists merge: the survivor's own sheet block is an
// exact update AND the merged-away block carries a learned-alias link onto it.
function makePrepared(): CheeseImportPrepared {
  const survivor: CheeseImportCandidate = {
    recipe: recipe("cheese:survivor", "5 Cheese Mix"),
    status: "update",
  };
  const mergedAway: CheeseImportCandidate = {
    recipe: recipe("cheese:old-blend", "Old Blend"),
    status: "new",
    linkTo: { id: "cheese:survivor", name: "5 Cheese Mix" },
    linkedByAlias: true,
  };
  return {
    recipes: [survivor.recipe, mergedAway.recipe],
    candidates: [survivor, mergedAway],
    summary: { total: 2, added: 1, updated: 1 },
    existingIds: ["cheese:survivor"],
    prepItems: [],
    existingPool: [{ id: "cheese:survivor", name: "5 Cheese Mix", brand: "Basha's" }],
  };
}

function renderDialog(prepared: CheeseImportPrepared) {
  return render(
    <CheeseImportDialog
      open={true}
      onClose={() => {}}
      loading={false}
      error={null}
      prepared={prepared}
      applying={false}
      onConfirm={vi.fn()}
    />,
  );
}

describe("CheeseImportDialog merge re-import guidance", () => {
  it("auto-unchecks the merged-away row and explains why", () => {
    renderDialog(makePrepared());
    const oldRow = screen.getByLabelText("Include Old Blend") as HTMLInputElement;
    const survivorRow = screen.getByLabelText(
      "Include 5 Cheese Mix",
    ) as HTMLInputElement;
    expect(oldRow.checked).toBe(false);
    expect(survivorRow.checked).toBe(true);
    expect(screen.getByTestId("cheese-merged-away-cheese:old-blend")).toBeTruthy();
    // No duplicate-target block, but the surviving row replaces a shared
    // recipe, so acknowledgement is required before Apply becomes available.
    expect(screen.queryByTestId("cheese-duplicate-target-warning")).toBeNull();
    const apply = screen.getByRole("button", { name: /Apply/ });
    expect((apply as HTMLButtonElement).disabled).toBe(true);
    (screen.getByTestId("cheese-import-destructive-confirmation").querySelector("input") as HTMLInputElement).click();
    expect((apply as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the merge hint if the manager re-checks the merged-away row", async () => {
    renderDialog(makePrepared());
    const oldRow = screen.getByLabelText("Include Old Blend") as HTMLInputElement;
    oldRow.click();
    expect(await screen.findByTestId("cheese-duplicate-target-warning")).toBeTruthy();
    expect(screen.getByTestId("cheese-merge-hint")).toBeTruthy();
  });

  it("a heuristic link with an exact-update twin is not treated as merged-away", () => {
    const prepared = makePrepared();
    // Same shape but the link is a heuristic guess, not a learned alias.
    prepared.candidates = prepared.candidates.map((c) =>
      c.linkedByAlias ? { ...c, linkedByAlias: undefined } : c,
    );
    renderDialog(prepared);
    const oldRow = screen.getByLabelText("Include Old Blend") as HTMLInputElement;
    expect(oldRow.checked).toBe(true);
    expect(screen.queryByTestId("cheese-merged-away-cheese:old-blend")).toBeNull();
  });
});
