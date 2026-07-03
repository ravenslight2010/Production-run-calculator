import type { Request, Response, NextFunction } from "express";
import { getOrCreateUserRole, getRole, type Capability } from "../lib/roles";
import { currentScope } from "../lib/requestScope";

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

// Blocks a sandbox-scoped session from routes that operate on genuinely global
// tables (staff accounts, roles, password-reset requests) which have no
// `scope` column to isolate them. Must run after requireAuth (req.scope set).
// Place this BEFORE requireCapability on those routes so a sandbox session is
// rejected before any global read/write is attempted.
export function requireLiveScope(req: Request, res: Response, next: NextFunction): void {
  if (currentScope() === "sandbox") {
    res.status(403).json({ error: "Not available in the sandbox account" });
    return;
  }
  next();
}

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
      // Staff/role administration operates on the users, user_roles, roles and
      // password-reset-request tables, none of which carry a `scope` column —
      // they are single, factory-wide directories, unlike the rest of the data
      // model. The sandbox account is always granted these capabilities so
      // every manager-gated FEATURE is reachable for testing, but it must never
      // be allowed to read or write those genuinely global tables — that would
      // let a sandbox session view, alter, or take over real staff accounts.
      // (See requireLiveScope for the routes gated on this.)
      next();
    } catch (err) {
      req.log.error({ err }, "capability check failed");
      res.status(500).json({ error: "Capability check failed" });
    }
  };
}
