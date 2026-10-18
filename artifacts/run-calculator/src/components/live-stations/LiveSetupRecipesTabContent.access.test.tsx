// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const noop = vi.fn();

vi.mock("../../contexts/HomeTabCtx", () => ({
  useHomeTabCtx: () => ({
    addDoughIngredient: noop,
    addDoughRecipeName: noop,
    addFrontlineIngredient: noop,
    addFrontlineRecipeName: noop,
    addIngredientType: noop,
    addPepType: noop,
    appendCheese1: noop,
    appendCheese2: noop,
    appendCheese3: noop,
    appendCheese4: noop,
    appendDough: noop,
    appendFrontline: noop,
    applyLearnedBatchLbs: noop,
    canManageInventory: true,
    cheese1Fields: [],
    cheese2Fields: [],
    cheese3Fields: [],
    cheese4Fields: [],
    cheeseNameBrandTags: new Map(),
    cheeseNamesForRun: () => [],
    currentRun: { brand: "Northstar", flavor: "Pepperoni" },
    dayState: { substitutions: [] },
    doughFields: [],
    doughPoolDrift: null,
    doughRecipeNameOptions: [],
    doughVariantPick: null,
    form: {
      control: {},
      getValues: () => ({}),
      register: noop,
      setValue: noop,
    },
    frontlineFields: [],
    frontlineRecipeNameOptions: [],
    ingredientTypeOptions: [],
    isSupervisor: true,
    mixNameBrandTags: new Map(),
    pep1ShowB: false,
    pep2ShowB: false,
    pepTypes: [],
    promoteFormRecipeToShared: noop,
    promotingRecipeKind: null,
    removeCheese1: noop,
    removeCheese2: noop,
    removeCheese3: noop,
    removeCheese4: noop,
    removeDough: noop,
    removeDoughIngredient: noop,
    removeDoughRecipeName: noop,
    removeFrontline: noop,
    removeFrontlineIngredient: noop,
    removeFrontlineRecipeName: noop,
    removeIngredientType: noop,
    removePepType: noop,
    replaceCheese1: noop,
    replaceCheese2: noop,
    replaceCheese3: noop,
    replaceCheese4: noop,
    replaceDough: noop,
    replaceFrontline: noop,
    saucePoolDrift: null,
    sauceWeightsOpen: true,
    serverCheeseByName: new Map(),
    serverCheeseRowsByName: new Map(),
    serverDoughRowsByName: new Map(),
    serverDoughTrayByName: new Map(),
    serverDoughVariantsByName: new Map(),
    serverDoughWeightByName: new Map(),
    serverMixNames: [],
    serverMixRowsByName: new Map(),
    serverSauceRowsByName: new Map(),
    setDoughVariantPick: noop,
    setPep1ShowB: noop,
    setPep2ShowB: noop,
    setSauceWeightsOpen: noop,
    unifiedIngredientUniverse: [],
    v: {
      app1Type: "",
      app2Type: "",
      app3Type: "",
      app4Type: "",
      frontlineRecipe: [{ ingredient: "Tomato", lbs: 1 }],
      frontlineRecipeName: "House Sauce",
      doughRecipe: [],
      doughRecipeName: "",
      pep1Type: "",
      pep2Type: "",
    },
  }),
}));

vi.mock("../../contexts/LiveRunContext", () => ({
  useLiveRun: () => ({ calc: { batchesNeeded: 0 } }),
}));

vi.mock("../../components/SetupRecipesRoleGate", () => ({
  SetupRecipesRoleGate: ({ children }: { children: unknown }) => children,
}));

vi.mock("../../pages/liveTabsSupport", () => {
  const Empty = () => null;
  const FrontlineRecipeCard = ({
    recipePickerLabel,
    recipePickerTestId,
  }: {
    recipePickerLabel?: string;
    recipePickerTestId?: string;
  }) => (
    <div data-testid={recipePickerTestId} aria-label={recipePickerLabel} />
  );

  return {
    PauseTunnelDecision: Empty,
    OperationalStateBadge: Empty,
    ElapsedTimeBadge: Empty,
    PerRunMixSlotBadge: Empty,
    NumField: Empty,
    DoughRecipeCard: Empty,
    FrontlineRecipeCard,
    CheesePickCard: Empty,
    MixRecipeCard: Empty,
    TypeDropdown: Empty,
    NotesTextarea: Empty,
    aggregatePackagingNeeds: vi.fn(),
  };
});

import { LiveSetupRecipesTabContent } from "./LiveSetupRecipesTabContent";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Live Setup sauce recipe picker wiring", () => {
  it("keeps the sauce ingredient picker identified and labeled", () => {
    render(<LiveSetupRecipesTabContent />);

    const picker = screen.getByTestId("setup-recipe-picker-sauce-ingredients");
    expect(picker.getAttribute("aria-label")).toBe("Sauce recipe ingredients");
  });
});