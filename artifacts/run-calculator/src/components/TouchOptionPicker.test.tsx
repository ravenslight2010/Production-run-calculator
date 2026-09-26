import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TouchSelect } from "./TouchOptionPicker";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function installPointerCapabilities({
  coarse = false,
  fine = true,
  anyCoarse = false,
  touchPoints = 0,
}: {
  coarse?: boolean;
  fine?: boolean;
  anyCoarse?: boolean;
  touchPoints?: number;
} = {}) {
  const matchMedia = vi.fn((query: string) => ({
      matches:
        query === "(pointer: coarse)"
          ? coarse
          : query === "(pointer: fine)"
            ? fine
            : query === "(any-pointer: coarse)"
              ? anyCoarse
              : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: matchMedia,
  });
  Object.defineProperty(navigator, "maxTouchPoints", {
    configurable: true,
    value: touchPoints,
  });
}

function renderSelect(
  props: Partial<React.ComponentProps<typeof TouchSelect>> = {},
) {
  return render(
    <TouchSelect
      aria-label="Choose recipe"
      title="Choose recipe"
      value=""
      onChange={vi.fn()}
      {...props}
    >
      <option value="">Select a recipe…</option>
      <option value="house">House recipe</option>
      <option value="seasonal">Seasonal recipe</option>
    </TouchSelect>,
  );
}

describe("TouchSelect", () => {
  it("keeps the native select on a pointer device", () => {
    installPointerCapabilities();

    renderSelect();

    expect(screen.getByRole("combobox", { name: "Choose recipe" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("routes a coarse touch device to a named dialog and returns focus after selection", async () => {
    installPointerCapabilities({
      coarse: true,
      fine: false,
      anyCoarse: true,
      touchPoints: 5,
    });
    const onChange = vi.fn();
    const user = userEvent.setup();

    renderSelect({ onChange });
    await waitFor(() =>
      expect(screen.queryByRole("combobox")).toBeNull(),
    );

    const trigger = screen.getByRole("button", { name: "Choose recipe" });
    await user.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: "Choose recipe" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(
      screen.getByRole("option", { name: "House recipe" }).getAttribute("aria-selected"),
    ).toBe("false");

    await user.click(screen.getByRole("option", { name: "Seasonal recipe" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].target.value).toBe("seasonal");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull(),
    );
    expect(document.activeElement).toBe(trigger);
  });

  it("searches long lists inside a bounded scroll region", async () => {
    installPointerCapabilities({ coarse: true, fine: false, touchPoints: 1 });
    const user = userEvent.setup();
    const options = Array.from({ length: 12 }, (_, index) => (
      <option key={index} value={`recipe-${index}`}>
        Recipe {index}
      </option>
    ));

    render(
      <TouchSelect
        aria-label="Long recipe list"
        title="Long recipe list"
        value=""
        onChange={vi.fn()}
      >
        {options}
      </TouchSelect>,
    );
    await waitFor(() =>
      expect(screen.queryByRole("combobox")).toBeNull(),
    );
    await user.click(screen.getByRole("button", { name: "Long recipe list" }));

    const search = screen.getByRole("textbox", {
      name: "Search Long recipe list",
    });
    await user.type(search, "11");
    expect(screen.getByRole("option", { name: "Recipe 11" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Recipe 1" })).toBeNull();

    const list = screen.getByTestId("touch-option-picker-options");
    expect(list.className).toContain("overflow-y-auto");
    expect(list.className).toContain("overscroll-contain");
  });

  it("closes with Escape and handles duplicate empty values deterministically", async () => {
    installPointerCapabilities({ coarse: true, fine: false, touchPoints: 1 });
    const user = userEvent.setup();

    render(
      <TouchSelect
        aria-label="Duplicate options"
        title="Duplicate options"
        value=""
        onChange={vi.fn()}
      >
        <option value="">Choose one</option>
        <option value="">Choose one (legacy)</option>
        <option value="one">One</option>
      </TouchSelect>,
    );
    await waitFor(() =>
      expect(screen.queryByRole("combobox")).toBeNull(),
    );
    const trigger = screen.getByRole("button", { name: "Duplicate options" });
    await user.click(trigger);

    const emptyOptions = screen.getAllByRole("option").filter((option) =>
      option.textContent?.startsWith("Choose one"),
    );
    expect(emptyOptions).toHaveLength(2);
    expect(emptyOptions[0].getAttribute("aria-selected")).toBe("true");
    expect(emptyOptions[1].getAttribute("aria-selected")).toBe("false");

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull(),
    );
    expect(document.activeElement).toBe(trigger);
  });
});