import { describe, expect, it, vi } from "vitest";

const { verifyToken } = vi.hoisted(() => ({
  verifyToken: vi.fn(),
}));

vi.mock("../lib/auth", () => ({
  SESSION_COOKIE: "rc_auth",
  verifyToken,
}));
vi.mock("../lib/sessionBoundary", () => ({
  getSessionBoundaryMs: vi.fn(async () => 0),
}));
vi.mock("../lib/userValidity", () => ({
  getUserSecurityState: vi.fn(async () => ({
    exists: true,
    passwordChangedAtMs: 0,
  })),
}));
vi.mock("../lib/sandbox", () => ({
  isSandboxUser: vi.fn(async () => false),
  sandboxAllowed: vi.fn(() => true),
}));
vi.mock("../lib/requestScope", () => ({
  runWithScope: vi.fn((_scope: string, next: () => void) => next()),
}));

import { requireAuth } from "./requireAuth";

function response() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

describe("requireAuth failure safety", () => {
  it("rejects a missing session with a JSON 401 and never reaches the mutation", async () => {
    verifyToken.mockReturnValue(null);
    const req = { headers: {}, cookies: {} } as any;
    const res = response();
    const next = vi.fn();

    await requireAuth(req, res as any, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" });
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects an expired or invalid token with the same safe response", async () => {
    verifyToken.mockReturnValue(null);
    const req = {
      headers: { authorization: "Bearer expired-token" },
      cookies: {},
    } as any;
    const res = response();
    const next = vi.fn();

    await requireAuth(req, res as any, next);

    expect(verifyToken).toHaveBeenCalledWith("expired-token");
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" });
    expect(next).not.toHaveBeenCalled();
  });
});