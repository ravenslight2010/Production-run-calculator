import { getUserById } from "./users";

// Tracks whether a session's subject still maps to an existing account, and
// when that account's password was last changed.
//
// Session tokens are stateless and self-contained (see lib/auth), so without
// this check a removed staff member's already-issued token keeps resolving to a
// valid userId until it naturally expires (up to 30 days) — and, worse, a
// stolen token would keep working even after the legitimate user (or a
// manager) recovers the account by changing its password. requireAuth runs on
// every request (including SSE), so we cache both facts together briefly to
// avoid a DB round-trip per request — mirroring the cached daily-reset boundary
// read. When a user is removed or their password changes we evict their entry
// immediately so their next request is rejected without waiting for the cache
// TTL to lapse.

const CACHE_TTL_MS = 15_000;
type Entry = { exists: boolean; passwordChangedAtMs: number; at: number };
const cache = new Map<string, Entry>();

export type UserSecurityState = { exists: boolean; passwordChangedAtMs: number };

export async function getUserSecurityState(userId: string): Promise<UserSecurityState> {
  const now = Date.now();
  const cached = cache.get(userId);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached;

  let exists: boolean;
  let passwordChangedAtMs: number;
  try {
    const user = await getUserById(userId);
    exists = user !== undefined;
    passwordChangedAtMs = user?.passwordChangedAt
      ? new Date(user.passwordChangedAt).getTime()
      : 0;
  } catch {
    // On a transient DB error fall back to the last known value if we have one,
    // else fail open so a database blip never logs out a legitimate user. A
    // freshly revoked user already has a cached `false` entry, so they stay out.
    if (cached) return cached;
    return { exists: true, passwordChangedAtMs: 0 };
  }
  const entry: Entry = { exists, passwordChangedAtMs, at: now };
  cache.set(userId, entry);
  return entry;
}

export async function userExists(userId: string): Promise<boolean> {
  return (await getUserSecurityState(userId)).exists;
}

// Called the moment a user is removed so any in-flight session is revoked on its
// very next request, independent of the cache TTL.
export function revokeUser(userId: string): void {
  cache.set(userId, { exists: false, passwordChangedAtMs: Date.now(), at: Date.now() });
}

// Called the moment a user's password is changed (self-service, manager reset,
// or forgotten-password relay) so any already-issued token — including a
// stolen one — is rejected on its very next request, independent of the cache
// TTL. The account still exists; only the password-changed watermark advances.
export function invalidateUserSessions(userId: string): void {
  const now = Date.now();
  const cached = cache.get(userId);
  cache.set(userId, { exists: cached?.exists ?? true, passwordChangedAtMs: now, at: now });
}

// Drops every cached existence result. Intended for tests, which reuse fixed
// user ids across cases against a shared module-level cache (production ids are
// UUIDs that are never reused, so this is unnecessary there).
export function clearUserValidityCache(): void {
  cache.clear();
}
