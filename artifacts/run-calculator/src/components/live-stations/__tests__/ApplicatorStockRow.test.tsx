// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApplicatorStockRow } from "../ApplicatorStockRow";

describe("ApplicatorStockRow", () => {
  afterEach(cleanup);

  it("saves fractional pounds and can refill to the configured cap", () => {
    const onSave = vi.fn();
    const { container, getByLabelText, getByRole } = render(
      <ApplicatorStockRow
        label="App 1 · Cheese"
        stockLbs={42}
        capacityLbs={100}
        testId="stock-app1-lbs"
        onSave={onSave}
      />,
    );
    const input = getByLabelText("App 1 · Cheese pounds on hand") as HTMLInputElement;
    const capacity = container.querySelector(".min-w-32 .text-xs");
    expect(capacity?.textContent?.replace(/\s+/g, " ").trim()).toBe("Capacity 100.0 lb");
    expect(input.value).toBe("42");

    fireEvent.change(input, { target: { value: "37.25" } });
    fireEvent.click(getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenLastCalledWith(37.25);

    fireEvent.click(getByRole("button", { name: "Fill to cap" }));
    expect(onSave).toHaveBeenLastCalledWith(100);
  });

  it("rejects a value above the slot cap", () => {
    const onSave = vi.fn();
    const { getByLabelText, getByRole } = render(
      <ApplicatorStockRow
        label="Pep 2 · Pepperoni"
        stockLbs={20}
        capacityLbs={50}
        testId="stock-pep2-lbs"
        onSave={onSave}
      />,
    );
    const input = getByLabelText("Pep 2 · Pepperoni pounds on hand") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "50.01" } });
    fireEvent.click(getByRole("button", { name: "Save" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(input.value).toBe("20");
  });

  it("disables all controls while the slot is not editable", () => {
    const onSave = vi.fn();
    const { getByLabelText, getByRole } = render(
      <ApplicatorStockRow
        label="Pep 2 · Pepperoni"
        stockLbs={20}
        capacityLbs={50}
        disabled
        testId="stock-pep2-lbs"
        onSave={onSave}
      />,
    );
    const input = getByLabelText("Pep 2 · Pepperoni pounds on hand") as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect((getByRole("button", { name: "Fill to cap" }) as HTMLButtonElement).disabled).toBe(true);
    expect((getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
  });
});
