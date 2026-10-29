import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type {
  ParsedProfile,
  ParsedRecipe,
  ParsedSpecImport,
  SpecImportAlias,
} from "@workspace/spec-import";
import type { SpecImportPrepared } from "@/specImport";
import SpecImportDialog from "../SpecImportDialog";

// Focus: the two-step wizard (step 1 = confirm brand/flavor + include; step 2 =
// recipes, die types, diff) and its deterministic re-target on Back → edit → Next.
vi.mock("@/specImport", () => ({
  buildDiscrepancies: () => [],
  importReviewSignature: () => "review-signature",
}));
vi.mock("@/storage", () => ({
  profileExistsForImport: () => false,
  recipeExistsForImport: () => false,
  // Offer the die as an existing option so the step-2 die selector always renders
  // (even when a row's die is empty), letting the test read its value directly.
  existingDieTypesForImport: () => ["D1"],
  specImportRecipeDisplayKind: (r: ParsedRecipe, serverMixNames: string[] = []) => {
    const name = (r.name ?? "").trim().toLowerCase();
    if (r.kind === "cheese" && serverMixNames.some((mix) => mix.trim().toLowerCase() === name)) {
      return "mix";
    }
    return r.kind;
  },
}));

afterEach(() => cleanup());

function makePrepared(
  profiles: ParsedProfile[],
  recipes: ParsedRecipe[] = [],
): SpecImportPrepared {
  const parsed: ParsedSpecImport = { profiles, recipes };
  return {
    parsed,
    summary: {
      profilesNew: profiles.length,
      profilesUpdated: 0,
      recipesNew: recipes.length,
      recipesUpdated: 0,
      totalProfiles: profiles.length,
      totalRecipes: recipes.length,
    },
    newAliases: [],
    flagged: [],
    discrepancies: [],
    importReview: {
      changes: [],
      counts: {
        added: 0,
        removed: 0,
        "quantity-changed": 0,
        "formula-cleared": 0,
        "family-collapsed": 0,
        "variant-loss": 0,
        "customer-remapped": 0,
      },
      requiresExplicitConfirmation: false,
      confirmationReasons: [],
    },
    skipped: { profiles: [], recipes: [] },
    brands: [],
    flavorsByBrand: {},
  };
}

function renderDialog(
  prepared: SpecImportPrepared,
  onConfirm: (p: ParsedSpecImport, learnedRenames: SpecImportAlias[]) => void = () => {},
  ai: { allowed?: boolean; retryAvailable?: boolean; onRetry?: () => void } = {},
  existingRecipeNamesByKind: { dough: string[]; sauce: string[]; cheese: string[]; mix: string[] } = {
    dough: [],
    sauce: [],
    cheese: [],
    mix: [],
  },
  recovery: {
    reviewNotice?: string;
    retryPending?: boolean;
    retryBlocked?: boolean;
    retryingPending?: boolean;
    onRetryPending?: () => void;
  } = {},
  goldCaptureEnabled = false,
) {
  return render(
    <SpecImportDialog
      open={true}
      onClose={() => {}}
      loading={false}
      error={null}
      prepared={prepared}
      applying={false}
      reviewNotice={recovery.reviewNotice}
      retryPending={recovery.retryPending}
      retryBlocked={recovery.retryBlocked}
      retryingPending={recovery.retryingPending}
      onRetryPending={recovery.onRetryPending}
      canUseAiTools={ai.allowed ?? false}
      aiRetryAvailable={ai.retryAvailable ?? false}
      onUseAiFallback={ai.onRetry ?? (() => {})}
      existingRecipeNamesByKind={existingRecipeNamesByKind}
      goldCaptureEnabled={goldCaptureEnabled}
      onConfirm={onConfirm}
    />,
  );
}

