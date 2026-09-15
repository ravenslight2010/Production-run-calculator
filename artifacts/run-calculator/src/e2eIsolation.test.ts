import type { Client } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pgClients = vi.hoisted(() => [] as Array<{
  connect: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}>);
const pgMockState = vi.hoisted(() => ({
  nextQueryError: undefined as Error | undefined,
}));

vi.mock("pg", () => ({
  Client: vi.fn(function MockClient() {
    const query = pgMockState.nextQueryError
      ? vi.fn().mockRejectedValueOnce(pgMockState.nextQueryError)
      : vi.fn().mockResolvedValue({ rows: [] });
    pgMockState.nextQueryError = undefined;
    const client = {
      connect: vi.fn().mockResolvedValue(undefined),
      query,
      end: vi.fn().mockResolvedValue(undefined),
    };
    pgClients.push(client);
    return client;
  }),
}));

import {
  AuthorizedBrowserFixtures,
  authorizeFixtureAccount,
  cleanupBrandProfiles,
  cleanupCheeseRecipes,
  cleanupDailySync,
  cleanupFixtureRoles,
  cleanupMixes,
  cleanupNamedRecipes,
  cleanupTestUsers,
} from "../e2e/isolation";

const LIVE_FIXTURE_LOCK_BINDS = [0x4532_4546, 0x4c49_5645];

function mockedPlaywright() {
  const request = {
    dispose: vi.fn().mockResolvedValue(undefined),
  };
  return {
    playwright: {
      request: {
        newContext: vi.fn().mockResolvedValue(request),
      },
    },
    request,
  };
}

beforeEach(() => {
  pgClients.length = 0;
  pgMockState.nextQueryError = undefined;
  vi.clearAllMocks();
  vi.stubEnv("DATABASE_URL", "postgresql://postgres@127.0.0.1/browser_e2e");
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("APP_ENV", "");
  vi.stubEnv("REPLIT_DEPLOYMENT", "");
});

function mockedClient() {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  return {
    db: { query } as unknown as Client,
    query,
  };
}

describe("AuthorizedBrowserFixtures live fixture lock", () => {
  it("closes the lock client when lock acquisition fails", async () => {
    const { playwright, request } = mockedPlaywright();
    const lockError = new Error("fixture lock unavailable");
    pgMockState.nextQueryError = lockError;

    await expect(
      AuthorizedBrowserFixtures.create(
        playwright,
        "http://api.test",
        "signup-code",
      ),
    ).rejects.toBe(lockError);

    expect(pgClients[0].query).toHaveBeenCalledWith(
      "SELECT pg_advisory_lock($1, $2)",
      LIVE_FIXTURE_LOCK_BINDS,
    );
    expect(pgClients[0].end).toHaveBeenCalledOnce();
    expect(request.dispose).toHaveBeenCalledOnce();
  });

  it("unlocks with the matching binds before closing during disposal", async () => {
    const { playwright, request } = mockedPlaywright();
    const fixtures = await AuthorizedBrowserFixtures.create(
      playwright,
      "http://api.test",
      "signup-code",
    );
    const lockClient = pgClients[0];

    await fixtures.cleanup();

    expect(lockClient.query).toHaveBeenNthCalledWith(
      1,
      "SELECT pg_advisory_lock($1, $2)",
      LIVE_FIXTURE_LOCK_BINDS,
    );
    expect(lockClient.query).toHaveBeenNthCalledWith(
      2,
      "SELECT pg_advisory_unlock($1, $2)",
      LIVE_FIXTURE_LOCK_BINDS,
    );
    expect(lockClient.query.mock.invocationCallOrder[1]).toBeLessThan(
      lockClient.end.mock.invocationCallOrder[0],
    );
    expect(lockClient.end).toHaveBeenCalledOnce();
    expect(request.dispose).toHaveBeenCalledOnce();
  });
});

describe("cleanupTestUsers", () => {
  it("keeps SQL-shaped usernames out of the query text", async () => {
    const { db, query } = mockedClient();
    const usernames = [
      "fixture'; DROP TABLE users; --",
      "fixture' OR username IS NOT NULL; --",
    ];

    await cleanupTestUsers(db, usernames);

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls).toEqual([
      ["DELETE FROM users WHERE username = $1", [usernames[0]]],
      ["DELETE FROM users WHERE username = $1", [usernames[1]]],
    ]);
  });
});

