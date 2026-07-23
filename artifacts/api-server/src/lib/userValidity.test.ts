// Unit tests for getUserSecurityState's cold-DB path.
//
// getUserSecurityState caches per-user DB results for a short TTL. If a future
// change were to replace the cold-cache DB query with a hardcoded default
// (e.g. always returning { exists: true, passwordChangedAtMs: 0 }), the function
// would still produce a plausible-looking value — but the DB would never be
// consulted, silently bypassing the "is this user still active?" check that
// requireAuth relies on to reject removed-staff sessions and stolen tokens.
//
// These tests spy on getUserById and assert exact call counts so that a
// hardcoded-default regression (callCount → 0 on a cold cache) fails immediately
// and visibly instead of silently passing.
//
// Symmetric gap this catches: the sandboxRequireAuth integration tests assert
// that getUserById is called TWICE per cold-cache request (once from userValidity,
// once from sandbox.ts). If getUserSecurityState stopped querying the DB, the
// count would drop from 2 to 1 — still non-zero, so those tests would still pass.
// This file tests getUserSecurityState in isolation, making the regression
// immediately visible as callCount === 0 instead of the expected 1.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Compile-time guard: if getUserById is renamed in users.ts, TypeScript will
// error here — turning a silent spy-wiring break (where vi.spyOn would silently
// target a missing key and all call-count assertions pass vacuously at 0) into
// a visible build error caught at typecheck time.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AssertGetUserByIdExported = (typeof usersMod)["getUserById"];

let userRow: { id: string; passwordChangedAt: Date | null } | undefined;
let throwOnQuery = false;

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => {
          if (throwOnQuery) throw new Error("db down");
          return userRow !== undefined ? [userRow] : [];
        },
      }),
    }),
  },
  usersTable: { id: "id" },
}));

vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  return { ...actual, eq: () => ({}) };
});

import { getUserSecurityState, clearUserValidityCache, revokeUser } from "./userValidity";
import * as usersMod from "./users";

