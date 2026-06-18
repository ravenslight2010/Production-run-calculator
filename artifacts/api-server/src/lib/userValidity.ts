import { getUserById } from "./users";

// Tracks whether a session's subject still maps to an existing account.
//
// Session tokens are stateless and self-contained (see lib/auth), so without
// this check a removed staff member's already-issued token keeps resolving to a
// valid userId until it naturally expires (up to 30 days). requireAuth runs on
// every request (including SSE), so we cache the existence result briefly to
// avoid a DB round-trip per request — mirroring the cached daily-reset boundary
// read. When a user is removed we evict their entry immediately so their next
// request is rejected without waiting for the cache TTL to lapse.

const CACHE_TTL_MS = 15_000;
type Entry = { exists: boolean; at: number };
const cache = new Map<string, Entry>();

export async function userExists(userId: string): Promise<boolean> {
  const now = Date.now();
  const cached = cache.get(userId);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.exists;

  let exists: boolean;
  try {
    exists = (await getUserById(userId)) !== undefined;
  } catch {
    // On a transient DB error fall back to the last known value if we have one,
    // else fail open so a database blip never logs out a legitimate user. A
    // freshly revoked user already has a cached `false` entry, so they stay out.
    if (cached) return cached.exists;
    return true;
  }
  cache.set(userId, { exists, at: now });
  return exists;
}

// Called the moment a user is removed so any in-flight session is revoked on its
// very next request, independent of the cache TTL.
export function revokeUser(userId: string): void {
  cache.set(userId, { exists: false, at: Date.now() });
}

// Drops every cached existence result. Intended for tests, which reuse fixed
// user ids across cases against a shared module-level cache (production ids are
// UUIDs that are never reused, so this is unnecessary there).
export function clearUserValidityCache(): void {
  cache.clear();
}
