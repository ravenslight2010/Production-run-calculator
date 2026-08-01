// @vitest-environment jsdom
//
// Dialog-level applyRows filter tests for SauceGuideImportDialog and
// DoughGuideImportDialog.
//
// The dialog pre-filters candidates before calling onConfirm: a row with
// brand=null + matchedRecipeName=null (both-unmatched) must be excluded from
// applyRows unless the manager resolves at least one side to a known pool
// name via the review UI.  These tests verify that gate and also that the
// "Neither brand nor recipe was auto-matched" warning renders for the
// affected rows.

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  SauceGuideImportDialog,
  DoughGuideImportDialog,
} from "./components/RecipeGuideImportDialog";
import type {
  SauceGuideImportPrepared,
  DoughGuideImportPrepared,
} from "./recipeGuideImport";

afterEach(cleanup);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSaucePrepared(overrides?: Partial<SauceGuideImportPrepared>): SauceGuideImportPrepared {
  return {
    candidates: [],
    brands: ["Acme", "Bizco"],
    flavorsByBrand: { Acme: ["Classic", "Spicy"], Bizco: [] },
    sauceRecipeNames: ["House Red", "Marinara"],
    ...overrides,
  };
}

function makeDoughPrepared(overrides?: Partial<DoughGuideImportPrepared>): DoughGuideImportPrepared {
  return {
    candidates: [],
    brands: ["Acme", "Bizco"],
    flavorsByBrand: { Acme: ["Classic", "Spicy"], Bizco: [] },
    doughRecipeNames: ["CRB Thin", "CRB Thick"],
    ...overrides,
  };
}

/** Minimal both-unmatched SauceGuideCandidate */
const bothUnmatchedSauce = {
  id: "sauce-0",
  guideBrandName: "UnknownBrand",
  brand: null,
  guideName: "Unknown Sauce",
  matchedRecipeName: null,
  flavors: null,
  ozPerPizza: 3.5,
  sourceLine: "row 1",
} as const;

/** Minimal both-matched SauceGuideCandidate */
const bothMatchedSauce = {
  id: "sauce-1",
  guideBrandName: "Acme",
  brand: "Acme",
  guideName: "House Red",
  matchedRecipeName: "House Red",
  flavors: null,
  ozPerPizza: 4,
  sourceLine: "row 2",
} as const;

/** Minimal both-unmatched DoughGuideCandidate */
const bothUnmatchedDough = {
  id: "dough-0",
  guideBrandName: "UnknownBrand",
  brand: null,
  guideName: "Unknown Dough",
  matchedDoughRecipeName: null,
  flavors: null,
  sourceLine: "row 1",
} as const;

/** Minimal both-matched DoughGuideCandidate */
const bothMatchedDough = {
  id: "dough-1",
  guideBrandName: "Acme",
  brand: "Acme",
  guideName: "CRB Thin",
  matchedDoughRecipeName: "CRB Thin",
  flavors: null,
  sourceLine: "row 2",
} as const;

// ─── SauceGuideImportDialog ───────────────────────────────────────────────────

