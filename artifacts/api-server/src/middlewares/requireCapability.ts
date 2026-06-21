import type { Request, Response, NextFunction } from "express";
import { getOrCreateUserRole, getRole, type Capability } from "../lib/roles";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      role?: string;
      capabilities?: Capability[];
    }
  }
}

// Gate a route on a single capability. Must run after requireAuth so req.userId
// is set. Resolves the signed-in user's role and its capability set, stashing
// both on the request (req.role / req.capabilities) so handlers can apply
// further guardrails (e.g. privilege-escalation checks) without re-querying.
// Resolving the role also creates the user's row on first sight (bootstrap), so
// this doubles as where new staff get a default role.
export function requireCapability(capability: Capability) {
  return async function (req: Request, res: Response, next: NextFunction): Promise<void> {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      const { role } = await getOrCreateUserRole(userId);
      const def = await getRole(role);
      const capabilities = def?.capabilities ?? [];
      req.role = role;
      req.capabilities = capabilities;
      if (!capabilities.includes(capability)) {
        res.status(403).json({ error: `Missing capability: ${capability}` });
        return;
      }
      next();
    } catch (err) {
      req.log.error({ err }, "capability check failed");
      res.status(500).json({ error: "Capability check failed" });
    }
  };
}
