import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cachedProfileKeys,
  deleteCachedProfile,
  getProfileCacheGeneration,
  profileCacheGenerationIsCurrent,
  readCachedProfileBlobs,
  replaceCachedProfiles,
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
  it("keeps reads memory-only and clears them on user and scope changes", () => {
    setProfileCacheIdentity({ userId: "manager-a", scope: "live" });
    writeCachedProfileBlobs(KEY, { dough: '{"lineSpeed":10}', crust: "{}" });

    setProfileCacheIdentity({ userId: "manager-b", scope: "live" });
    expect(cachedProfileKeys()).toEqual([]);
    expect(readCachedProfileBlobs(KEY)).toEqual({ dough: null, crust: null });

    setProfileCacheIdentity({ userId: "manager-a", scope: "sandbox" });
    expect(cachedProfileKeys()).toEqual([]);

    setProfileCacheIdentity({ userId: "manager-a", scope: "live" });
    expect(readCachedProfileBlobs(KEY).dough).toBeNull();
    expect(localStorage.getItem("run-calc-profile-cache-v1:live:authenticated-facility:manager-a")).toBeNull();
  });

  it("fences server responses that began under an old identity", () => {
    setProfileCacheIdentity({ userId: "manager-a", scope: "live" });
    const oldGeneration = getProfileCacheGeneration();

    setProfileCacheIdentity({ userId: "manager-b", scope: "live" });

    expect(profileCacheGenerationIsCurrent(oldGeneration)).toBe(false);
    expect(profileCacheGenerationIsCurrent(getProfileCacheGeneration())).toBe(true);
  });

  it("rejects a stale server snapshot instead of repopulating the active identity", () => {
    setProfileCacheIdentity({ userId: "manager-a", scope: "live" });
    writeCachedProfileBlobs(KEY, { dough: '{"lineSpeed":10}' });
    const oldGeneration = getProfileCacheGeneration();

    setProfileCacheIdentity({ userId: "manager-b", scope: "live" });
    writeCachedProfileBlobs(KEY, { dough: '{"lineSpeed":20}' });

    expect(
      replaceCachedProfiles(
        new Map([[KEY, { dough: '{"lineSpeed":10}', crust: null }]]),
        oldGeneration,
      ),
    ).toBe(false);
    expect(readCachedProfileBlobs(KEY)).toEqual({
      dough: '{"lineSpeed":20}',
      crust: null,
    });
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

  it("preserves unowned legacy profiles without assigning them to the next login", () => {
    localStorage.setItem("run-calc-profile-acme__pepperoni", '{"lineSpeed":5}');
    localStorage.setItem("run-calc-crust-profile-acme__pepperoni", "{}");

    setProfileCacheIdentity({ userId: "legacy-owner", scope: "live" });
    expect(readCachedProfileBlobs(KEY).dough).toBeNull();
    expect(localStorage.getItem("run-calc-profile-acme__pepperoni")).toBe('{"lineSpeed":5}');
    expect(localStorage.getItem("run-calc-crust-profile-acme__pepperoni")).toBe("{}");

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
    expect(readCachedProfileBlobs(KEY).dough).toBeNull();
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