import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import FactoryResetCard from "../FactoryResetCard";

afterEach(cleanup);

describe("factory purge confirmation", () => {
  it("explains QC retention both before opening and inside the destructive confirmation", () => {
    render(<FactoryResetCard />);
    expect(screen.getByText(/Confirmed QC history, staff accounts, roles, and passwords/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("button-factory-reset"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Confirmed QC history and staff accounts are kept/)).toBeTruthy();
    const confirm = within(dialog).getByTestId("button-factory-reset-confirm") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByTestId("input-factory-reset-confirm"), { target: { value: "RESET" } });
    expect(confirm.disabled).toBe(false);
    // Never execute a purge from this rendered-copy test.
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});