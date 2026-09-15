import type { Client } from "pg";
import { describe, expect, it, vi } from "vitest";
import { cleanupTestUsers } from "../e2e/isolation";

describe("cleanupTestUsers", () => {
  it("keeps SQL-shaped usernames out of the query text", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db = { query } as unknown as Client;
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