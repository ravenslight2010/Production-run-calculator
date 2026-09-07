import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchVapidPublicKey, listPushSubscriptions, vapidKeyToUint8Array } from "./webPush";

describe("web push client helpers", () => {
  afterEach(() => vi.unstubAllGlobals());

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
});