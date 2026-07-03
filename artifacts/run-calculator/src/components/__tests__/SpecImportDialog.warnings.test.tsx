import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import type {
  ParsedProfile,
  ParsedSpecImport,
  SpecImportWarning,
} from "@workspace/spec-import";
import type { SpecImportPrepared } from "@/specImport";
import SpecImportDialog from "../SpecImportDialog";

// Keep the test focused on the dialog's UI wiring: the discrepancy diff and the
// profile/recipe existence lookups pull in the whole import/storage stack and
// are covered by their own tests.
vi.mock("@/specImport", () => ({
  buildDiscrepancies: () => [],
}));
vi.mock("@/storage", () => ({
  profileExistsForImport: () => false,
  recipeExistsForImport: () => false,
}));

afterEach(() => cleanup());

function profile(brand: string, flavor: string): ParsedProfile {
  return { brand, flavor };
}

// Minimal real-shape SpecImportPrepared carrying only what this screen reads.
function makePrepared(
  profiles: ParsedProfile[],
  warnings?: SpecImportWarning[],
): SpecImportPrepared {
  const parsed: ParsedSpecImport = { profiles, recipes: [] };
  if (warnings?.length) parsed.warnings = warnings;
  return {
    parsed,
    summary: {
      profilesNew: profiles.length,
      profilesUpdated: 0,
      recipesNew: 0,
      recipesUpdated: 0,
      totalProfiles: profiles.length,
      totalRecipes: 0,
    },
    newAliases: [],
    flagged: [],
    discrepancies: [],
    skipped: { profiles: [], recipes: [] },
    brands: [],
    flavorsByBrand: {},
  };
}

function renderDialog(prepared: SpecImportPrepared) {
  return render(
    <SpecImportDialog
      open={true}
      onClose={() => {}}
      loading={false}
      error={null}
      prepared={prepared}
      applying={false}
      onConfirm={() => {}}
    />,
  );
}

describe("SpecImportDialog flavor-correction warnings", () => {
  it("renders the top-level amber callout and attaches the per-row callout to the matching profile", () => {
    const prepared = makePrepared(
      [profile("Tombstone", "Pepperoni"), profile("DiGiorno", "Four Cheese")],
      [
        {
          brand: "Tombstone",
          flavor: "Pepperoni",
          message: 'Flavor "Pepperonni" was corrected to "Pepperoni".',
        },
      ],
    );
    renderDialog(prepared);

    // Top-level callout with the count summary.
    const callout = screen.getByTestId("spec-import-warnings");
    expect(
      within(callout).getByText("1 item was corrected or flagged"),
    ).toBeTruthy();

    // Per-row callout is attached to the Tombstone row (first kept profile = pk0)
    // and carries the warning message.
    const row0 = screen.getByTestId("spec-profile-pk0");
    const rowWarning = within(row0).getByTestId("spec-profile-warning-pk0");
    expect(
      within(rowWarning).getByText(
        'Flavor "Pepperonni" was corrected to "Pepperoni".',
      ),
    ).toBeTruthy();

    // The unrelated DiGiorno row must NOT get a callout.
    expect(screen.queryByTestId("spec-profile-warning-pk1")).toBeNull();

    // The matched warning must not ALSO be listed in the top-level callout
    // (that list is reserved for unmatched warnings).
    expect(
      within(callout).queryByText(
        'Flavor "Pepperonni" was corrected to "Pepperoni".',
      ),
    ).toBeNull();
  });

  it("matches warnings to rows case-insensitively with trimming", () => {
    const prepared = makePrepared(
      [profile("Tombstone", "Pepperoni")],
      [
        {
          brand: "  tombstone ",
          flavor: "PEPPERONI",
          message: "Check this flavor name.",
        },
      ],
    );
    renderDialog(prepared);

    const rowWarning = screen.getByTestId("spec-profile-warning-pk0");
    expect(within(rowWarning).getByText("Check this flavor name.")).toBeTruthy();
  });

  it("surfaces warnings with no matching profile row in the top-level callout instead of hiding them", () => {
    const prepared = makePrepared(
      [profile("Tombstone", "Pepperoni")],
      [
        {
          brand: "Red Baron",
          flavor: "Supreme",
          message: 'Flavor "Suprême" did not match any product on the sheet.',
        },
      ],
    );
    renderDialog(prepared);

    // No profile row matches, so no per-row callout anywhere.
    expect(screen.queryByTestId("spec-profile-warning-pk0")).toBeNull();

    // The unmatched warning's message is listed inside the top-level callout.
    const callout = screen.getByTestId("spec-import-warnings");
    expect(
      within(callout).getByText(
        'Flavor "Suprême" did not match any product on the sheet.',
      ),
    ).toBeTruthy();
  });

  it("attaches multiple warnings for the same profile to one per-row callout", () => {
    const prepared = makePrepared(
      [profile("Tombstone", "Pepperoni")],
      [
        { brand: "Tombstone", flavor: "Pepperoni", message: "First warning." },
        { brand: "Tombstone", flavor: "Pepperoni", message: "Second warning." },
      ],
    );
    renderDialog(prepared);

    expect(
      within(screen.getByTestId("spec-import-warnings")).getByText(
        "2 items were corrected or flagged",
      ),
    ).toBeTruthy();

    const rowWarning = screen.getByTestId("spec-profile-warning-pk0");
    expect(within(rowWarning).getByText("First warning.")).toBeTruthy();
    expect(within(rowWarning).getByText("Second warning.")).toBeTruthy();
  });

  it("renders no warning callouts when the parse result carries no warnings", () => {
    renderDialog(makePrepared([profile("Tombstone", "Pepperoni")]));

    expect(screen.queryByTestId("spec-import-warnings")).toBeNull();
    expect(screen.queryByTestId("spec-profile-warning-pk0")).toBeNull();
  });
});
