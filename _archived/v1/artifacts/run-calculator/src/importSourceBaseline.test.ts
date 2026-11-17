import { beforeEach, describe, expect, it, vi } from "vitest";
const history = vi.hoisted(() => vi.fn());
vi.mock("./importHistory", () => ({ fetchImportHistory: history }));
import { localImportSourceBaseline } from "./importSourceBaseline";
import { scheduleAppliedValues } from "./importScheduleReview";

beforeEach(() => { history.mockReset().mockResolvedValue([]); });
describe("scoped successful source comparison, separate from current factory state", () => {
  it("does not silently replace the newest successful legacy record with an older comparable one", async () => {
    history.mockResolvedValue([
      { id: 2, createdAt: 2, summary: {} },
      { id: 1, createdAt: 1, summary: { appliedValues: { profiles: [{ key: "A", brand: "Synthetic" }] }, persistence: "local-verified" } },
    ]);
    const result = await localImportSourceBaseline("dough", "same-source", { profiles: [] });
    expect(history).toHaveBeenCalledWith({ type: "dough", sourceKey: "same-source", status: "complete" });
    expect(result.status).toBe("unavailable");
    expect(result.label).toContain("History 2");
    expect(result.changes).toEqual([]);
  });
  it("compares retained applied values without inferring clears or factory deletions", async () => {
    history.mockResolvedValue([{ id: 4, createdAt: 4, summary: { persistence: "local-verified",
      appliedValues: { profiles: [{ key: "A", brand: "Synthetic", sauceOzPerPizza: 2 }, { key: "B", brand: "Prior only" }] },
    } }]);
    const result = await localImportSourceBaseline("sauce", "same-source", { profiles: [{ key: "A", brand: "Synthetic", sauceOzPerPizza: 3 }] });
    expect(result.status).toBe("available");
    expect(result.changes.every((change) => change.action !== "remove")).toBe(true);
    expect(result.changes[0].fields).toContainEqual({ field: "sauceOzPerPizza", before: 2, after: 3, unit: "oz/pizza" });
    expect(result.label).toContain("not source-only");
  });
  it("does not fetch an unrecognized identity or hide a baseline-read failure", async () => {
    expect((await localImportSourceBaseline("shipping", undefined, {})).status).toBe("unavailable");
    expect(history).not.toHaveBeenCalled();
    history.mockRejectedValue(new Error("Service unavailable"));
    await expect(localImportSourceBaseline("shipping", "same-source", {})).rejects.toThrow("Service unavailable");
  });
  it("keeps schedule day comparisons and repeated run rows distinct", async () => {
    const candidate = scheduleAppliedValues("2026-10-22", [
      { brand: "Synthetic", flavor: "Plain", casesPlanned: 0, notes: "" },
      { brand: "Synthetic", flavor: "Plain", casesPlanned: 12, notes: "" },
    ])!;
    expect(candidate.runs.map((row) => row.key)).toEqual(["2026-10-22:0", "2026-10-22:1"]);
    history.mockResolvedValue([{ id: 5, createdAt: 5, summary: { persistence: "sync-acknowledged", appliedValues: {
      runs: [{ key: "2026-10-21:0", date: "2026-10-21", brand: "Earlier" }, ...candidate.runs],
    } } }]);
    const result = await localImportSourceBaseline("schedule", "same-source", candidate, "2026-10-22");
    expect(result.changes).toEqual([]);
  });
});
