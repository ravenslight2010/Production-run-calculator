// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Mix } from "@workspace/mixes";
import { mergeMixUpdates } from "../mixes";

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

const otherMix: Mix = {
  ...mix,
  id: "mix-2",
  name: "Other mix",
  amountAlreadyMade: 1,
};

describe("MixAlreadyMadeInput", () => {
  it("shows an error and keeps the typed value when saving fails", async () => {
    const user = userEvent.setup();
    const saveMixes = vi.fn().mockRejectedValue(new Error("network failure"));
    const onSaved = vi.fn();
    render(
      <MixAlreadyMadeInput
        mix={mix}
        saveMixes={saveMixes}
        onOptimisticSave={onSaved}
        onSaveAcknowledged={vi.fn()}
      />,
    );

    const input = screen.getByRole("spinbutton");
    await user.clear(input);
    await user.type(input, "7.5");
    await user.tab();

    expect(saveMixes).toHaveBeenCalledWith([{ ...mix, amountAlreadyMade: 7.5 }]);
    expect(onSaved).toHaveBeenCalledWith({ ...mix, amountAlreadyMade: 7.5 });
    expect(input).toHaveProperty("value", "7.5");
    expect(toast).toHaveBeenCalledWith({
      variant: "destructive",
      title: "Couldn't save already made amount",
      description: "Please check your connection and try again.",
    });
  });

  it("updates optimistically before a delayed save resolves", async () => {
    const user = userEvent.setup();
    let resolveSave!: (saved: Mix[]) => void;
    const saveMixes = vi.fn(
      () => new Promise<Mix[]>((resolve) => { resolveSave = resolve; }),
    );
    const onOptimisticSave = vi.fn();
    const onSaveAcknowledged = vi.fn();
    render(
      <MixAlreadyMadeInput
        mix={mix}
        saveMixes={saveMixes}
        onOptimisticSave={onOptimisticSave}
        onSaveAcknowledged={onSaveAcknowledged}
      />,
    );

    const input = screen.getByRole("spinbutton");
    await user.clear(input);
    await user.type(input, "4");
    await user.tab();

    const optimistic = { ...mix, amountAlreadyMade: 4 };
    expect(onOptimisticSave).toHaveBeenCalledWith(optimistic);
    expect(input).toHaveProperty("value", "4");

    resolveSave([mix, otherMix]);
    await vi.waitFor(() => expect(saveMixes).toHaveBeenCalledTimes(1));
    expect(onSaveAcknowledged).toHaveBeenCalledWith(optimistic, [mix, otherMix]);
    // A complete, delayed server response must not replace the optimistic
    // one-item update in the mounted input.
    expect(input).toHaveProperty("value", "4");
    expect(toast).not.toHaveBeenCalled();
  });

  it("merges an optimistic one-item update without dropping other mixes", () => {
    const updated = { ...mix, amountAlreadyMade: 4 };

    expect(mergeMixUpdates([mix, otherMix], [updated])).toEqual([updated, otherMix]);
  });

  it("does not restore a mix that was removed from the cached list", () => {
    const updated = { ...mix, amountAlreadyMade: 4 };

    expect(mergeMixUpdates([otherMix], [updated])).toEqual([otherMix]);
  });
});