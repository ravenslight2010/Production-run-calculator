import type { Request, Response, NextFunction } from "express";
import { SESSION_COOKIE, verifyToken } from "../lib/auth";
import { getSessionBoundaryMs } from "../lib/sessionBoundary";
import { userExists } from "../lib/userValidity";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
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
  const boundaryMs = await getSessionBoundaryMs();
  if (boundaryMs > 0 && verified.iat * 1000 < boundaryMs) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  // Removed-staff fence: tokens are stateless, so a deleted user's still-valid
  // token would otherwise keep working until it expires. Reject the request the
  // moment the account no longer exists (cached read; evicted on deletion).
  if (!(await userExists(verified.sub))) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.userId = verified.sub;
  next();
}
