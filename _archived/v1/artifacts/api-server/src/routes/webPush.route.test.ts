import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  logInfo: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: { insert: mocks.insert },
  webPushSubscriptionsTable: {
    id: {},
    scope: {},
    userId: {},
    endpoint: {},
    p256dh: {},
    auth: {},
    expiresAt: {},
    enabled: {},
    lastSeenAt: {},
    updatedAt: {},
    createdAt: {},
  },
}));

vi.mock("../lib/requestScope", () => ({
  currentScope: () => "test-scope",
}));

vi.mock("../lib/logger", () => ({
  logger: { info: mocks.logInfo },
}));

import router from "./webPush";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = "test-user";
    next();
  });
  app.use(router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  mocks.insert.mockClear();
  mocks.logInfo.mockClear();
});

afterAll(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("POST /web-push/subscriptions endpoint validation", () => {
  it("returns the existing 400 contract before inserting an unapproved endpoint", async () => {
    const response = await fetch(`${baseUrl}/web-push/subscriptions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        endpoint: "https://fcm.googleapis.com.attacker.example/push/token",
        keys: { p256dh: "a".repeat(32), auth: "b".repeat(16) },
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid push subscription" });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("logs only bounded rejection classifications, never host, endpoint, or subscription keys", async () => {
    const rejectedHost = "push.apple.com";
    const endpoint = `https://${rejectedHost}/private-registration-token-unique`;
    const p256dh = "private-p256dh-key-unique-value";
    const auth = "private-auth-key-unique-value";
    const response = await fetch(`${baseUrl}/web-push/subscriptions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        endpoint,
        keys: { p256dh, auth },
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid push subscription" });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.logInfo).toHaveBeenCalledOnce();
    expect(mocks.logInfo).toHaveBeenCalledWith({
      event: "web_push_registration_rejected",
      outcome: "rejected",
      reason: "unsupported_provider",
      provider: "apple",
    }, "Web push subscription registration rejected");

    const serializedLog = JSON.stringify(mocks.logInfo.mock.calls);
    for (const privateValue of [rejectedHost, endpoint, p256dh, auth, "private-registration-token-unique"]) {
      expect(serializedLog).not.toContain(privateValue);
    }
  });

  it("records expired subscriptions with the same bounded event shape", async () => {
    const endpoint = "https://fcm.googleapis.com/fcm/send/private-expired-endpoint";
    const p256dh = "private-expired-p256dh-key-value";
    const auth = "private-expired-auth-key-value";
    const response = await fetch(`${baseUrl}/web-push/subscriptions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        endpoint,
        keys: { p256dh, auth },
        expirationTime: 1,
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Subscription has expired" });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.logInfo).toHaveBeenCalledWith({
      event: "web_push_registration_rejected",
      outcome: "rejected",
      reason: "expired_subscription",
      provider: "google",
    }, "Web push subscription registration rejected");

    const serializedLog = JSON.stringify(mocks.logInfo.mock.calls);
    for (const privateValue of [endpoint, p256dh, auth, "private-expired-endpoint"]) {
      expect(serializedLog).not.toContain(privateValue);
    }
  });
});
