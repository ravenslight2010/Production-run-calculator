import type { Request, Response, NextFunction } from "express";
import { SESSION_COOKIE, verifyToken } from "../lib/auth";
import { getSessionBoundaryMs } from "../lib/sessionBoundary";
import { getUserSecurityState } from "../lib/userValidity";
import { isSandboxUser } from "../lib/sandbox";
import { runWithScope, type Scope } from "../lib/requestScope";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      // The authenticated user's data scope ("live" for everyone except the
      // seeded sandbox account). Mirrors the AsyncLocalStorage value the DB
      // helpers read via currentScope(); exposed on the request for handlers
      // that need it explicitly (e.g. the sandbox-reset gate).
      scope?: Scope;
    }
  }
}

// Extract the session token from either transport:
//  - Mobile (Expo): no cookie jar, so an `Authorization: Bearer <token>` header
//    is attached to every REST and SSE request.
//  - Web: an httpOnly `rc_auth` cookie is sent automatically on same-origin
//    requests (including native EventSource SSE connections).
function readToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length).trim();
    if (token) return token;
  }
  const cookieToken = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
  if (cookieToken) return cookieToken;
  return null;
}

// Rejects any request that does not carry a valid, unexpired session token, or
// whose token was issued before the latest daily reset (see sessionBoundary).
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = readToken(req);
  const verified = token ? verifyToken(token) : null;
  if (!verified) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  // Daily-reset fence: a token minted before today's reset boundary is no longer
  // valid, so the new production day starts from a re-authenticated state. This
  // is a single cached read, never a per-request DB query.
  //
  // `iat` is stamped in whole seconds (Math.floor(now/1000)), so a token's TRUE
  // issue time lies somewhere in [iat*1000, iat*1000 + 1000). The boundary
  // (dayState.resetAt) is full-millisecond. Comparing `iat*1000 < boundaryMs`
  // therefore wrongly fences a token that was actually issued in the SAME second
  // as — but slightly AFTER — the reset: the rollover stamps resetAt = Date.now()
  // (any time of day, whenever the first device opens the new day), and a user
  // signing in during that same second gets a 200 + cookie but is then 401'd on
  // every following request, silently bouncing back to login. Fence only when the
  // token's entire issuance second is before the boundary, so a fresh sign-in is
  // never rejected (the ~<1s of slack on a once-a-day boundary is harmless).
  const boundaryMs = await getSessionBoundaryMs();
  if (boundaryMs > 0 && (verified.iat + 1) * 1000 <= boundaryMs) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  // Removed-staff fence: tokens are stateless, so a deleted user's still-valid
  // token would otherwise keep working until it expires. Reject the request the
  // moment the account no longer exists (cached read; evicted on deletion).
  //
  // Password-change fence: tokens are stateless, so replacing a password (self
  // change, manager reset, or forgotten-password relay) would otherwise leave
  // any already-issued token — including one held by an attacker — working
  // until it naturally expires. Reject any token whose entire issuance second
  // is at or before the account's last password change (same `iat`-vs-boundary
  // slack rationale as the daily-reset fence above), so recovering an account
  // also cuts off whoever else was using it.
  const security = await getUserSecurityState(verified.sub);
  if (!security.exists) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (
    security.passwordChangedAtMs > 0 &&
    (verified.iat + 1) * 1000 <= security.passwordChangedAtMs
  ) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.userId = verified.sub;
  // Route every read/write for the seeded sandbox account into the isolated
  // "sandbox" scope; everyone else stays on "live". Running next() inside the
  // AsyncLocalStorage store makes the scope visible to every DB helper invoked
  // downstream (the store propagates across the handler's awaits).
  const scope: Scope = (await isSandboxUser(verified.sub)) ? "sandbox" : "live";
  req.scope = scope;
  runWithScope(scope, () => next());
}
