import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cachedProfileKeys,
  deleteCachedProfile,
  getProfileCacheGeneration,
  profileCacheGenerationIsCurrent,
  readCachedProfileBlobs,
  resetProfileCacheForTests,
  setProfileCacheIdentity,
  subscribeProfileCache,
  writeCachedProfileBlobs,
} from "./profileCache";

const KEY = "acme__pepperoni";

beforeEach(() => {
  localStorage.clear();
  resetProfileCacheForTests();
});

describe("profile cache identity", () => {
  it("keeps durable offline snapshots isolated by user and scope", () => {
    setProfileCacheIdentity({ userId: "manager-a", scope: "live" });
    writeCachedProfileBlobs(KEY, { dough: '{"lineSpeed":10}', crust: "{}" });

    setProfileCacheIdentity({ userId: "manager-b", scope: "live" });
    expect(cachedProfileKeys()).toEqual([]);
    expect(readCachedProfileBlobs(KEY)).toEqual({ dough: null, crust: null });

    setProfileCacheIdentity({ userId: "manager-a", scope: "sandbox" });
    expect(cachedProfileKeys()).toEqual([]);

    setProfileCacheIdentity({ userId: "manager-a", scope: "live" });
    expect(readCachedProfileBlobs(KEY).dough).toBe('{"lineSpeed":10}');
  });

  it("fences server responses that began under an old identity", () => {
    setProfileCacheIdentity({ userId: "manager-a", scope: "live" });
    const oldGeneration = getProfileCacheGeneration();

    setProfileCacheIdentity({ userId: "manager-b", scope: "live" });

    expect(profileCacheGenerationIsCurrent(oldGeneration)).toBe(false);
    expect(profileCacheGenerationIsCurrent(getProfileCacheGeneration())).toBe(true);
  });

  it("notifies subscribers for writes and deletes", () => {
    setProfileCacheIdentity({ userId: "manager-a", scope: "live" });
    const listener = vi.fn();
    const unsubscribe = subscribeProfileCache(listener);

    writeCachedProfileBlobs(KEY, { dough: "{}", crust: "{}" });
    deleteCachedProfile(KEY);
    unsubscribe();
    writeCachedProfileBlobs(KEY, { dough: "{}" });

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("imports unscoped legacy profiles only into the first authenticated scope", () => {
    localStorage.setItem("run-calc-profile-acme__pepperoni", '{"lineSpeed":5}');
    localStorage.setItem("run-calc-crust-profile-acme__pepperoni", "{}");

    setProfileCacheIdentity({ userId: "legacy-owner", scope: "live" });
    expect(readCachedProfileBlobs(KEY).dough).toBe('{"lineSpeed":5}');
    expect(localStorage.getItem("run-calc-profile-acme__pepperoni")).toBeNull();
    expect(localStorage.getItem("run-calc-crust-profile-acme__pepperoni")).toBeNull();

    setProfileCacheIdentity({ userId: "other-user", scope: "live" });
    expect(readCachedProfileBlobs(KEY).dough).toBeNull();
  });

  it("does not expose one authenticated user's writes to another identity", () => {
    setProfileCacheIdentity({ userId: "manager-a", scope: "live" });
    writeCachedProfileBlobs(KEY, { dough: '{"lineSpeed":14}' });
    expect(localStorage.getItem("run-calc-profile-acme__pepperoni")).toBeNull();

    setProfileCacheIdentity({ userId: "manager-b", scope: "live" });
    expect(readCachedProfileBlobs(KEY).dough).toBeNull();

    setProfileCacheIdentity({ userId: "manager-a", scope: "live" });
    expect(readCachedProfileBlobs(KEY).dough).toBe('{"lineSpeed":14}');
  });

  it("does not resurrect a deleted scoped profile from its legacy migration source", () => {
    localStorage.setItem("run-calc-profile-acme__pepperoni", '{"lineSpeed":5}');
    setProfileCacheIdentity({ userId: "legacy-owner", scope: "live" });
    deleteCachedProfile(KEY);

    setProfileCacheIdentity(null);
    setProfileCacheIdentity({ userId: "legacy-owner", scope: "live" });

    expect(readCachedProfileBlobs(KEY).dough).toBeNull();
  });
});