// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Calendar } from "./calendar";

const JANUARY_2025 = new Date(2025, 0, 1);

afterEach(() => {
  cleanup();
});

describe("Calendar", () => {
  it("navigates months and selects a visible outside day", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <Calendar
        mode="single"
        defaultMonth={JANUARY_2025}
        onSelect={onSelect}
        showOutsideDays
      />,
    );

    expect(screen.getByRole("grid", { name: "January 2025" })).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Go to the Next Month" }),
    );
    expect(screen.getByRole("grid", { name: "February 2025" })).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: /Saturday, February 1st, 2025/i }),
    );
    expect(onSelect).toHaveBeenCalledWith(expect.any(Date), expect.any(Date), expect.anything(), expect.anything());
    expect(onSelect.mock.calls[0]?.[0]).toEqual(new Date(2025, 1, 1));
  });

  it("moves keyboard focus and selects the next day", async () => {
    const user = userEvent.setup();

    render(
      <Calendar
        mode="single"
        defaultMonth={JANUARY_2025}
        showOutsideDays
      />,
    );

    const day = screen.getByRole("button", { name: /Thursday, January 9th, 2025/i });
    day.focus();
    await user.keyboard("{ArrowRight}{Enter}");

    expect(
      screen
        .getByRole("button", { name: /Friday, January 10th, 2025/i })
        .getAttribute("data-selected-single"),
    ).toBe("true");
  });

  it("does not allow disabled dates to be selected", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const disabledDate = new Date(2025, 0, 15);

    render(
      <Calendar
        mode="single"
        defaultMonth={JANUARY_2025}
        disabled={disabledDate}
        onSelect={onSelect}
      />,
    );

    const disabledDay = screen.getByRole("button", {
      name: /Wednesday, January 15th, 2025/i,
    });
    expect(disabledDay.hasAttribute("disabled")).toBe(true);

    await user.click(disabledDay);
    expect(onSelect).not.toHaveBeenCalled();
  });
});