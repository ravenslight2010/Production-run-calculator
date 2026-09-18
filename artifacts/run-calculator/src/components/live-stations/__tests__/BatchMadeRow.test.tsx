// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BatchMadeRow } from "../BatchMadeRow";

describe("BatchMadeRow", () => {
  afterEach(cleanup);
  it("renders frontline supply totals and exposes correction controls", () => {
    const onIncrement = vi.fn();
    const onDecrement = vi.fn();
    const { getByLabelText, getByTestId, getByText } = render(
      <BatchMadeRow
        label="Frontline"
        totalBatches={4}
        made={1}
        onIncrement={onIncrement}
        onDecrement={onDecrement}
        isLive
        testId="frontline-supply"
        pipeline="frontline"
      />,
    );

    expect(getByTestId("frontline-supply").textContent).toContain("batches still to make");
    expect(getByText("Correction controls")).toBeTruthy();
    fireEvent.click(getByLabelText("Increase consumed batches correction"));
    fireEvent.click(getByLabelText("Decrease consumed batches correction"));
    expect(onIncrement).toHaveBeenCalledOnce();
    expect(onDecrement).toHaveBeenCalledOnce();
  });

  it("renders the sauce unit and disables correction controls when locked", () => {
    const { getByTestId, getByLabelText } = render(
      <BatchMadeRow
        label="Sauce"
        totalBatches={2}
        made={0}
        onIncrement={() => {}}
        onDecrement={() => {}}
        isLive
        disabled
        testId="sauce-supply"
        pipeline="sauce"
      />,
    );

    expect(getByTestId("sauce-supply").textContent).toContain("barrels still to make");
    expect((getByLabelText("Increase consumed batches correction") as HTMLButtonElement).disabled).toBe(true);
    expect((getByLabelText("Decrease consumed batches correction") as HTMLButtonElement).disabled).toBe(true);
  });
});