beforeEach(() => {
  userRow = { id: "user-1", passwordChangedAt: null };
  throwOnQuery = false;
  clearUserValidityCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getUserSecurityState — DB is actually queried on cold cache (guards against hardcoded-default bypass)", () => {
  it("calls getUserById exactly once on a cold-cache request", async () => {
    // If getUserSecurityState were changed to return a hardcoded default without
    // querying the DB, callCount would be 0 here — caught immediately.
    let callCount = 0;
    const origGetUserById = usersMod.getUserById;
    const spy = vi.spyOn(usersMod, "getUserById").mockImplementation(async (id: string) => {
      callCount++;
      return origGetUserById(id);
    });

    try {
      const result = await getUserSecurityState("user-1");
      expect(callCount).toBe(1);
      expect(result.exists).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("does NOT call getUserById again on a second call within the TTL (cache hit)", async () => {
    // Proves caching is working: the second call must serve from the in-process
    // cache without touching the DB.
    let callCount = 0;
    const origGetUserById = usersMod.getUserById;
    const spy = vi.spyOn(usersMod, "getUserById").mockImplementation(async (id: string) => {
      callCount++;
      return origGetUserById(id);
    });

    try {
      // Cold: must hit the DB.
      await getUserSecurityState("user-1");
      expect(callCount).toBe(1);

      // Warm (within TTL): must NOT hit the DB again — count stays at 1.
      await getUserSecurityState("user-1");
      expect(callCount).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("calls getUserById exactly once more after the cache is cleared", async () => {
    // After cache eviction (e.g. revokeUser / clearUserValidityCache / TTL expiry),
    // the next call must go back to the DB — count increments again.
    let callCount = 0;
    const origGetUserById = usersMod.getUserById;
    const spy = vi.spyOn(usersMod, "getUserById").mockImplementation(async (id: string) => {
      callCount++;
      return origGetUserById(id);
    });

    try {
      // First cold request.
      await getUserSecurityState("user-1");
      expect(callCount).toBe(1);

      // Evict the cache (simulates TTL lapse or explicit revocation).
      clearUserValidityCache();

      // Second cold request: must consult the DB again.
      await getUserSecurityState("user-1");
      expect(callCount).toBe(2);
    } finally {
      spy.mockRestore();
    }
  });

  it("returns exists=true and passwordChangedAtMs=0 when the user has no passwordChangedAt", async () => {
    userRow = { id: "user-1", passwordChangedAt: null };
    const result = await getUserSecurityState("user-1");
    expect(result.exists).toBe(true);
    expect(result.passwordChangedAtMs).toBe(0);
  });

  it("returns exists=false when the user is not found in the DB", async () => {
    userRow = undefined;
    const result = await getUserSecurityState("user-1");
    expect(result.exists).toBe(false);
  });

  it("returns passwordChangedAtMs matching the user's passwordChangedAt timestamp", async () => {
    const changedAt = new Date("2026-06-01T12:00:00Z");
    userRow = { id: "user-1", passwordChangedAt: changedAt };
    const result = await getUserSecurityState("user-1");
    expect(result.passwordChangedAtMs).toBe(changedAt.getTime());
  });
});

describe("getUserSecurityState — DB-error fallback (guards against fail-open bypassing the cached value)", () => {
  it("returns the cached { exists: false } entry when the DB throws and a stale cache entry exists", async () => {
    // Use fake timers so we fully control Date.now() throughout this test.
    vi.useFakeTimers();

    // Warm the cache with a revoked (exists: false) entry. revokeUser writes
    // { exists: false, at: Date.now() } directly, which is used as the stale
    // TTL anchor. A manager removing a staff member calls this path.
    revokeUser("user-1");

    // Advance fake time past the 15-second cache TTL so the entry is stale.
    // This is required to force getUserSecurityState PAST the early cache-hit
    // return on line 26 (`if (cached && now - cached.at < CACHE_TTL_MS)`) and
    // into the DB query path — and then into the catch block when throwOnQuery
    // is true. Without this advance the function returns from the early hit and
    // never reaches the catch block, giving a false-positive test.
    vi.advanceTimersByTime(16_000);

    // Force every DB query to throw to simulate a transient outage.
    throwOnQuery = true;

    // Spy on getUserById to prove the catch block was actually reached (DB was
    // attempted). If the function were hardcoded to return the cold default
    // without entering the catch block, this spy count would be 1 but exists
    // would be true — caught by the assertion below.
    let callCount = 0;
    const origGetUserById = usersMod.getUserById;
    const spy = vi.spyOn(usersMod, "getUserById").mockImplementation(async (id: string) => {
      callCount++;
      return origGetUserById(id);
    });

    try {
      const result = await getUserSecurityState("user-1");

      // DB must have been attempted: proves the TTL advance worked and the catch
      // block was entered, not the early cache-hit path.
      expect(callCount).toBe(1);

      // The critical assertion: the catch block must return the stale cached
      // { exists: false } entry, NOT the cold-cache fail-open default
      // { exists: true, passwordChangedAtMs: 0 }. If the catch block were
      // changed to always return the cold default (ignoring the cached entry),
      // this assertion fails — making the bypass immediately visible.
      expect(result.exists).toBe(false);

      // Counter-proof: confirm the fail-open default was NOT returned. If it
      // had been, exists would be true — silently re-admitting the revoked user.
      expect(result.exists).not.toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("returns the cold-cache fail-open default { exists: true, passwordChangedAtMs: 0 } when the DB throws and no cache entry exists", async () => {
    // Cache is already cleared by beforeEach — there is no prior entry for this
    // user id. Force every DB query to throw.
    throwOnQuery = true;

    // Spy to confirm the DB was actually attempted (the catch path was reached,
    // not an early cache-hit return). On a cold cache no early return fires, so
    // the spy count must be 1.
    let callCount = 0;
    const origGetUserById = usersMod.getUserById;
    const spy = vi.spyOn(usersMod, "getUserById").mockImplementation(async (id: string) => {
      callCount++;
      return origGetUserById(id);
    });

    try {
      const result = await getUserSecurityState("user-1");

      // DB must have been attempted: proves the catch block was entered.
      expect(callCount).toBe(1);

      // Without a cached entry the function must fall back to the safe-open
      // default so a transient DB blip never logs out a legitimate user who has
      // never been seen before.
      expect(result).toStrictEqual({ exists: true, passwordChangedAtMs: 0 });
    } finally {
      spy.mockRestore();
    }
  });
});
