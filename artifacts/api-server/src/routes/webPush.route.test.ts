import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
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
});
