import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import type { PremixCandidate } from "@workspace/premix-import";
import type { Mix } from "@workspace/mixes";
import type { PremixImportPrepared } from "@/premixImport";
import PremixImportDialog from "../PremixImportDialog";

afterEach(() => cleanup());

function mix(id: string, name: string): Mix {
  return {
    id,
    name,
    brand: "Basha's",
    flavor: "Deluxe",
    batchSize: 100,
    daysEarly: 0,
    components: [],
  } as unknown as Mix;
}

function candidate(id: string, name: string, status: "new" | "update"): PremixCandidate {
  return { mix: mix(id, name), status };
}

// A re-import after a Manage Lists merge: the survivor's own sheet block is an
// exact update AND the merged-away block carries a learned-alias redirect
// suggestion onto the survivor.
function makePrepared(): PremixImportPrepared {
  const survivor = candidate("mix:survivor", "5 Cheese Mix", "update");
  const mergedAway = candidate("mix:old-blend", "Old Blend", "new");
  return {
    mixes: [survivor.mix, mergedAway.mix],
    candidates: [survivor, mergedAway],
    summary: { total: 2, created: 1, updated: 1 },
    newAliases: [],
    brands: ["Basha's"],
    flavorsByBrand: { "Basha's": ["Deluxe"] },
    existingIds: ["mix:survivor"],
    existingMixes: [
      { id: "mix:survivor", name: "5 Cheese Mix", brand: "Basha's", flavor: "Deluxe" },
    ],
    redirectSuggestions: { "mix:old-blend": "mix:survivor" },
    freezerPulls: {},
    prepItems: [],
  };
}

function renderDialog(prepared: PremixImportPrepared) {
  return render(
    <PremixImportDialog
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

describe("PremixImportDialog merge re-import guidance", () => {
  it("auto-unchecks the merged-away row and explains why", () => {
    renderDialog(makePrepared());
    // Merged-away row starts unchecked; survivor stays checked. (The redirect
    // renames the merged-away row to the survivor's name, so select rows by
    // their stable key.)
    const oldRow = within(screen.getByTestId("premix-candidate-mix:old-blend")).getByRole(
      "checkbox",
      { name: /Include/ },
    ) as HTMLInputElement;
    const survivorRow = within(
      screen.getByTestId("premix-candidate-mix:survivor"),
    ).getByRole("checkbox", { name: /Include/ }) as HTMLInputElement;
    expect(oldRow.checked).toBe(false);
    expect(survivorRow.checked).toBe(true);
    // Plain-language note on the merged-away row.
    expect(screen.getByTestId("premix-merged-away-mix:old-blend")).toBeTruthy();
    // No duplicate-target block, so Apply is available immediately.
    expect(screen.queryByTestId("premix-duplicate-target-warning")).toBeNull();
    const apply = screen.getByRole("button", { name: /Apply/ });
    expect((apply as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the merge hint if the manager re-checks the merged-away row", async () => {
    renderDialog(makePrepared());
    const oldRow = within(screen.getByTestId("premix-candidate-mix:old-blend")).getByRole(
      "checkbox",
      { name: /Include/ },
    ) as HTMLInputElement;
    oldRow.click();
    expect(await screen.findByTestId("premix-duplicate-target-warning")).toBeTruthy();
    expect(screen.getByTestId("premix-merge-hint")).toBeTruthy();
  });

  it("an ordinary redirect suggestion (no exact-update twin) stays checked", () => {
    const prepared = makePrepared();
    // Remove the survivor's own sheet block: the alias redirect still applies
    // but there is no merge collision, so the row stays checked.
    prepared.candidates = prepared.candidates.filter((c) => c.mix.id !== "mix:survivor");
    prepared.mixes = prepared.mixes.filter((m) => m.id !== "mix:survivor");
    prepared.summary = { total: 1, created: 1, updated: 0 };
    renderDialog(prepared);
    const oldRow = within(screen.getByTestId("premix-candidate-mix:old-blend")).getByRole(
      "checkbox",
      { name: /Include/ },
    ) as HTMLInputElement;
    expect(oldRow.checked).toBe(true);
    expect(screen.queryByTestId("premix-merged-away-mix:old-blend")).toBeNull();
  });
});
