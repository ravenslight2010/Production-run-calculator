// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedSpecImport } from "@workspace/spec-import";
import {
  adoptSpecImportProjection,
  projectSpecImport,
} from "./storage";
import {
  readCachedProfileBlobs,
  resetProfileCacheForTests,
  setProfileCacheIdentity,
  subscribeProfileCache,
  writeCachedProfileBlobs,
} from "./profileCache";

const parsed: ParsedSpecImport = {
  profiles: [{
    brand: "Acme",
    flavor: "Cheese",
    dieType: "12 inch",
    sauceOzPerPizza: 4,
    applicators: [],
    pepperonis: [],
  }],
  recipes: [],
};

describe("spec import projection", () => {
  beforeEach(() => {
    resetProfileCacheForTests();
    localStorage.clear();
  });

  it("does not write browser storage, enqueue profile sync, or dispatch events", () => {
    localStorage.setItem("sentinel", "unchanged");
    const before = [...Array(localStorage.length)].map((_, index) => [
      localStorage.key(index),
      localStorage.getItem(localStorage.key(index)!),
    ]);
    const storageSet = vi.spyOn(Storage.prototype, "setItem");
    const storageRemove = vi.spyOn(Storage.prototype, "removeItem");
    const dispatch = vi.spyOn(window, "dispatchEvent");

    const projection = projectSpecImport(parsed);

    expect(projection.profileRows).toHaveLength(1);
    expect(projection.profileRows[0]?.values.sauceOzPerPizza).toBe(4);
    expect([...Array(localStorage.length)].map((_, index) => [
      localStorage.key(index),
      localStorage.getItem(localStorage.key(index)!),
    ])).toEqual(before);
    expect(storageSet).not.toHaveBeenCalled();
    expect(storageRemove).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(localStorage.getItem("run-calc-profile-acme__cheese")).toBeNull();

    adoptSpecImportProjection(projection);
    expect(JSON.parse(localStorage.getItem("run-calc-profile-acme__cheese") ?? "{}"))
      .toMatchObject({ sauceOzPerPizza: 4 });
    storageSet.mockRestore();
    storageRemove.mockRestore();
    dispatch.mockRestore();
  });

  it("does not mutate or notify the active scoped profile cache", () => {
    setProfileCacheIdentity({ userId: "manager-1", scope: "live" });
    writeCachedProfileBlobs("acme__cheese", {
      dough: JSON.stringify({ frontlineRecipeName: "Old Sauce" }),
      crust: "{}",
    });
    const before = readCachedProfileBlobs("acme__cheese");
    const listener = vi.fn();
    const unsubscribe = subscribeProfileCache(listener);

    const projection = projectSpecImport(parsed);

    expect(readCachedProfileBlobs("acme__cheese")).toEqual(before);
    expect(listener).not.toHaveBeenCalled();
    expect(projection.profileRows[0]?.values).toMatchObject({
      frontlineRecipeName: "Old Sauce",
      sauceOzPerPizza: 4,
    });

    adoptSpecImportProjection(projection);
    expect(JSON.parse(readCachedProfileBlobs("acme__cheese").dough ?? "{}"))
      .toMatchObject({ frontlineRecipeName: "Old Sauce", sauceOzPerPizza: 4 });
    unsubscribe();
  });
});