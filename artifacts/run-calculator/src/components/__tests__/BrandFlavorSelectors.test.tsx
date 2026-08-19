import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CheeseRecipe } from "@workspace/cheese-recipes";
import type { Mix } from "@workspace/mixes";
import { CheeseRecipeEditor } from "../CheeseRecipesManager";
import { MixEditor } from "../MixesManager";

afterEach(cleanup);

function mix(overrides: Partial<Mix> = {}): Mix {
  return {
    id: "mix-1",
    name: "House Blend",
    brand: "Northside",
    flavor: "Cheese",
    batchSize: 10,
    daysEarly: 1,
    notes: "",
    amountAlreadyMade: 0,
    components: [],
    enabled: true,
    ...overrides,
  };
}

function cheeseRecipe(overrides: Partial<CheeseRecipe> = {}): CheeseRecipe {
  return {
    id: "cheese-1",
    name: "House Cheese",
    brand: "Northside",
    flavors: [],
    shredderSetting: "",
    cellulose: "",
    notes: "",
    components: [],
    enabled: true,
    ...overrides,
  };
}

describe("brand and flavor selectors", () => {
  it("offers Any options and clears an incompatible flavor when a mix brand changes", () => {
    const onChange = vi.fn();
    render(
      <MixEditor
        mix={mix()}
        disabled={false}
        brands={["Northside", "Southside"]}
        brandFlavors={{ Northside: ["Cheese", "Pepperoni"], Southside: ["Veggie"] }}
        ingredientSuggestions={[]}
        onChange={onChange}
        onDelete={vi.fn()}
      />,
    );

    const brand = screen.getByLabelText("Brand") as HTMLSelectElement;
    const flavor = screen.getByLabelText("Flavor") as HTMLSelectElement;
    expect((screen.getByRole("option", { name: "Any brand" }) as HTMLOptionElement).value).toBe("");
    expect((screen.getByRole("option", { name: "Any flavor" }) as HTMLOptionElement).value).toBe("");
    expect(Array.from(flavor.options).map((option) => option.value)).toEqual([
      "",
      "Cheese",
      "Pepperoni",
    ]);

    fireEvent.change(brand, { target: { value: "Southside" } });
    expect(flavor.value).toBe("");
    expect(Array.from(flavor.options).map((option) => option.value)).toEqual([
      "",
      "Veggie",
    ]);
    fireEvent.blur(brand);

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ brand: "Southside", flavor: "" }),
    );
  });

  it("keeps legacy mix values available until the manager deliberately changes them", () => {
    render(
      <MixEditor
        mix={mix({ brand: "Legacy Customer", flavor: "Legacy Flavor" })}
        disabled={false}
        brands={["Northside"]}
        brandFlavors={{ Northside: ["Cheese"] }}
        ingredientSuggestions={[]}
        onChange={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(
      (screen.getByRole("option", { name: "Legacy Customer (current)" }) as HTMLOptionElement)
        .value,
    ).toBe("Legacy Customer");
    expect(
      (screen.getByRole("option", { name: "Legacy Flavor (current)" }) as HTMLOptionElement)
        .value,
    ).toBe("Legacy Flavor");
  });

  it("uses the factory customer menu for cheese recipes and preserves a legacy customer", () => {
    const onChange = vi.fn();
    render(
      <CheeseRecipeEditor
        recipe={cheeseRecipe({ brand: "Legacy Customer" })}
        disabled={false}
        brands={["Northside", "Southside"]}
        ingredientSuggestions={[]}
        onChange={onChange}
        onDelete={vi.fn()}
      />,
    );

    const customer = screen.getByLabelText("Customer (brand)") as HTMLSelectElement;
    expect((screen.getByRole("option", { name: "Any customer" }) as HTMLOptionElement).value).toBe("");
    expect(
      (screen.getByRole("option", { name: "Legacy Customer (current)" }) as HTMLOptionElement)
        .value,
    ).toBe("Legacy Customer");

    fireEvent.change(customer, { target: { value: "Southside" } });
    fireEvent.blur(customer);
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ brand: "Southside" }),
    );
  });
});