// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const touchState = vi.hoisted(() => ({ enabled: false }));
vi.mock("../hooks/use-mobile", () => ({
  useIsTouchDevice: () => touchState.enabled,
}));

import { IngredientSelect, TypeDropdown } from "./SetupPickerControls";

afterEach(() => {
  cleanup();
  touchState.enabled = false;
  vi.restoreAllMocks();
});

describe("setup picker controls", () => {
  it("keeps ingredient values canonical while displaying their labels and adding options", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onAddOption = vi.fn();

    render(
      <IngredientSelect
        value=""
        onChange={onChange}
        options={["House Blend"]}
        optionLabels={new Map([["House Blend", "House Blend (Northstar)"]])}
        onAddOption={onAddOption}
        placeholder="Choose ingredient…"
        ariaLabel="Choose ingredient"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Choose ingredient" }));
    await user.click(screen.getByRole("button", { name: "House Blend (Northstar)" }));
    expect(onChange).toHaveBeenLastCalledWith("House Blend");

    await user.click(screen.getByRole("button", { name: "Choose ingredient" }));
    const search = screen.getByPlaceholderText("Search or add…");
    await user.type(search, "New Ingredient");
    await user.keyboard("{Enter}");
    expect(onAddOption).toHaveBeenCalledWith("New Ingredient");
    expect(onChange).toHaveBeenLastCalledWith("New Ingredient");
  });

  it("preserves type clearing and removal confirmation behavior", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onRemoveOption = vi.fn();

    render(
      <TypeDropdown
        label="Applicator type"
        value="House"
        onChange={onChange}
        options={["House", "Seasonal"]}
        onAddOption={vi.fn()}
        onRemoveOption={onRemoveOption}
        allowClear
        ariaLabel="Applicator type"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Applicator type" }));
    await user.click(screen.getByRole("button", { name: "— None" }));
    expect(onChange).toHaveBeenCalledWith("");

    await user.click(screen.getByRole("button", { name: "Applicator type" }));
    const houseOption = screen.getByRole("button", { name: "House" });
    await user.click(within(houseOption.parentElement!).getAllByRole("button")[1]);
    await user.click(screen.getByRole("button", { name: "Yes" }));
    expect(onRemoveOption).toHaveBeenCalledWith("House");
  });

  it("uses the touch picker for ingredient selection and keeps the underlying option value", async () => {
    touchState.enabled = true;
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <IngredientSelect
        value=""
        onChange={onChange}
        options={["House Blend"]}
        optionLabels={new Map([["House Blend", "House Blend (Northstar)"]])}
        placeholder="Choose ingredient…"
        ariaLabel="Choose ingredient"
        testId="touch-ingredient"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Choose ingredient" }));
    await user.click(await screen.findByRole("option", { name: "House Blend (Northstar)" }));
    expect(onChange).toHaveBeenCalledWith("House Blend");
  });

  it("includes the clear option in the touch type picker when allowed", async () => {
    touchState.enabled = true;
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <TypeDropdown
        label="Applicator type"
        value="House"
        onChange={onChange}
        options={["House", "Seasonal"]}
        onAddOption={vi.fn()}
        onRemoveOption={vi.fn()}
        allowClear
        ariaLabel="Applicator type"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Applicator type" }));
    await user.click(await screen.findByRole("option", { name: "— None" }));
    expect(onChange).toHaveBeenCalledWith("");
  });
});
