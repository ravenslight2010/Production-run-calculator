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
  it("can show no disabled dates when today starts a Sunday-first month", () => {
    const today = new Date(2026, 10, 1, 12);
    const { container } = render(
      <Calendar
        mode="single"
        defaultMonth={today}
        selected={today}
        disabled={{ before: today }}
      />,
    );

    expect(screen.getByRole("grid", { name: "November 2026" })).toBeTruthy();
    expect(container.querySelector("button[data-day][disabled]")).toBeNull();
  });

  it.each([
    { label: "a Sunday month boundary", today: new Date(2026, 10, 1, 12) },
    { label: "an ordinary mid-month day", today: new Date(2026, 10, 15, 12) },
    { label: "a year boundary", today: new Date(2027, 0, 1, 12) },
  ])("checks past-date rejection and restores selection at $label", async ({ today }) => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { container } = render(
      <Calendar
        mode="single"
        defaultMonth={today}
        selected={today}
        disabled={{ before: today }}
        onSelect={onSelect}
      />,
    );
    const initialMonth = screen.getByRole("grid").getAttribute("aria-label");

    await user.click(
      screen.getByRole("button", { name: "Go to the Previous Month" }),
    );
    const pastDay = container.querySelector<HTMLButtonElement>(
      "button[data-day][disabled]",
    );
    if (!pastDay) throw new Error("The prior month must expose a disabled past date.");
    expect(pastDay.disabled).toBe(true);
    await user.click(pastDay);
    expect(onSelect).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "Go to the Next Month" }),
    );
    expect(screen.getByRole("grid").getAttribute("aria-label")).toBe(initialMonth);
    expect(
      container.querySelector('button[data-selected-single="true"]'),
    ).not.toBeNull();
    const nextDate = new Date(
      today.getFullYear(), today.getMonth(), today.getDate() + 1,
    );
    const nextDay = container.querySelector<HTMLButtonElement>(
      `button[data-day="${nextDate.toLocaleDateString()}"]`,
    );
    if (!nextDay) throw new Error("The restored month must expose the next date.");
    expect(nextDay.disabled).toBe(false);
    await user.click(nextDay);
    expect(onSelect).toHaveBeenCalledWith(
      nextDate, expect.any(Date), expect.anything(), expect.anything(),
    );
  });

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