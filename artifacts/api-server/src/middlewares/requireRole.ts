import type { Request, Response, NextFunction } from "express";
import {
  getOrCreateUserRole,
  mainRank,
  qcRank,
  type MainRole,
  type Role,
} from "../lib/roles";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      role?: Role;
    }
  }
}

// Gate a route on the signed-in user's MAIN-ladder rank (operator < supervisor <
// manager). Must run after requireAuth so req.userId is set. The requirement is
// inclusive of higher ranks: "operator" admits everyone signed in, "supervisor"
// admits supervisors and managers, "manager" admits only managers. QC roles rank
// as operators here (see lib/roles), so they pass an "operator" gate but not a
// "supervisor"/"manager" one. Resolving the role also creates the user's row on
// first sight (bootstrap), so this doubles as where new staff get a default role.
export function requireRole(min: MainRole) {
  return async function (req: Request, res: Response, next: NextFunction): Promise<void> {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      const { role } = await getOrCreateUserRole(userId);
      req.role = role;
      if (mainRank(role) < mainRank(min)) {
        res.status(403).json({ error: `${min} role required` });
        return;
      }
      next();
    } catch (err) {
      req.log.error({ err }, "role check failed");
      res.status(500).json({ error: "Role check failed" });
    }
  };
}

// Gate a route on the QC track (qc-operator < qc-manager). Non-QC roles rank 0
// and are rejected. Plumbing for a future QC-only surface — no route uses it yet.
export function requireQcRole(min: "qc-operator" | "qc-manager") {
  return async function (req: Request, res: Response, next: NextFunction): Promise<void> {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      const { role } = await getOrCreateUserRole(userId);
      req.role = role;
      if (qcRank(role) < qcRank(min)) {
        res.status(403).json({ error: `${min} role required` });
        return;
      }
      next();
    } catch (err) {
      req.log.error({ err }, "role check failed");
      res.status(500).json({ error: "Role check failed" });
    }
  };
}
