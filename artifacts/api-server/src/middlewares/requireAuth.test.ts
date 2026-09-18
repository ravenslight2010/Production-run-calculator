import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyToken } = vi.hoisted(() => ({
  verifyToken: vi.fn(),
}));
const { getSessionBoundaryMs } = vi.hoisted(() => ({
  getSessionBoundaryMs: vi.fn(async () => 0),
}));
const { getUserSecurityState } = vi.hoisted(() => ({
  getUserSecurityState: vi.fn(async () => ({
    exists: true,
    passwordChangedAtMs: 0,
  })),
}));

vi.mock("../lib/auth", () => ({
  SESSION_COOKIE: "rc_auth",
  verifyToken,
}));
vi.mock("../lib/sessionBoundary", () => ({
  getSessionBoundaryMs,
}));
vi.mock("../lib/userValidity", () => ({
  getUserSecurityState,
}));
vi.mock("../lib/sandbox", () => ({
  isSandboxUser: vi.fn(async () => false),
  sandboxAllowed: vi.fn(() => true),
}));
vi.mock("../lib/requestScope", () => ({
  runWithScope: vi.fn((_scope: string, next: () => void) => next()),
}));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn() },
}));

import { requireAuth } from "./requireAuth";

function response() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
  };
}

describe("requireAuth failure safety", () => {
  beforeEach(() => {
    verifyToken.mockReset();
    getSessionBoundaryMs.mockReset().mockResolvedValue(0);
    getUserSecurityState.mockReset().mockResolvedValue({
      exists: true,
      passwordChangedAtMs: 0,
    });
  });

  it("rejects a missing session with a JSON 401 and never reaches the mutation", async () => {
    verifyToken.mockReturnValue(null);
    const req = { headers: {}, cookies: {} } as any;
    const res = response();
    const next = vi.fn();

    await requireAuth(req, res as any, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: "Unauthorized",
      reason: "session_expired",
      correlationId: expect.any(String),
    }));
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
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: "Unauthorized",
      reason: "session_expired",
      correlationId: expect.any(String),
    }));
    expect(next).not.toHaveBeenCalled();
  });

  it("identifies a daily rollover while keeping other expiry causes generic", async () => {
    verifyToken.mockReturnValue({ sub: "opaque-user", iat: 10 });
    getSessionBoundaryMs.mockResolvedValue(20_000);
    const req = {
      id: "request-123",
      method: "GET",
      path: "/me",
      headers: { authorization: "Bearer opaque-token" },
      cookies: {},
    } as any;
    const res = response();

    await requireAuth(req, res as any, vi.fn());

    expect(res.setHeader).toHaveBeenCalledWith("X-Correlation-ID", "request-123");
    expect(res.json).toHaveBeenCalledWith({
      error: "Unauthorized",
      reason: "daily_reset",
      correlationId: "request-123",
    });
  });

  it.each([
    ["missing user", { exists: false, passwordChangedAtMs: 0 }],
    ["password session invalidation", { exists: true, passwordChangedAtMs: 11_000 }],
  ])("does not disclose %s as a distinct public reason", async (_label, security) => {
    verifyToken.mockReturnValue({ sub: "opaque-user", iat: 10 });
    getUserSecurityState.mockResolvedValue(security);
    const req = { headers: {}, cookies: {} } as any;
    const res = response();

    await requireAuth(req, res as any, vi.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: "Unauthorized",
      reason: "session_expired",
    }));
  });
});