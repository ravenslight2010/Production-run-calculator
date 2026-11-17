import { fireEvent, render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import type { FormValues } from "../types";
import { LineTransitSettings } from "./LineTransitSettings";

const savedValues = {
  freezerTime: 30,
  preTunnelMin: 6,
  pressOvenMin: 4,
  frontlineMin: 2,
  postTunnelMin: 3,
} as FormValues;

function Harness({ isCrust }: { isCrust: boolean }) {
  const form = useForm<FormValues>({ defaultValues: savedValues });
  const pressOvenMin = form.watch("pressOvenMin");
  const preTunnelMin = form.watch("preTunnelMin");

  return (
    <FormProvider {...form}>
      <LineTransitSettings form={form} values={savedValues} isCrust={isCrust} />
      <output data-testid="saved-timing">
        {String(pressOvenMin)}:{String(preTunnelMin)}
      </output>
    </FormProvider>
  );
}

describe("LineTransitSettings crust mode", () => {
  it("bypasses Press/Oven and preserves its saved value while editing Frontline", () => {
    const view = render(<Harness isCrust />);

    expect(screen.queryByLabelText("Press / Oven transit (min)")).toBeNull();
    expect(screen.getByLabelText("Frontline transit (min)")).toBeTruthy();
    expect(screen.getByTestId("crust-press-oven-bypass").textContent)
      .toContain("Premade crust runs start at Frontline");
    expect(screen.getByTestId("line-transit-total").textContent)
      .toContain("Press / Oven bypassed");

    fireEvent.change(screen.getByLabelText("Frontline transit (min)"), {
      target: { value: "2.3" },
    });
    expect(screen.getByTestId("saved-timing").textContent).toBe("4:2.3");

    view.rerender(<Harness isCrust={false} />);
    expect((screen.getByLabelText("Press / Oven transit (min)") as HTMLInputElement).value).toBe("4");
  });
});
