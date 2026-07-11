import { describe, it, expect } from "vitest";
import { assignApplicatorSlots, type ParsedApplicator } from "./index";

const app = (type: string, ozPerPizza = 0, slot?: number): ParsedApplicator => ({
  type,
  ozPerPizza,
  ...(slot != null ? { slot } : {}),
});

const types = (apps: ParsedApplicator[]) => apps.map((a) => a.type);

describe("assignApplicatorSlots", () => {
  it("fills stations in listed order when no slots are given (legacy behavior)", () => {
    const out = assignApplicatorSlots([app("Cheese", 4), app("Sausage", 2)]);
    expect(types(out)).toEqual(["Cheese", "Sausage", "", ""]);
    expect(out).toHaveLength(4);
    expect(out[2]).toEqual({ type: "", ozPerPizza: 0 });
  });

  it("places an explicitly slotted applicator on its station, leaving holes", () => {
    // Sheet lists cheese then a topping that sits AFTER the peps → station 3.
    const out = assignApplicatorSlots([app("Cheese", 4), app("Bacon", 1.5, 3)]);
    expect(types(out)).toEqual(["Cheese", "", "Bacon", ""]);
  });

  it("explicit slots claim first; unslotted fill remaining stations in order", () => {
    const out = assignApplicatorSlots([
      app("Bacon", 1.5, 3),
      app("Cheese", 4),
      app("Sausage", 2),
    ]);
    expect(types(out)).toEqual(["Cheese", "Sausage", "Bacon", ""]);
  });

  it("duplicate slots: first claim wins, loser falls back to fill-in-order", () => {
    const out = assignApplicatorSlots([
      app("A", 1, 3),
      app("B", 2, 3),
      app("C", 3),
    ]);
    expect(types(out)).toEqual(["B", "C", "A", ""]);
  });

  it("ignores out-of-range or non-integer slots", () => {
    const out = assignApplicatorSlots([
      app("A", 1, 0),
      app("B", 2, 5),
      app("C", 3, 2.5),
    ]);
    expect(types(out)).toEqual(["A", "B", "C", ""]);
  });

  it("drops overflow beyond 4 stations (mirrors old slice(0,4))", () => {
    const out = assignApplicatorSlots([
      app("A", 1),
      app("B", 2),
      app("C", 3),
      app("D", 4),
      app("E", 5),
    ]);
    expect(types(out)).toEqual(["A", "B", "C", "D"]);
  });

  it("preserves batchLbs and does not mutate the input", () => {
    const input = [
      { type: "Bacon", ozPerPizza: 1.5, batchLbs: 20, slot: 4 },
      { type: "Cheese", ozPerPizza: 4 },
    ];
    const copy = JSON.parse(JSON.stringify(input));
    const out = assignApplicatorSlots(input);
    expect(out[3]).toEqual({ type: "Bacon", ozPerPizza: 1.5, batchLbs: 20, slot: 4 });
    expect(out[0]).toEqual({ type: "Cheese", ozPerPizza: 4 });
    expect(input).toEqual(copy);
  });
});