describe("authorizeFixtureAccount", () => {
  it("binds SQL-shaped role names and user IDs without changing query text", async () => {
    const { db, query } = mockedClient();
    const roleName = "manager'); DROP TABLE roles; --";
    const userId = "user-id'); DELETE FROM users; --";
    const capabilities = ["manage-staff", "manage-profiles"] as const;

    await authorizeFixtureAccount(db, roleName, userId, capabilities, false);

    expect(query.mock.calls).toEqual([
      [
        `INSERT INTO roles (name, capabilities, builtin)
     VALUES ($1, $2::jsonb, false)`,
        [roleName, JSON.stringify([...capabilities])],
      ],
      [
        `INSERT INTO user_roles (user_id, role)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET role = $2, updated_at = NOW()`,
        [userId, roleName],
      ],
      [
        "UPDATE users SET onboarding_seen = $2 WHERE id = $1",
        [userId, false],
      ],
    ]);
  });
});

describe("browser fixture cleanup queries", () => {
  it("binds profile keys and scopes without changing query text", async () => {
    const { db, query } = mockedClient();
    const keys = ["profile'); DROP TABLE brand_profiles; --"];
    const scope = "live' OR scope <> 'live";

    await cleanupBrandProfiles(db, keys, scope);

    expect(query).toHaveBeenCalledWith(
      "DELETE FROM brand_profiles WHERE key = ANY($1::text[]) AND scope = $2",
      [keys, scope],
    );
  });

  it("binds sync dates and scopes without changing query text", async () => {
    const { db, query } = mockedClient();
    const dates = ["2026-09-15'); DELETE FROM daily_sync; --"];
    const scope = "live'; SELECT pg_sleep(10); --";

    await cleanupDailySync(db, dates, scope);

    expect(query).toHaveBeenCalledWith(
      "DELETE FROM daily_sync WHERE date = ANY($1::text[]) AND scope = $2",
      [dates, scope],
    );
  });

  it("binds cheese recipe IDs without changing query text", async () => {
    const { db, query } = mockedClient();
    const ids = ["cheese-id'); DROP TABLE cheese_recipes; --"];

    await cleanupCheeseRecipes(db, ids);

    expect(query).toHaveBeenCalledWith(
      "DELETE FROM cheese_recipes WHERE id = ANY($1::text[])",
      [ids],
    );
  });

  it.each(["dough", "sauce"] as const)(
    "binds %s recipe IDs without changing query text",
    async (kind) => {
      const { db, query } = mockedClient();
      const ids = [`${kind}-id'); DROP TABLE ${kind}_recipes; --`];

      await cleanupNamedRecipes(db, kind, ids);

      expect(query).toHaveBeenCalledWith(
        `DELETE FROM ${kind}_recipes WHERE id = ANY($1::text[]) AND scope = $2`,
        [ids, "live"],
      );
    },
  );

  it("rejects named recipe kinds outside the table allowlist", async () => {
    const { db, query } = mockedClient();
    const invalidKind = "dough; DROP TABLE users; --" as "dough";

    await expect(
      cleanupNamedRecipes(db, invalidKind, ["fixture-id"]),
    ).rejects.toThrow("Unsupported named recipe fixture kind");
    expect(query).not.toHaveBeenCalled();
  });

  it("binds mix IDs without changing query text", async () => {
    const { db, query } = mockedClient();
    const ids = ["mix-id'); DROP TABLE mixes; --"];

    await cleanupMixes(db, ids);

    expect(query).toHaveBeenCalledWith(
      "DELETE FROM mixes WHERE id = ANY($1::text[]) AND scope = $2",
      [ids, "live"],
    );
  });

  it("binds role names without changing query text", async () => {
    const { db, query } = mockedClient();
    const roleNames = ["manager'); DROP TABLE roles; --"];

    await cleanupFixtureRoles(db, roleNames);

    expect(query).toHaveBeenCalledWith(
      "DELETE FROM roles WHERE name = ANY($1::text[])",
      [roleNames],
    );
  });
});
