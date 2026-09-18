import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { useForm, FormProvider } from "react-hook-form";
import { StepperField } from "./components/live-stations/StepperField";

function Harness({ disabled, onSuggest, onManual }: any) {
  const form = useForm({ defaultValues: { skidsCompleted: 1 } });
  return <FormProvider {...form}>
    <StepperField control={form.control} name="skidsCompleted" label="Skids" disabled={disabled} suggestion={3} onSuggest={onSuggest} onManualChange={onManual} />
  </FormProvider>;
}

describe("StepperField disabled mutation boundary", () => {
  it("blocks Expected, +/- and input while disabled, then works after release", () => {
    vi.useFakeTimers();
    const suggest = vi.fn();
    const manual = vi.fn();
    const view = render(<Harness disabled={false} onSuggest={suggest} onManual={manual} />);
    const input = view.getByTestId("input-skidsCompleted");
    fireEvent.pointerDown(view.getByTestId("btn-inc-skidsCompleted"));
    const manualBeforeLock = manual.mock.calls.length;
    view.rerender(<Harness disabled={true} onSuggest={suggest} onManual={manual} />);
    vi.runOnlyPendingTimers();
    fireEvent.click(view.getByText("Expected: 3"));
    fireEvent.change(view.getByTestId("input-skidsCompleted"), { target: { value: "8" } });
    expect(suggest).not.toHaveBeenCalled();
    expect(manual).toHaveBeenCalledTimes(manualBeforeLock);
    expect((view.getByTestId("input-skidsCompleted") as HTMLInputElement).value).toBe("2");
    view.rerender(<Harness disabled={false} onSuggest={suggest} onManual={manual} />);
    fireEvent.click(view.getByText("Expected: 3"));
    expect(suggest).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(view.getByTestId("btn-inc-skidsCompleted"));
    expect(manual).toHaveBeenCalled();
  });
});