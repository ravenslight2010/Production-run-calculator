import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  flavors: { Synthetic: ["Plain", "Other"] } as Record<string, string[]>,
  profiles: new Map<string, Record<string, unknown>>(),
  review: vi.fn(),
  baseline: vi.fn(),
}));
vi.mock("./storage", () => ({
  loadBrandFlavors: () => mocks.flavors,
  loadRawProfile: (brand: string, flavor: string) => mocks.profiles.get(JSON.stringify([brand, flavor])) ?? null,
}));
vi.mock("./importSafetyReview", () => ({ requestImportSafetyReview: mocks.review, importReviewIdentityEpoch: () => 0 }));
vi.mock("./importSourceBaseline", () => ({ localImportSourceBaseline: mocks.baseline }));
import { reviewProfileImport } from "./importProfileReview";

beforeEach(() => {
  mocks.profiles.clear();
  mocks.flavors = { Synthetic: ["Plain", "Other"] };
  mocks.review.mockReset().mockResolvedValue(true);
  mocks.baseline.mockReset().mockResolvedValue({ status: "unavailable", label: "Legacy", changes: [] });
});
describe("actual reviewed local-guide targets", () => {
  it("combines sequential patches only for selected profiles and verifies actual local outcomes", async () => {
    const key = JSON.stringify(["Synthetic", "Plain"]);
    mocks.profiles.set(key, { sauceOzPerPizza: 2, doughRecipeName: "Shared dough", unrelated: 8 });
    const result = await reviewProfileImport("Guide", [
      { brand: "Synthetic", flavors: ["Plain"], patch: { sauceOzPerPizza: 3 } },
      { brand: "Synthetic", flavors: ["Plain"], patch: { frontlineRecipeName: "Shared sauce" } },
      { brand: "", patch: { sauceOzPerPizza: 9 } },
    ], "sauce", "source-guide");
    expect(result?.values?.profiles).toEqual([{
      key, brand: "Synthetic", flavor: "Plain", sauceOzPerPizza: 3, frontlineRecipeName: "Shared sauce",
    }]);
    const review = mocks.review.mock.calls[0][0];
    expect(review.changes).toHaveLength(1);
    expect(review.changes[0].fields).toContainEqual({ field: "sauceOzPerPizza", before: 2, after: 3, unit: "oz/pizza" });
    expect(() => result?.verify()).toThrow(/could not be verified/);
    mocks.profiles.set(key, { sauceOzPerPizza: 3, frontlineRecipeName: "Shared sauce", unrelated: 8 });
    expect(() => result?.verify()).not.toThrow();
  });
  it("includes brand defaults and known flavors only when whole-brand scope was reviewed", async () => {
    const result = await reviewProfileImport("Guide", [{ brand: "Synthetic", patch: { casesPerSkid: 60 } }], "shipping");
    expect(result?.values?.profiles.map((row) => row.flavor)).toEqual(["", "Plain", "Other"]);
  });
  it("rejects a changed profile while the final proposal is open", async () => {
    mocks.review.mockImplementation(async () => {
      mocks.profiles.set(JSON.stringify(["Synthetic", "Plain"]), { doughRecipeName: "Peer edit" });
      return true;
    });
    await expect(reviewProfileImport("Guide", [{ brand: "Synthetic", flavors: ["Plain"], patch: { doughRecipeName: "New" } }], "dough"))
      .rejects.toThrow(/changed while/);
  });
  it("cancellation returns without treating a proposal as an applied baseline", async () => {
    mocks.review.mockResolvedValue(false);
    await expect(reviewProfileImport("Guide", [{ brand: "Synthetic", patch: { doughRecipeName: "New" } }], "dough")).resolves.toBeNull();
    expect(mocks.profiles.size).toBe(0);
  });
});
