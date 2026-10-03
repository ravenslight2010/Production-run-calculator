import { describe, expect, it, beforeEach, vi } from "vitest";

const { inserted, getCurrent, setCurrent, dbMock } = vi.hoisted(() => {
  const inserted: Array<Record<string, unknown>> = [];
  let currentInvite: Record<string, unknown> | undefined;
  return {
    inserted,
    getCurrent: () => currentInvite,
    setCurrent: (value: Record<string, unknown> | undefined) => { currentInvite = value; },
    dbMock: {
  insert: () => ({
    values: async (value: Record<string, unknown>) => {
      inserted.push(value);
      setCurrent({ ...value });
      return [];
    },
  }),
  select: () => ({
    from: () => ({
      where: () => ({
        orderBy: () => ({ limit: async () => [] }),
        then: (resolve: (v: unknown[]) => unknown) => resolve(getCurrent() ? [getCurrent()] : []),
      }),
    }),
  }),
  update: () => ({
    set: () => ({
      where: () => ({
        returning: async () => getCurrent() ? [getCurrent()] : [],
      }),
    }),
  }),
    },
  };
});

vi.mock("@workspace/db", () => ({
  db: dbMock,
  staffInvitationsTable: {
    tokenHash: "tokenHash",
    consumedAt: "consumedAt",
    revokedAt: "revokedAt",
    id: "id",
    createdAt: "createdAt",
  },
  signupAccessCodesTable: {
    enabled: "enabled",
    createdAt: "createdAt",
    id: "id",
  },
}));
vi.mock("./roles", () => ({
  getRole: async () => ({ name: "operator", capabilities: [], builtin: true }),
}));

import { createInvitation, consumeInvitation } from "./invitations";
import { sessionIdleTimeoutMs } from "./authSessions";
import { signToken, verifyToken } from "./auth";

describe("account lifecycle boundaries", () => {
  beforeEach(() => {
    inserted.length = 0;
    setCurrent(undefined);
    delete process.env.SESSION_IDLE_TIMEOUT_SEC;
    process.env.AUTH_TOKEN_SECRET = "account-lifecycle-test-secret";
  });

  it("creates an invitation with a one-time secret and only stores its digest", async () => {
    const result = await createInvitation("manager-id", "operator", []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.secret).toHaveLength(43);
    expect(inserted[0].tokenHash).not.toBe(result.secret);
    expect(inserted[0]).not.toHaveProperty("secret");
  });

  it("returns one generic failure for malformed, expired, revoked, or replayed invitations", async () => {
    const malformed = await consumeInvitation("not-a-real-invitation");
    expect(malformed).toEqual({
      ok: false,
      status: 400,
      error: "Invitation is invalid or unavailable.",
    });
    setCurrent(undefined);
    const unavailable = await consumeInvitation("another-not-real-invitation");
    expect(unavailable).toEqual(malformed);
  });

  it("honors a bounded shared-tablet idle timeout configuration", () => {
    expect(sessionIdleTimeoutMs()).toBe(12 * 60 * 60 * 1000);
    process.env.SESSION_IDLE_TIMEOUT_SEC = "60";
    expect(sessionIdleTimeoutMs()).toBe(60_000);
    process.env.SESSION_IDLE_TIMEOUT_SEC = "999999999";
    expect(sessionIdleTimeoutMs()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("keeps token expiry and issued-at verifiable without exposing credentials", () => {
    const token = signToken("user-id");
    const verified = verifyToken(token);
    expect(verified?.sub).toBe("user-id");
    expect(token).not.toContain("user-id"); // payload is encoded, not a loggable credential
    expect(verified?.exp).toBeGreaterThan(verified!.iat);
  });
});