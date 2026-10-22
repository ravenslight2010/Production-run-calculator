// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MixesTabCtx, type MixesTabContextValue } from "../../contexts/MixesTabCtx";
import MixesTabContent from "../MixesTabContent";
import { todayStr } from "../../utils";
import { DEFAULT_VALUES, type DayState } from "../../types";
import type { Mix } from "@workspace/mixes";

vi.mock("../../mixPlanSnapshotClient", () => ({
  useMixPlanSnapshot: () => null,
  refreshMixPlanSnapshot: () => new Promise<void>(() => {}),
}));

vi.mock("../../mixSurplusClient", () => ({
  fetchMixSurplusLedger: () => new Promise<void>(() => {}),
}));

vi.mock("../MixAlreadyMadeInput", () => ({
  MixAlreadyMadeInput: () => null,
}));

vi.mock("../MixSurplusStrip", () => ({
  MixSurplusStrip: () => null,
}));

vi.mock("../PrepMixMissingAmountsWarning", () => ({
  PrepMixMissingAmountsWarning: () => null,
}));

afterEach(cleanup);

function makeMix(id: string, name: string, overrides: Partial<Mix> = {}): Mix {
  return {
    id,
    name,
    brand: "Reserved-name customer",
    flavor: "Original",
    batchSize: 10,
    daysEarly: 0,
    amountAlreadyMade: 0,
    components: [],
    enabled: true,
    ...overrides,
  };
}

describe("MixesTabContent reserved ingredient names", () => {
  it("renders reserved recipe and topping names in order with duplicate totals", () => {
    const makeDay = todayStr();
    const values = {
      ...DEFAULT_VALUES,
      casesNeeded: 1,
      pizzasPerCase: 10,
      app1Type: "__proto__",
      app1OzPerPizza: 1.25,
      app2Type: "constructor",
      app2OzPerPizza: 2,
      app3Type: "Mozzarella",
      app3OzPerPizza: 2,
      app3CheeseRecipe: [
        { ingredient: "Mozzarella", lbs: 1 },
        { ingredient: "valueOf", lbs: 1 },
      ],
      app4Type: "Mozzarella",
      app4OzPerPizza: 2,
      pep1Type: "__proto__",
      pep1OzPerPizza: 0.75,
      pep2Type: "prototype",
      pep2OzPerPizza: 3,
      pep1TypeB: "toString",
      pep1OzPerPizzaB: 0.5,
      pep2TypeB: "hasOwnProperty",
      pep2OzPerPizzaB: 1,
    };
    const mixes = [
      makeMix("recipe-proto", "__proto__"),
      makeMix("recipe-constructor", "constructor"),
      makeMix("recipe-prototype", "prototype"),
      makeMix(
        "prep-reserved",
        "Reserved topping prep",
        {
          isPrep: true,
          components: [
            { ingredient: "__proto__", perPizza: 0 },
            { ingredient: "constructor", perPizza: 0 },
            { ingredient: "Mozzarella", perPizza: 0 },
            { ingredient: "prototype", perPizza: 0 },
            { ingredient: "toString", perPizza: 0 },
            { ingredient: "hasOwnProperty", perPizza: 0 },
            { ingredient: "valueOf", perPizza: 0 },
          ],
        },
      ),
    ];
    const context = {
      canManageInventory: false,
      currentRunId: "run-1",
      dayState: {
        runs: [{ id: "run-1", brand: "Reserved-name customer", flavor: "Original" }],
      } as DayState,
      effectiveValuesForRun: (_run, runValues) => runValues,
      form: { getValues: () => values },
      mixMakeDay: makeDay,
      mixPlanItems: mixes,
      mixes,
      scheduledDays: [],
      saveMixAlreadyMadeOptimistically: vi.fn(),
      acknowledgeMixAlreadyMadeSave: vi.fn(),
      setMixMakeDay: vi.fn(),
    } satisfies MixesTabContextValue;

    render(
      <MixesTabCtx.Provider value={context}>
        <MixesTabContent />
      </MixesTabCtx.Provider>,
    );

    const plan = screen.getByTestId(`mix-plan-${makeDay}`);
    expect(
      Array.from(plan.querySelectorAll(".text-emerald-50.truncate"))
        .map((node) => node.textContent),
    ).toEqual(["__proto__", "constructor", "prototype"]);

    const prepHeading = within(plan).getByText("Pull For Prep");
    const prepRows = Array.from(prepHeading.parentElement!.children).slice(1);
    expect(prepRows.map((row) => row.firstElementChild?.textContent)).toEqual([
      "__proto__",
      "constructor",
      "Mozzarella",
      "prototype",
      "toString",
      "hasOwnProperty",
      "valueOf",
    ]);

    expect(prepRows.map((row) => row.lastElementChild?.textContent?.trim())).toEqual([
      "1.25 lbs",
      "1.25 lbs",
      "1.88 lbs",
      "1.88 lbs",
      "0.31 lbs",
      "0.63 lbs",
      "0.63 lbs",
    ]);
    expect(within(plan).getByText(/Total 28\.98 lbs/)).toBeTruthy();
  });
});
