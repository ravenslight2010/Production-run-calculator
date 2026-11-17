import { afterEach, describe, expect, it, vi } from "vitest";
import {
  enableWebPush,
  fetchVapidPublicKey,
  getWebPushStatus,
  listPushSubscriptions,
  recoverWebPush,
  vapidKeyToUint8Array,
} from "./webPush";

describe("web push client helpers", () => {
  afterEach(() => vi.unstubAllGlobals());

  function installPushBrowser(existingSubscription: PushSubscription | null) {
    const subscribe = vi.fn();
    const getSubscription = vi.fn().mockResolvedValue(existingSubscription);
    const registration = {
      active: { state: "activated" },
      pushManager: { getSubscription, subscribe },
    };
    const getRegistration = vi.fn().mockResolvedValue(registration);
    const notification = Object.assign(vi.fn(), {
      permission: "granted",
      requestPermission: vi.fn().mockResolvedValue("granted"),
    });
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {
      isSecureContext: true,
      Notification: notification,
      PushManager: vi.fn(),
      atob: globalThis.atob,
    });
    vi.stubGlobal("navigator", {
      serviceWorker: { ready: Promise.resolve(registration), getRegistration },
    });
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    return { registration, subscribe, getSubscription, getRegistration, storage };
  }

  it("converts URL-safe VAPID public keys", () => {
    expect(Array.from(vapidKeyToUint8Array("AQI_"))).toEqual([1, 2, 63]);
  });

  it("uses authenticated same-origin raw requests for subscription APIs", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ publicKey: "key" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ subscriptions: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchVapidPublicKey()).resolves.toBe("key");
    await expect(listPushSubscriptions()).resolves.toEqual([]);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/web-push/vapid-public-key");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "same-origin" });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/web-push/subscriptions");
  });

  it("keeps the current browser subscription when the server rejects its registration", async () => {
    const unsubscribe = vi.fn().mockResolvedValue(true);
    const current = {
      unsubscribe,
      toJSON: () => ({ endpoint: "https://push.example/old" }),
    } as unknown as PushSubscription;
    const { storage } = installPushBrowser(current);
    storage.set("run-calculator.web-push-subscription-id.v1", "saved-device-id");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Invalid push subscription" }), { status: 400 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await enableWebPush("AQI_");

    expect(result).toMatchObject({
      state: "error",
      registrationRejected: true,
      subscriptionWasExisting: true,
      subscription: current,
      subscriptionId: "saved-device-id",
    });
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST" });
    expect(storage.get("run-calculator.web-push-subscription-id.v1")).toBe("saved-device-id");
    expect(storage.get("run-calculator.web-push-registration-rejected.v1")).toBe("1");
  });

  it("restores the recovery state after reloading while the browser subscription still exists", async () => {
    const current = {
      toJSON: () => ({ endpoint: "https://push.example/old" }),
    } as unknown as PushSubscription;
    const { storage } = installPushBrowser(current);
    storage.set("run-calculator.web-push-subscription-id.v1", "saved-device-id");
    storage.set("run-calculator.web-push-registration-rejected.v1", "1");

    await expect(getWebPushStatus()).resolves.toMatchObject({
      state: "error",
      registrationRejected: true,
      subscription: current,
      subscriptionId: "saved-device-id",
      subscriptionWasExisting: true,
    });
  });

  it("clears the rejection marker when the browser subscription no longer exists", async () => {
    const { storage } = installPushBrowser(null);
    storage.set("run-calculator.web-push-registration-rejected.v1", "1");

    await expect(getWebPushStatus()).resolves.toMatchObject({ state: "available", subscription: null });
    expect(storage.has("run-calculator.web-push-registration-rejected.v1")).toBe(false);
  });

  it("clears the rejection marker after a successful registration", async () => {
    const current = {
      toJSON: () => ({ endpoint: "https://push.example/old" }),
    } as unknown as PushSubscription;
    const { storage } = installPushBrowser(current);
    storage.set("run-calculator.web-push-registration-rejected.v1", "1");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "registered-device-id" }), {
      status: 201,
    })));

    await expect(enableWebPush("AQI_")).resolves.toMatchObject({
      state: "enabled",
      subscription: current,
      subscriptionId: "registered-device-id",
    });
    expect(storage.has("run-calculator.web-push-registration-rejected.v1")).toBe(false);
  });

  it("replaces the device subscription only when recovery is explicitly requested", async () => {
    const events: string[] = [];
    const current = {
      unsubscribe: vi.fn(async () => { events.push("unsubscribe old"); return true; }),
      toJSON: () => ({ endpoint: "https://push.example/old" }),
    } as unknown as PushSubscription;
    const replacement = {
      toJSON: () => ({ endpoint: "https://push.example/new" }),
    } as unknown as PushSubscription;
    const { subscribe, storage } = installPushBrowser(current);
    storage.set("run-calculator.web-push-subscription-id.v1", "saved-device-id");
    storage.set("run-calculator.web-push-registration-rejected.v1", "1");
    subscribe.mockImplementation(async () => {
      events.push("subscribe new");
      return replacement;
    });
    const fetchMock = vi.fn()
      .mockImplementationOnce(async (_url: string, init?: RequestInit) => {
        events.push(`request ${init?.method}`);
        return new Response(null, { status: 204 });
      })
      .mockImplementationOnce(async (_url: string, init?: RequestInit) => {
        events.push(`request ${init?.method}`);
        return new Response(JSON.stringify({ id: "fresh-device-id" }), { status: 201 });
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await recoverWebPush("AQI_", current, "saved-device-id", true);

    expect(result).toMatchObject({
      state: "enabled",
      subscription: replacement,
      subscriptionId: "fresh-device-id",
    });
    expect(events).toEqual([
      "request DELETE",
      "unsubscribe old",
      "subscribe new",
      "request POST",
    ]);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/web-push/subscriptions/saved-device-id");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/web-push/subscriptions");
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST" });
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("notification-prefs"))).toBe(true);
    expect(storage.get("run-calculator.web-push-subscription-id.v1")).toBe("fresh-device-id");
    expect(storage.has("run-calculator.web-push-registration-rejected.v1")).toBe(false);
  });

  it("leaves the current subscription intact when the saved server registration cannot be revoked", async () => {
    const unsubscribe = vi.fn().mockResolvedValue(true);
    const current = {
      unsubscribe,
      toJSON: () => ({ endpoint: "https://push.example/old" }),
    } as unknown as PushSubscription;
    const { storage, subscribe } = installPushBrowser(current);
    storage.set("run-calculator.web-push-subscription-id.v1", "saved-device-id");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Request failed" }), { status: 503 }),
    ));

    const result = await recoverWebPush("AQI_", current, "saved-device-id", true);

    expect(result).toMatchObject({ state: "error", subscription: current, subscriptionId: "saved-device-id" });
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(storage.get("run-calculator.web-push-subscription-id.v1")).toBe("saved-device-id");
  });

  it("refuses to replace a previously saved subscription when its server ID is unknown", async () => {
    const unsubscribe = vi.fn().mockResolvedValue(true);
    const current = {
      unsubscribe,
      toJSON: () => ({ endpoint: "https://push.example/old" }),
    } as unknown as PushSubscription;
    const { subscribe } = installPushBrowser(current);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await recoverWebPush("AQI_", current, undefined, true);

    expect(result).toMatchObject({ state: "error", subscription: current });
    expect(result.error).toContain("cannot be identified safely");
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
