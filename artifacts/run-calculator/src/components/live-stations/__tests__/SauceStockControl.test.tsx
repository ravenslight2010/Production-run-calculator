import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SauceStockControl } from "../SauceStockControl";

describe("SauceStockControl", () => {
  it("adjusts in tenths and disables at both stock limits", () => {
    const onChange = vi.fn();
    const { rerender } = render(<SauceStockControl barrels={1.2} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("sauce-stock-increase"));
    expect(onChange).toHaveBeenCalledWith(1.3);
    rerender(<SauceStockControl barrels={2} onChange={onChange} />);
    expect((screen.getByTestId("sauce-stock-increase") as HTMLButtonElement).disabled).toBe(true);
    rerender(<SauceStockControl barrels={0} onChange={onChange} />);
    expect((screen.getByTestId("sauce-stock-decrease") as HTMLButtonElement).disabled).toBe(true);
  });
});
