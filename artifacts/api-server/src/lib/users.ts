import { eq, sql } from "drizzle-orm";
import { db, usersTable, type User } from "@workspace/db";
import { hashPassword, newUserId } from "./auth";

export type PublicUser = { id: string; username: string };

function normalizeUsername(username: string): string {
  return username.trim();
}

export async function findUserByUsername(username: string): Promise<User | undefined> {
  const handle = normalizeUsername(username);
  const [row] = await db
    .select()
    .from(usersTable)
    .where(sql`lower(${usersTable.username}) = lower(${handle})`);
  return row;
}

export async function getUserById(id: string): Promise<User | undefined> {
  const [row] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  return row;
}

// Creates a new account. Returns { ok: false } when the username is already
// taken (case-insensitive) so the route can surface a clean 409.
export async function createUser(
  username: string,
  password: string,
): Promise<{ ok: true; user: User } | { ok: false; reason: "taken" }> {
  const handle = normalizeUsername(username);
  const existing = await findUserByUsername(handle);
  if (existing) return { ok: false, reason: "taken" };

  try {
    const [row] = await db
      .insert(usersTable)
      .values({ id: newUserId(), username: handle, passwordHash: hashPassword(password) })
      .returning();
    return { ok: true, user: row };
  } catch (err) {
    // Unique-violation race: another request created the same username between
    // the check and the insert.
    if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "23505") {
      return { ok: false, reason: "taken" };
    }
    throw err;
  }
}
