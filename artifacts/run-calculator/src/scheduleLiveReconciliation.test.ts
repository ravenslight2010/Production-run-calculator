import { describe, expect, it } from "vitest";
import { reconcileLiveScheduleSave } from "./scheduleLiveReconciliation";

const run = (id: string, extra = {}) => ({
  id,
  brand: "",
  flavor: "",
  ...extra,
});

describe("reconcileLiveScheduleSave", () => {
  it("removes two loaded unnamed pending runs and retains the submitted run", () => {
    const loaded = [run("keep"), run("unnamed-1"), run("unnamed-2")];
    const result = reconcileLiveScheduleSave(
      loaded,
      [{ id: "keep", brand: "Acme", flavor: "Cheese" }],
      loaded,
    );

    expect(result).toEqual({
      ok: true,
      runs: [{ id: "keep", brand: "Acme", flavor: "Cheese" }],
      removedRunIds: ["unnamed-1", "unnamed-2"],
    });
  });

  it("preserves active, completed, newly arrived, and never-displayed runs", () => {
    const loaded = [
      run("editable"),
      run("became-active"),
      run("completed", { startedAt: 10, endedAt: 20 }),
    ];
    const result = reconcileLiveScheduleSave(
      loaded,
      [{ id: "editable", brand: "Edited", flavor: "Run" }],
      [
        run("editable"),
        run("became-active", { startedAt: 30 }),
        loaded[2],
        run("new-peer-run"),
      ],
    );

    expect(result).toEqual({
      ok: true,
      runs: [
        { id: "editable", brand: "Edited", flavor: "Run" },
        run("became-active", { startedAt: 30 }),
        loaded[2],
        run("new-peer-run"),
      ],
      removedRunIds: [],
    });
  });

  it("does not delete live runs when the editor never loaded them", () => {
    expect(reconcileLiveScheduleSave(
      [],
      [{ id: "new", brand: "", flavor: "" }],
      [run("existing")],
    )).toEqual({
      ok: true,
      runs: [run("new"), run("existing")],
      removedRunIds: [],
    });
  });

  it("rejects a save that would leave today with zero runs", () => {
    expect(reconcileLiveScheduleSave([run("only")], [], [run("only")])).toEqual({
      ok: false,
      reason: "minimum-one-run",
    });
  });
});