// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Mix } from "@workspace/mixes";

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ toast }));

import { MixAlreadyMadeInput } from "./MixAlreadyMadeInput";

afterEach(() => {
  cleanup();
  toast.mockClear();
});

const mix: Mix = {
  id: "mix-1",
  name: "Veggie mix",
  brand: "",
  flavor: "",
  components: [],
  batchSizeLbs: 10,
  amountAlreadyMade: 2,
  notes: "",
};

describe("MixAlreadyMadeInput", () => {
  it("shows an error and keeps the typed value when saving fails", async () => {
    const user = userEvent.setup();
    const saveMixes = vi.fn().mockRejectedValue(new Error("network failure"));
    render(<MixAlreadyMadeInput mix={mix} saveMixes={saveMixes} onSaved={vi.fn()} />);

    const input = screen.getByRole("spinbutton");
    await user.clear(input);
    await user.type(input, "7.5");
    await user.tab();

    expect(saveMixes).toHaveBeenCalledWith([{ ...mix, amountAlreadyMade: 7.5 }]);
    expect(input).toHaveProperty("value", "7.5");
    expect(toast).toHaveBeenCalledWith({
      variant: "destructive",
      title: "Couldn't save already made amount",
      description: "Please check your connection and try again.",
    });
  });

  it("reports the saved list after a successful save", async () => {
    const user = userEvent.setup();
    const saved = [{ ...mix, amountAlreadyMade: 4 }];
    const saveMixes = vi.fn().mockResolvedValue(saved);
    const onSaved = vi.fn();
    render(<MixAlreadyMadeInput mix={mix} saveMixes={saveMixes} onSaved={onSaved} />);

    const input = screen.getByRole("spinbutton");
    await user.clear(input);
    await user.type(input, "4");
    await user.tab();

    expect(onSaved).toHaveBeenCalledWith(saved);
    expect(toast).not.toHaveBeenCalled();
  });
});