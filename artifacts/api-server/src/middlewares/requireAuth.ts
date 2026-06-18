import type { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

// Rejects any request that does not carry a valid Clerk session.
//
// Transport differs by client:
//  - Web: Clerk's session cookie is sent automatically on same-origin requests
//    (including native EventSource SSE connections).
//  - Mobile (Expo): there is no cookie jar, so a `Authorization: Bearer <token>`
//    header is attached to every REST and SSE request.
// `getAuth` understands both, so a single guard covers every client.
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.userId = userId;
  next();
}