describe("SpecImportDialog two-step wizard", () => {
  it("preserves edits but clears confirmation for a refreshed comparison, and resets for a new parse", () => {
    const prepared = makePrepared(
      [{ brand: "Original Bakery", flavor: "Original Flavor", applicators: [], pepperonis: [] }],
      [{ kind: "dough", name: "Original Dough", rows: [{ ingredient: "Flour", lbs: 10 }] }],
    );
    prepared.importReview!.requiresExplicitConfirmation = true;
    prepared.importReview!.counts.removed = 1;
    prepared.importReview!.changes = [{
      kind: "removed",
      entity: 'dough "Original Dough"',
      message: 'Removes "Sugar" from the existing dough.',
      requiresConfirmation: true,
    }];
    const onConfirm = vi.fn();
    const props = {
      onClose: () => {},
      loading: false,
      error: null,
      applying: false,
      onConfirm,
      onUseAiFallback: () => {},
      existingRecipeNamesByKind: { dough: [], sauce: [], cheese: [], mix: [] },
    };
    const view = render(<SpecImportDialog open={true} {...props} prepared={prepared} />);
    fireEvent.change(screen.getByPlaceholderText("Brand"), { target: { value: "Reviewed Bakery" } });
    fireEvent.change(screen.getByPlaceholderText("Flavor"), { target: { value: "Reviewed Flavor" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByTestId("spec-recipe-name-rk0"), { target: { value: "Reviewed Dough" } });
    fireEvent.click(screen.getByTestId("spec-import-destructive-confirmation"));

    const refreshed = {
      ...prepared,
      importReview: {
        ...prepared.importReview!,
        confirmationReasons: ["The server comparison was refreshed."],
      },
    };
    view.rerender(<SpecImportDialog open={true} {...props} prepared={refreshed} />);
    expect((screen.getByTestId("spec-recipe-name-rk0") as HTMLInputElement).value).toBe("Reviewed Dough");
    expect((screen.getByTestId("spec-import-destructive-confirmation") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("button", { name: /Apply 2 items/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("spec-import-destructive-confirmation"));
    fireEvent.click(screen.getByRole("button", { name: /Apply 2 items/ }));
    expect(onConfirm.mock.calls[0]?.[0]).toMatchObject({
      profiles: [{ brand: "Reviewed Bakery", flavor: "Reviewed Flavor" }],
      recipes: [{ name: "Reviewed Dough" }],
    });

    const nextSource = makePrepared(
      [{ brand: "Different Source", flavor: "New Flavor", applicators: [], pepperonis: [] }],
      [{ kind: "dough", name: "Different Dough", rows: [{ ingredient: "Flour", lbs: 20 }] }],
    );
    view.rerender(<SpecImportDialog open={true} {...props} prepared={nextSource} />);
    expect((screen.getByPlaceholderText("Brand") as HTMLInputElement).value).toBe("Different Source");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect((screen.getByTestId("spec-recipe-name-rk0") as HTMLInputElement).value).toBe("Different Dough");
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("keeps an ambiguous changed review locked and offers an exact retry", () => {
    const retry = vi.fn();
    const { container } = renderDialog(
      makePrepared([{ brand: "Mauro's Pinsa", flavor: "Italian Beef" }]),
      () => {},
      {},
      undefined,
      {
        reviewNotice: "The server did not confirm the earlier save.",
        retryPending: true,
        retryBlocked: true,
        onRetryPending: retry,
      },
    );

    expect(screen.getByTestId("spec-import-review-notice").textContent)
      .toContain("did not confirm");
    expect(container.querySelector("fieldset")?.disabled).toBe(true);
    fireEvent.click(screen.getByText("Next"));
    expect((screen.getByText("Retry same save").closest("button") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByText("Retry exact save"));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("shows a server-known one-row Mix in the Mix category during review", () => {
    const name = "Bobo's Deluxe Meat Mix";
    const prepared = makePrepared(
      [{ brand: "Bobo's", flavor: "Deluxe", applicators: [], pepperonis: [] }],
      [{ kind: "cheese", name, rows: [{ ingredient: "Red Onion", lbs: 1 }] }],
    );
    renderDialog(prepared, () => {}, {}, {
      dough: [],
      sauce: [],
      cheese: [],
      mix: [name],
    });

    fireEvent.click(screen.getByText("Next"));

    expect((screen.getByTestId("spec-recipe-kind-rk0") as HTMLSelectElement).value).toBe("mix");
  });

  it("shows unresolved guidance without offering AI to users who lack permission", () => {
    const prepared = makePrepared([]);
    prepared.unresolved = [{ source: "Native OZ", values: ["A product"] }] as never;
    prepared.note = "Automatic AI interpretation did not complete.";
    renderDialog(prepared);

    expect(screen.getByText("Automatic AI interpretation did not complete.")).toBeTruthy();
    expect(screen.getByTestId("spec-import-unresolved").textContent)
      .toContain("Ask an authorized manager for use-ai-tools access");
    expect(screen.getByTestId("spec-import-empty-review").textContent)
      .toContain("incomplete review");
    expect(screen.queryByText("Retry AI interpretation")).toBeNull();
    expect((screen.getByText("Next").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers only the bounded retry action when AI permission is present", () => {
    const prepared = makePrepared([]);
    prepared.unresolved = [{ source: "Native OZ", values: ["A product"] }] as never;
    const retry = vi.fn();
    renderDialog(prepared, () => {}, { allowed: true, retryAvailable: true, onRetry: retry });

    fireEvent.click(screen.getByText("Retry AI interpretation"));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Use AI for/)).toBeNull();
  });

  it("does not offer retries for unsupported workbooks or authorization rejection", () => {
    const unsupported = makePrepared([]);
    unsupported.unresolved = [{ source: "Shipping", values: ["PIZZA/BOX"] }] as never;
    unsupported.aiFallbackUnsupported = true;
    const { unmount } = renderDialog(unsupported, () => {}, {
      allowed: true,
      retryAvailable: true,
    });
    expect(screen.getByTestId("spec-import-unresolved").textContent)
      .toContain("dedicated importer");
    expect(screen.queryByText("Retry AI interpretation")).toBeNull();

    unmount();
    const denied = makePrepared([]);
    denied.unresolved = [{ source: "Native OZ", values: ["A product"] }] as never;
    denied.aiRetryBlocked = true;
    renderDialog(denied, () => {}, { allowed: true, retryAvailable: true });
    expect(screen.getByTestId("spec-import-unresolved").textContent)
      .toContain("authorization");
    expect(screen.queryByText("Retry AI interpretation")).toBeNull();
  });

  it("requires explicit acknowledgement for a single destructive formula removal", () => {
    const prepared = makePrepared([{ brand: "A", flavor: "X" }]);
    prepared.importReview = {
      ...prepared.importReview,
      changes: [{
        kind: "removed",
        entity: 'dough "Standard"',
        message: 'Removes "Sugar" from dough "Standard".',
        requiresConfirmation: true,
      }],
      counts: { ...prepared.importReview.counts, removed: 1 },
      requiresExplicitConfirmation: true,
      confirmationReasons: ['Removes "Sugar" from dough "Standard".'],
    };
    const onConfirm = vi.fn();
    renderDialog(prepared, onConfirm);
    fireEvent.click(screen.getByText("Next"));

    const apply = screen.getByText(/^Apply/).closest("button") as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    fireEvent.click(screen.getByTestId("spec-import-destructive-confirmation"));
    expect(apply.disabled).toBe(false);
    fireEvent.click(apply);
    expect(onConfirm).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything(), true, "review-signature", false,
    );
  });

  it("shows only product name confirmation in step 1, hiding recipes and the diff", () => {
    const recipe: ParsedRecipe = {
      kind: "dough",
      name: "Sheet Dough",
      brand: "A",
      flavor: "X",
      rows: [{ ingredient: "Flour", lbs: 40 }],
    };
    renderDialog(makePrepared([{ brand: "A", flavor: "X" }], [recipe]));

    // Step 1: product brand/flavor editors are present, recipes are not.
    expect(screen.getByTestId("spec-profile-brand-pk0")).toBeTruthy();
    expect(screen.queryByTestId("spec-recipe-name-rk0")).toBeNull();
    expect(screen.getByText("Next")).toBeTruthy();
    expect(screen.queryByText(/^Apply/)).toBeNull();

    // Step 2: recipes appear, product name editors are gone.
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByTestId("spec-recipe-name-rk0")).toBeTruthy();
    expect(screen.queryByTestId("spec-profile-brand-pk0")).toBeNull();
    expect(screen.getByText(/^Apply/)).toBeTruthy();
    expect(screen.getByText("Back")).toBeTruthy();
  });

  it("blocks Next until every checked product has a brand and a flavor", () => {
    renderDialog(makePrepared([{ brand: "A", flavor: "" }]));

    const next = screen.getByText("Next").closest("button") as HTMLButtonElement;
    expect(next.disabled).toBe(true);

    fireEvent.change(screen.getByTestId("spec-profile-flavor-pk0"), {
      target: { value: "X" },
    });
    expect(next.disabled).toBe(false);
  });

  it("cross-fills a blank die from a same-brand sibling on step 2", () => {
    renderDialog(
      makePrepared([
        { brand: "A", flavor: "X", dieType: "D1" },
        { brand: "A", flavor: "Y" },
      ]),
    );
    fireEvent.click(screen.getByText("Next"));

    // Both included rows show the die selector; the blank one inherited D1.
    expect((screen.getByTestId("spec-profile-die-pk0") as HTMLSelectElement).value).toBe("D1");
    expect((screen.getByTestId("spec-profile-die-pk1") as HTMLSelectElement).value).toBe("D1");
  });

  it("re-derives cross-fill on Back → rename → Next (no stale inherited die)", () => {
    renderDialog(
      makePrepared([
        { brand: "A", flavor: "X", dieType: "D1" },
        { brand: "A", flavor: "Y" },
      ]),
    );

    fireEvent.click(screen.getByText("Next"));
    expect((screen.getByTestId("spec-profile-die-pk1") as HTMLSelectElement).value).toBe("D1");

    // Back to step 1, move the second product to a different brand so it no longer
    // groups with the die-bearing sibling.
    fireEvent.click(screen.getByText("Back"));
    fireEvent.change(screen.getByTestId("spec-profile-brand-pk1"), {
      target: { value: "B" },
    });
    fireEvent.click(screen.getByText("Next"));

    // The previously inherited die must be cleared — it belonged to brand A.
    expect((screen.getByTestId("spec-profile-die-pk1") as HTMLSelectElement).value).toBe("");
  });

  it("re-derives sauce cross-fill on Back → rename → Next (no stale inherited sauce)", () => {
    const onConfirm = vi.fn();
    renderDialog(
      makePrepared([
        { brand: "A", flavor: "X", sauceOzPerPizza: 2 },
        { brand: "A", flavor: "Y" },
      ]),
      onConfirm,
    );

    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText(/^Apply/));
    // Sibling under brand A inherited the sauce.
    let out = onConfirm.mock.calls[0][0] as ParsedSpecImport;
    expect(out.profiles[1].sauceOzPerPizza).toBe(2);

    cleanup();
    onConfirm.mockClear();
    const { getByText, getByTestId } = renderDialog(
      makePrepared([
        { brand: "A", flavor: "X", sauceOzPerPizza: 2 },
        { brand: "A", flavor: "Y" },
      ]),
      onConfirm,
    );
    // Advance, go back, and move the second product to its own brand.
    fireEvent.click(getByText("Next"));
    fireEvent.click(getByText("Back"));
    fireEvent.change(getByTestId("spec-profile-brand-pk1"), {
      target: { value: "B" },
    });
    fireEvent.click(getByText("Next"));
    fireEvent.click(getByText(/^Apply/));

    out = onConfirm.mock.calls[0][0] as ParsedSpecImport;
    const moved = out.profiles.find((p) => p.brand === "B");
    // The previously inherited sauce must be gone — brand B has no sibling.
    expect(moved?.sauceOzPerPizza).toBeUndefined();
  });

  it("re-points a recipe's attach product to the renamed brand/flavor deterministically", () => {
    const recipe: ParsedRecipe = {
      kind: "dough",
      name: "Sheet Dough",
      brand: "A",
      flavor: "X",
      rows: [{ ingredient: "Flour", lbs: 40 }],
    };
    const onConfirm = vi.fn();
    renderDialog(makePrepared([{ brand: "A", flavor: "X" }], [recipe]), onConfirm);

    // Rename the product in step 1.
    fireEvent.change(screen.getByTestId("spec-profile-brand-pk0"), {
      target: { value: "Acme" },
    });
    fireEvent.change(screen.getByTestId("spec-profile-flavor-pk0"), {
      target: { value: "Plain" },
    });
    fireEvent.click(screen.getByText("Next"));

    fireEvent.click(screen.getByText(/^Apply/));

    const out = onConfirm.mock.calls[0][0] as ParsedSpecImport;
    expect(out.profiles[0]).toMatchObject({ brand: "Acme", flavor: "Plain" });
    // The recipe followed the rename with no AI re-run and no manual retype.
    expect(out.recipes[0]).toMatchObject({ brand: "Acme", flavor: "Plain" });
  });

  it("re-points a brand-only recipe after a rename even when a same-brand row is excluded", () => {
    // Brand A has flavors X and Y. The user includes X and renames A → NewA,
    // but excludes Y (still under the original "A"). The excluded row must NOT
    // register an identity rename that makes the brand map ambiguous — the
    // brand-anchored recipe has to follow the confirmed name of the rows that
    // are actually being imported.
    const recipe: ParsedRecipe = {
      kind: "dough",
      name: "Sheet Dough",
      brand: "A",
      rows: [{ ingredient: "Flour", lbs: 40 }],
    };
    const onConfirm = vi.fn();
    renderDialog(
      makePrepared(
        [
          { brand: "A", flavor: "X" },
          { brand: "A", flavor: "Y" },
        ],
        [recipe],
      ),
      onConfirm,
    );

    fireEvent.change(screen.getByTestId("spec-profile-brand-pk0"), {
      target: { value: "NewA" },
    });
    fireEvent.click(screen.getByTestId("spec-profile-include-pk1"));
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText(/^Apply/));

    const out = onConfirm.mock.calls[0][0] as ParsedSpecImport;
    expect(out.profiles).toHaveLength(1);
    expect(out.profiles[0]).toMatchObject({ brand: "NewA", flavor: "X" });
    // The brand-only recipe followed the included row's confirmed brand.
    expect(out.recipes[0]).toMatchObject({ brand: "NewA" });
  });

  it("passes step-1 brand/flavor renames to onConfirm as learnable aliases", () => {
    const onConfirm = vi.fn();
    const prepared = makePrepared([{ brand: '11" Four Hands', flavor: "Chz" }]);
    // A prior learned alias points AT the shown brand: the rename must re-point
    // the raw sheet label to the edited name (no alias chain).
    prepared.newAliases = [
      { kind: "brand", externalName: "11 IN FOUR HANDS", canonicalName: '11" Four Hands', context: null },
    ];
    renderDialog(prepared, onConfirm);

    fireEvent.change(screen.getByTestId("spec-profile-brand-pk0"), {
      target: { value: "Four Hands" },
    });
    fireEvent.change(screen.getByTestId("spec-profile-flavor-pk0"), {
      target: { value: "Cheese" },
    });
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText(/^Apply/));

    const learned = onConfirm.mock.calls[0][1] as SpecImportAlias[];
    expect(learned).toContainEqual({
      kind: "brand",
      externalName: '11" Four Hands',
      canonicalName: "Four Hands",
      context: null,
    });
    expect(learned).toContainEqual({
      kind: "brand",
      externalName: "11 IN FOUR HANDS",
      canonicalName: "Four Hands",
      context: null,
    });
    expect(learned).toContainEqual({
      kind: "flavor",
      externalName: "Chz",
      canonicalName: "Cheese",
      context: "Four Hands",
    });
  });

  it("passes no learned aliases when names were confirmed unchanged", () => {
    const onConfirm = vi.fn();
    renderDialog(makePrepared([{ brand: "A", flavor: "X" }]), onConfirm);
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText(/^Apply/));
    expect(onConfirm.mock.calls[0][1]).toEqual([]);
  });

  it("lets a recipe-only workbook (no profiles) advance straight to step 2", () => {
    const recipe: ParsedRecipe = {
      kind: "dough",
      name: "Sheet Dough",
      rows: [{ ingredient: "Flour", lbs: 40 }],
    };
    renderDialog(makePrepared([], [recipe]));

    const next = screen.getByText("Next").closest("button") as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    fireEvent.click(next);
    expect(screen.getByTestId("spec-recipe-name-rk0")).toBeTruthy();
  });

  it("shows verified workbook cells during review and strips locations before Apply", () => {
    const profile: ParsedProfile = {
      brand: "Aldo Foods",
      flavor: "Classic",
      dieType: "12 inch",
      sourceLocations: {
        brand: [{ file: "spec.xlsx", sheet: "Profiles", cell: "A2" }],
        flavor: [{ file: "spec.xlsx", sheet: "Profiles", cell: "B2" }],
        dieType: [{ file: "spec.xlsx", sheet: "Profiles", cell: "C2" }],
      },
      applicators: [],
      pepperonis: [],
    };
    const recipe: ParsedRecipe = {
      kind: "dough",
      name: "House Dough",
      sourceLocations: {
        name: [{ file: "spec.xlsx", sheet: "Dough Recipes", cell: "A1" }],
        doughballOz: [{ file: "spec.xlsx", sheet: "Dough Recipes", cell: "B2" }],
        rowsUnit: [{ file: "spec.xlsx", sheet: "Dough Recipes", cell: "B3" }],
      },
      doughballOz: 8.25,
      rowsUnit: "lb",
      rows: [{
        ingredient: "Flour",
        lbs: 40,
        sourceLocations: [
          { file: "spec.xlsx", sheet: "Dough Recipes", cell: "A3" },
          { file: "spec.xlsx", sheet: "Dough Recipes", cell: "B3" },
        ],
      }],
    };
    const onConfirm = vi.fn();
    renderDialog(makePrepared([profile], [recipe]), onConfirm);

    expect(screen.getByTestId("spec-profile-source-pk0").textContent)
      .toContain("spec.xlsx · Profiles!A2");
    expect(screen.getByTestId("spec-profile-source-pk0").textContent)
      .toContain("spec.xlsx · Profiles!B2");
    expect(screen.getByText(/Die 12 inch .*spec\.xlsx · Profiles!C2/)).toBeTruthy();

    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByTestId("spec-recipe-source-name-rk0").textContent)
      .toContain("spec.xlsx · Dough Recipes!A1");
    expect(screen.getByTestId("spec-recipe-source-metadata-rk0").textContent)
      .toContain("Doughball 8.25 oz (spec.xlsx · Dough Recipes!B2)");
    expect(screen.getByTestId("spec-recipe-rows-unit-rk0").textContent)
      .toContain("spec.xlsx · Dough Recipes!B3");
    expect(screen.getByText(/Flour 40 lb .*Dough Recipes!A3.*Dough Recipes!B3/)).toBeTruthy();
    fireEvent.click(screen.getByText(/^Apply/));

    const applied = onConfirm.mock.calls[0][0] as ParsedSpecImport;
    expect(applied.profiles[0]).not.toHaveProperty("sourceLocations");
    expect(applied.recipes[0]).not.toHaveProperty("sourceLocations");
    expect(applied.recipes[0].rows[0]).not.toHaveProperty("sourceLocations");
  });

  it("labels AI-only locations as unverified", () => {
    const profile: ParsedProfile = {
      brand: "AI Brand",
      flavor: "AI Flavor",
      applicators: [],
      pepperonis: [],
    };
    const recipe: ParsedRecipe = {
      kind: "dough",
      name: "AI Dough",
      rows: [{ ingredient: "Flour", lbs: 40 }],
    };
    renderDialog(makePrepared([profile], [recipe]));

    expect(screen.getByTestId("spec-profile-source-pk0").textContent)
      .toContain("location unverified");
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByTestId("spec-recipe-source-name-rk0").textContent)
      .toContain("location unverified");
    expect(screen.getByText(/Flour 40 lb \(location unverified\)/)).toBeTruthy();
  });

  it("opens cited cells, navigates across workbook sheets, and clears the preview when review ends", () => {
    const profile: ParsedProfile = {
      brand: "Aldo Foods",
      flavor: "Classic",
      sourceLocations: {
        brand: [{ file: "spec.xlsx", sheet: "Profiles", cell: "A2" }],
      },
      applicators: [],
      pepperonis: [],
    };
    const recipe: ParsedRecipe = {
      kind: "dough",
      name: "House Dough",
      sourceLocations: {
        name: [{ file: "spec.xlsx", sheet: "Dough Recipes", cell: "B2" }],
      },
      rows: [{ ingredient: "Flour", lbs: 40 }],
    };
    const prepared = makePrepared([profile], [recipe]);
    prepared.sourcePreviewCells = [
      { file: "spec.xlsx", sheet: "Profiles", cell: "A2", value: "Aldo Foods" },
      { file: "spec.xlsx", sheet: "Dough Recipes", cell: "B2", value: "House Dough" },
    ];
    const props = {
      onClose: () => {},
      loading: false,
      error: null,
      prepared,
      applying: false,
      existingRecipeNamesByKind: { dough: [], sauce: [], cheese: [], mix: [] },
      onConfirm: () => {},
    };
    const view = render(<SpecImportDialog open={true} {...props} />);

    fireEvent.click(screen.getByText("View cited cells"));
    fireEvent.click(screen.getByRole("button", { name: "Open spec.xlsx · Profiles!A2" }));
    expect(screen.getByTestId("spec-source-preview").textContent)
      .toContain("spec.xlsx · Profiles!A2");
    expect(screen.getByTestId("spec-source-preview-value").textContent).toBe("Aldo Foods");

    fireEvent.change(screen.getByLabelText("Navigate to another cited workbook cell"), {
      target: { value: JSON.stringify(["spec.xlsx", "Dough Recipes", "B2"]) },
    });
    expect(screen.getByTestId("spec-source-preview").textContent)
      .toContain("spec.xlsx · Dough Recipes!B2");
    expect(screen.getByTestId("spec-source-preview-value").textContent).toBe("House Dough");

    view.rerender(<SpecImportDialog open={false} {...props} prepared={null} />);
    expect(screen.queryByTestId("spec-source-preview")).toBeNull();
    view.rerender(<SpecImportDialog open={true} {...props} />);
    expect(screen.queryByTestId("spec-source-preview")).toBeNull();
  });

  it("shows a formula separately from its saved result", () => {
    const profile: ParsedProfile = {
      brand: "Aldo Foods",
      flavor: "Classic",
      sourceLocations: {
        brand: [{ file: "spec.xlsx", sheet: "Profiles", cell: "A2" }],
      },
      applicators: [],
      pepperonis: [],
    };
    const prepared = makePrepared([profile]);
    prepared.sourcePreviewCells = [{
      file: "spec.xlsx",
      sheet: "Profiles",
      cell: "A2",
      value: "0.5",
      formula: "1/2",
      hasSavedResult: true,
      savedResult: "0.5",
    }];
    renderDialog(prepared);

    fireEvent.click(screen.getByText("View cited cells"));
    fireEvent.click(screen.getByRole("button", { name: "Open spec.xlsx · Profiles!A2" }));

    expect(screen.getByTestId("spec-source-preview-formula").textContent).toBe("=1/2");
    expect(screen.getByTestId("spec-source-preview-value").textContent).toBe("0.5");
  });

  it("states when a formula has no saved result instead of showing a calculated value", () => {
    const missingResultProfile: ParsedProfile = {
      brand: "Aldo Foods",
      flavor: "Classic",
      sourceLocations: {
        brand: [{ file: "spec.xlsx", sheet: "Profiles", cell: "D2" }],
      },
      applicators: [],
      pepperonis: [],
    };
    const missingResultPrepared = makePrepared([missingResultProfile]);
    missingResultPrepared.sourcePreviewCells = [{
      file: "spec.xlsx",
      sheet: "Profiles",
      cell: "D2",
      value: "",
      formula: "1/2",
      hasSavedResult: false,
    }];
    renderDialog(missingResultPrepared);

    fireEvent.click(screen.getByText("View cited cells"));
    fireEvent.click(screen.getByRole("button", { name: "Open spec.xlsx · Profiles!D2" }));

    expect(screen.getByTestId("spec-source-preview-formula").textContent).toBe("=1/2");
    expect(screen.getByTestId("spec-source-preview-value").textContent)
      .toBe("No saved result in workbook");
  });

  it("does not preview a cited location that is absent from the source workbook", () => {
    const profile: ParsedProfile = {
      brand: "Aldo Foods",
      flavor: "Classic",
      sourceLocations: {
        brand: [{ file: "spec.xlsx", sheet: "Profiles", cell: "Z99" }],
      },
      applicators: [],
      pepperonis: [],
    };
    const prepared = makePrepared([profile]);
    prepared.sourcePreviewCells = [
      { file: "spec.xlsx", sheet: "Profiles", cell: "A2", value: "Aldo Foods" },
    ];
    renderDialog(prepared);

    expect(screen.queryByRole("button", { name: /Profiles!Z99/ })).toBeNull();
    expect(screen.queryByTestId("spec-source-preview")).toBeNull();
  });

  it("sends the gold opt-in only after the final reviewed Apply is selected", () => {
    const onConfirm = vi.fn();
    renderDialog(
      makePrepared([{ brand: "Aldo Foods", flavor: "Classic", applicators: [], pepperonis: [] }]),
      onConfirm,
      {},
      undefined,
      {},
      true,
    );
    expect(screen.queryByTestId("spec-import-gold-opt-in")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByTestId("spec-import-gold-opt-in"));
    fireEvent.click(screen.getByRole("button", { name: /Apply 1 item/ }));
    expect(onConfirm.mock.calls[0]?.at(-1)).toBe(true);
  });
});
