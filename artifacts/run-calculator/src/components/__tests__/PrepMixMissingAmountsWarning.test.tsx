// @vitest-environment jsdom
//
// Render guard: confirms the amber warning block in the mixes plan view
// appears — and shows the correct text + ingredient list — whenever a
// MixPlanEntry has missingAmounts=true.
//
// The warning JSX lives in PrepMixMissingAmountsWarning.tsx, which is
// imported by home.tsx and rendered inside each prep-mix plan card.
// If the block is accidentally removed or its condition is broken, these
// assertions fail immediately without needing a full running session.
//
// Coverage:
//   1. ALL components missing → "No component amounts" headline
//   2. SOME components missing → "Some components have no amounts" headline
//   3. Missing ingredient names are listed in the detail span
//   4. missingAmounts=false → warning is not rendered at all
//   5. missingAmounts=true with an empty missingComponentIngredients list →
//      headline renders but detail span is absent

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PrepMixMissingAmountsWarning } from "../PrepMixMissingAmountsWarning";
import type { MixPlanEntry } from "@workspace/mixes";

afterEach(cleanup);

type WarningEntry = Pick<
  MixPlanEntry,
  "missingAmounts" | "missingComponentIngredients" | "components"
>;

function makeEntry(overrides: Partial<WarningEntry> = {}): WarningEntry {
  return {
    missingAmounts: false,
    components: [],
    ...overrides,
  };
}

describe("PrepMixMissingAmountsWarning — render guard", () => {
  it("renders nothing when missingAmounts is false", () => {
    const { container } = render(
      <PrepMixMissingAmountsWarning
        entry={makeEntry({ missingAmounts: false })}
      />,
    );
    expect(container.firstChild).toBeNull();
    expect(
      container.querySelector("[data-testid='prep-mix-missing-amounts-warning']"),
    ).toBeNull();
  });

  it("renders the warning block when missingAmounts is true", () => {
    render(
      <PrepMixMissingAmountsWarning
        entry={makeEntry({
          missingAmounts: true,
          missingComponentIngredients: ["Bell Peppers", "Onions"],
          components: [
            { ingredient: "Bell Peppers", lbs: 0 },
            { ingredient: "Onions", lbs: 0 },
          ],
        })}
      />,
    );
    expect(
      screen.getByTestId("prep-mix-missing-amounts-warning"),
    ).toBeTruthy();
  });

  it("shows 'No component amounts' headline when ALL components are missing", () => {
    // missingComponentIngredients.length === components.length → all missing
    render(
      <PrepMixMissingAmountsWarning
        entry={makeEntry({
          missingAmounts: true,
          missingComponentIngredients: ["Bell Peppers", "Onions"],
          components: [
            { ingredient: "Bell Peppers", lbs: 0 },
            { ingredient: "Onions", lbs: 0 },
          ],
        })}
      />,
    );
    expect(
      screen.getByText("No component amounts — pull quantities will be 0"),
    ).toBeTruthy();
  });

  it("shows 'Some components have no amounts' headline when only SOME are missing", () => {
    // missingComponentIngredients.length < components.length → partial
    render(
      <PrepMixMissingAmountsWarning
        entry={makeEntry({
          missingAmounts: true,
          missingComponentIngredients: ["Jalapenos"],
          components: [
            { ingredient: "Pepperoni", lbs: 10 },
            { ingredient: "Jalapenos", lbs: 0 },
          ],
        })}
      />,
    );
    expect(
      screen.getByText(
        "Some components have no amounts — pull quantities may be understated",
      ),
    ).toBeTruthy();
  });

  it("lists the missing ingredient names in the detail span", () => {
    render(
      <PrepMixMissingAmountsWarning
        entry={makeEntry({
          missingAmounts: true,
          missingComponentIngredients: ["Bell Peppers", "Onions"],
          components: [
            { ingredient: "Bell Peppers", lbs: 0 },
            { ingredient: "Onions", lbs: 0 },
          ],
        })}
      />,
    );
    const detail = screen.getByTestId("prep-mix-missing-ingredients-list");
    expect(detail.textContent).toContain("Bell Peppers");
    expect(detail.textContent).toContain("Onions");
    // The detail span also carries an action hint
    expect(detail.textContent).toContain(
      "check that these names exactly match ingredient names",
    );
  });

  it("lists only the unmatched ingredient when the mismatch is partial", () => {
    render(
      <PrepMixMissingAmountsWarning
        entry={makeEntry({
          missingAmounts: true,
          missingComponentIngredients: ["Jalapenos"],
          components: [
            { ingredient: "Pepperoni", lbs: 10 },
            { ingredient: "Jalapenos", lbs: 0 },
          ],
        })}
      />,
    );
    const detail = screen.getByTestId("prep-mix-missing-ingredients-list");
    expect(detail.textContent).toContain("Jalapenos");
    expect(detail.textContent).not.toContain("Pepperoni");
  });

  it("renders headline but no ingredient-list span when missingComponentIngredients is empty", () => {
    // Edge case: missingAmounts=true but the list is empty (0-component mix)
    render(
      <PrepMixMissingAmountsWarning
        entry={makeEntry({
          missingAmounts: true,
          missingComponentIngredients: [],
          components: [],
        })}
      />,
    );
    // Warning block is present
    expect(
      screen.getByTestId("prep-mix-missing-amounts-warning"),
    ).toBeTruthy();
    // Detail span is absent (no ingredient names to list)
    expect(
      screen.queryByTestId("prep-mix-missing-ingredients-list"),
    ).toBeNull();
  });
});
