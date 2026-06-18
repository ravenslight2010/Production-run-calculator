import type { Request, Response, NextFunction } from "express";
import { SESSION_COOKIE, verifyToken } from "../lib/auth";

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

// Rejects any request that does not carry a valid, unexpired session token.
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = readToken(req);
  const userId = token ? verifyToken(token) : null;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.userId = userId;
  next();
}