describe("SauceGuideImportDialog — applyRows filter", () => {
  it("Apply button is disabled when the only candidate is both-unmatched (no brand or recipe picked)", () => {
    render(
      <SauceGuideImportDialog
        open
        onClose={vi.fn()}
        loading={false}
        error={null}
        prepared={makeSaucePrepared({ candidates: [bothUnmatchedSauce] })}
        applying={false}
        onConfirm={vi.fn()}
      />,
    );

    const applyBtn = screen.getByRole("button", { name: /Apply Sauce Assignments/i });
    expect(applyBtn).toBeTruthy();
    expect((applyBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("Apply button remains disabled after picking a brand but leaving recipe as the guide name (unresolved)", async () => {
    const user = userEvent.setup();
    render(
      <SauceGuideImportDialog
        open
        onClose={vi.fn()}
        loading={false}
        error={null}
        prepared={makeSaucePrepared({ candidates: [bothUnmatchedSauce] })}
        applying={false}
        onConfirm={vi.fn()}
      />,
    );

    // Pick a brand so the row enters the selection set
    const brandSelect = screen.getByDisplayValue("— pick brand —");
    await user.selectOptions(brandSelect, "Acme");

    const applyBtn = screen.getByRole("button", { name: /Apply Sauce Assignments/i });
    // Recipe is still "Unknown Sauce" (not in sauceRecipeNames) → still excluded
    expect((applyBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("Apply button becomes enabled once the manager selects a known recipe for a both-unmatched row", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <SauceGuideImportDialog
        open
        onClose={vi.fn()}
        loading={false}
        error={null}
        prepared={makeSaucePrepared({ candidates: [bothUnmatchedSauce] })}
        applying={false}
        onConfirm={onConfirm}
      />,
    );

    // Pick a brand first (adds the row to selected)
    const brandSelect = screen.getByDisplayValue("— pick brand —");
    await user.selectOptions(brandSelect, "Acme");

    // Now pick a known sauce recipe
    const recipeSelect = screen.getByDisplayValue(/Unknown Sauce \(guide name\)/i);
    await user.selectOptions(recipeSelect, "House Red");

    const applyBtn = screen.getByRole("button", { name: /Apply Sauce Assignments/i });
    expect((applyBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it("onConfirm receives the resolved row (not empty) after brand + recipe are picked", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <SauceGuideImportDialog
        open
        onClose={vi.fn()}
        loading={false}
        error={null}
        prepared={makeSaucePrepared({ candidates: [bothUnmatchedSauce] })}
        applying={false}
        onConfirm={onConfirm}
      />,
    );

    const brandSelect = screen.getByDisplayValue("— pick brand —");
    await user.selectOptions(brandSelect, "Acme");
    const recipeSelect = screen.getByDisplayValue(/Unknown Sauce \(guide name\)/i);
    await user.selectOptions(recipeSelect, "House Red");

    const applyBtn = screen.getByRole("button", { name: /Apply Sauce Assignments/i });
    await user.click(applyBtn);

    expect(onConfirm).toHaveBeenCalledOnce();
    const [rows] = onConfirm.mock.calls[0];
    expect(rows).toHaveLength(1);
    expect(rows[0].brand).toBe("Acme");
    expect(rows[0].recipeName).toBe("House Red");
    expect(rows[0].wasNullBrand).toBe(true);
    expect(rows[0].wasNullRecipe).toBe(true);
  });

  it("a fully-matched row is included in applyRows without any manager action", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <SauceGuideImportDialog
        open
        onClose={vi.fn()}
        loading={false}
        error={null}
        prepared={makeSaucePrepared({ candidates: [bothMatchedSauce] })}
        applying={false}
        onConfirm={onConfirm}
      />,
    );

    const applyBtn = screen.getByRole("button", { name: /Apply Sauce Assignments/i });
    expect((applyBtn as HTMLButtonElement).disabled).toBe(false);

    await user.click(applyBtn);
    const [rows] = onConfirm.mock.calls[0];
    expect(rows).toHaveLength(1);
    expect(rows[0].brand).toBe("Acme");
    expect(rows[0].recipeName).toBe("House Red");
  });

  it("counter shows '0 of 1 rows will apply' for a both-unmatched candidate with no selections", () => {
    render(
      <SauceGuideImportDialog
        open
        onClose={vi.fn()}
        loading={false}
        error={null}
        prepared={makeSaucePrepared({ candidates: [bothUnmatchedSauce] })}
        applying={false}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByText(/0 of 1 rows? will apply/i)).toBeTruthy();
  });

  it("renders the 'Neither brand nor sauce recipe was auto-matched' warning for a both-unmatched row once a brand is picked", async () => {
    const user = userEvent.setup();
    render(
      <SauceGuideImportDialog
        open
        onClose={vi.fn()}
        loading={false}
        error={null}
        prepared={makeSaucePrepared({ candidates: [bothUnmatchedSauce] })}
        applying={false}
        onConfirm={vi.fn()}
      />,
    );

    // Warning only shows after a brand is selected (makes the row visible/selected)
    // and the recipe is still unresolved.
    const brandSelect = screen.getByDisplayValue("— pick brand —");
    await user.selectOptions(brandSelect, "Acme");

    expect(
      screen.getByText(/Neither brand nor sauce recipe was auto-matched/i),
    ).toBeTruthy();
  });

  it("warning disappears once a known sauce recipe is selected", async () => {
    const user = userEvent.setup();
    render(
      <SauceGuideImportDialog
        open
        onClose={vi.fn()}
        loading={false}
        error={null}
        prepared={makeSaucePrepared({ candidates: [bothUnmatchedSauce] })}
        applying={false}
        onConfirm={vi.fn()}
      />,
    );

    const brandSelect = screen.getByDisplayValue("— pick brand —");
    await user.selectOptions(brandSelect, "Acme");

    // Verify warning is present before resolving recipe
    expect(screen.getByText(/Neither brand nor sauce recipe was auto-matched/i)).toBeTruthy();

    const recipeSelect = screen.getByDisplayValue(/Unknown Sauce \(guide name\)/i);
    await user.selectOptions(recipeSelect, "House Red");

    // Warning must be gone after recipe is resolved
    expect(screen.queryByText(/Neither brand nor sauce recipe was auto-matched/i)).toBeNull();
  });

  it("does not include the both-unmatched row in onConfirm if Apply is clicked with only matched rows also present", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <SauceGuideImportDialog
        open
        onClose={vi.fn()}
        loading={false}
        error={null}
        prepared={makeSaucePrepared({ candidates: [bothUnmatchedSauce, bothMatchedSauce] })}
        applying={false}
        onConfirm={onConfirm}
      />,
    );

    // Apply is enabled because bothMatchedSauce is ready
    const applyBtn = screen.getByRole("button", { name: /Apply Sauce Assignments/i });
    expect((applyBtn as HTMLButtonElement).disabled).toBe(false);
    await user.click(applyBtn);

    const [rows] = onConfirm.mock.calls[0];
    // Only the matched row passes through; the both-unmatched row is excluded
    expect(rows).toHaveLength(1);
    expect(rows[0].brand).toBe("Acme");
    expect(rows[0].recipeName).toBe("House Red");
  });
});

// ─── DoughGuideImportDialog ───────────────────────────────────────────────────

describe("DoughGuideImportDialog — applyRows filter", () => {
  it("Apply button is disabled when the only candidate is both-unmatched (no brand or recipe picked)", () => {
    render(
      <DoughGuideImportDialog
        open
        onClose={vi.fn()}
        loading={false}
        error={null}
        prepared={makeDoughPrepared({ candidates: [bothUnmatchedDough] })}
        applying={false}
        onConfirm={vi.fn()}
      />,
    );

    const applyBtn = screen.getByRole("button", { name: /Apply Dough Assignments/i });
    expect(applyBtn).toBeTruthy();
    expect((applyBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("Apply button remains disabled after picking a brand but leaving recipe as the guide name (unresolved)", async () => {
    const user = userEvent.setup();
    render(
      <DoughGuideImportDialog
        open
        onClose={vi.fn()}
        loading={false}
        error={null}
        prepared={makeDoughPrepared({ candidates: [bothUnmatchedDough] })}
        applying={false}
        onConfirm={vi.fn()}
      />,
    );

    const brandSelect = screen.getByDisplayValue("— pick brand —");
    await user.selectOptions(brandSelect, "Acme");

    const applyBtn = screen.getByRole("button", { name: /Apply Dough Assignments/i });
    // Recipe still "Unknown Dough" (not in doughRecipeNames) → still excluded
    expect((applyBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("Apply button becomes enabled once the manager selects a known dough recipe for a both-unmatched row", async () => {
    const user = userEvent.setup();
    render(
      <DoughGuideImportDialog
        open
        onClose={vi.fn()}
        loading={false}
        error={null}
        prepared={makeDoughPrepared({ candidates: [bothUnmatchedDough] })}
        applying={false}
        onConfirm={vi.fn()}
      />,
    );

    const brandSelect = screen.getByDisplayValue("— pick brand —");
    await user.selectOptions(brandSelect, "Acme");

    const recipeSelect = screen.getByDisplayValue(/Unknown Dough \(guide name\)/i);
    await user.selectOptions(recipeSelect, "CRB Thin");

    const applyBtn = screen.getByRole("button", { name: /Apply Dough Assignments/i });
    expect((applyBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it("onConfirm receives the resolved row after brand + recipe are picked", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <DoughGuideImportDialog
        open
        onClose={vi.fn()}
        loading={false}
        error={null}
        prepared={makeDoughPrepared({ candidates: [bothUnmatchedDough] })}
        applying={false}
        onConfirm={onConfirm}
      />,
    );

    const brandSelect = screen.getByDisplayValue("— pick brand —");
    await user.selectOptions(brandSelect, "Acme");
    const recipeSelect = screen.getByDisplayValue(/Unknown Dough \(guide name\)/i);
    await user.selectOptions(recipeSelect, "CRB Thin");

    const applyBtn = screen.getByRole("button", { name: /Apply Dough Assignments/i });
    await user.click(applyBtn);

    expect(onConfirm).toHaveBeenCalledOnce();
    const [rows] = onConfirm.mock.calls[0];
    expect(rows).toHaveLength(1);
    expect(rows[0].brand).toBe("Acme");
    expect(rows[0].doughRecipeName).toBe("CRB Thin");
    expect(rows[0].wasNullBrand).toBe(true);
    expect(rows[0].wasNullRecipe).toBe(true);
  });

  it("a fully-matched dough row is included in applyRows without any manager action", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <DoughGuideImportDialog
        open
        onClose={vi.fn()}
        loading={false}
        error={null}
        prepared={makeDoughPrepared({ candidates: [bothMatchedDough] })}
        applying={false}
        onConfirm={onConfirm}
      />,
    );

    const applyBtn = screen.getByRole("button", { name: /Apply Dough Assignments/i });
    expect((applyBtn as HTMLButtonElement).disabled).toBe(false);

    await user.click(applyBtn);
    const [rows] = onConfirm.mock.calls[0];
    expect(rows).toHaveLength(1);
    expect(rows[0].brand).toBe("Acme");
    expect(rows[0].doughRecipeName).toBe("CRB Thin");
  });

  it("renders the 'Neither brand nor dough recipe was auto-matched' warning for a both-unmatched row once a brand is picked", async () => {
    const user = userEvent.setup();
    render(
      <DoughGuideImportDialog
        open
        onClose={vi.fn()}
        loading={false}
        error={null}
        prepared={makeDoughPrepared({ candidates: [bothUnmatchedDough] })}
        applying={false}
        onConfirm={vi.fn()}
      />,
    );

    const brandSelect = screen.getByDisplayValue("— pick brand —");
    await user.selectOptions(brandSelect, "Acme");

    expect(
      screen.getByText(/Neither brand nor dough recipe was auto-matched/i),
    ).toBeTruthy();
  });

  it("warning disappears once a known dough recipe is selected", async () => {
    const user = userEvent.setup();
    render(
      <DoughGuideImportDialog
        open
        onClose={vi.fn()}
        loading={false}
        error={null}
        prepared={makeDoughPrepared({ candidates: [bothUnmatchedDough] })}
        applying={false}
        onConfirm={vi.fn()}
      />,
    );

    const brandSelect = screen.getByDisplayValue("— pick brand —");
    await user.selectOptions(brandSelect, "Acme");

    expect(screen.getByText(/Neither brand nor dough recipe was auto-matched/i)).toBeTruthy();

    const recipeSelect = screen.getByDisplayValue(/Unknown Dough \(guide name\)/i);
    await user.selectOptions(recipeSelect, "CRB Thin");

    expect(screen.queryByText(/Neither brand nor dough recipe was auto-matched/i)).toBeNull();
  });

  it("does not include the both-unmatched row in onConfirm when only the matched dough row is applied", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <DoughGuideImportDialog
        open
        onClose={vi.fn()}
        loading={false}
        error={null}
        prepared={makeDoughPrepared({ candidates: [bothUnmatchedDough, bothMatchedDough] })}
        applying={false}
        onConfirm={onConfirm}
      />,
    );

    const applyBtn = screen.getByRole("button", { name: /Apply Dough Assignments/i });
    expect((applyBtn as HTMLButtonElement).disabled).toBe(false);
    await user.click(applyBtn);

    const [rows] = onConfirm.mock.calls[0];
    expect(rows).toHaveLength(1);
    expect(rows[0].brand).toBe("Acme");
    expect(rows[0].doughRecipeName).toBe("CRB Thin");
  });
});
