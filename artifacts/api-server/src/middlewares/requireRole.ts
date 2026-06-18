import type { Request, Response, NextFunction } from "express";
import { getOrCreateUserRole, type Role } from "../lib/roles";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      role?: Role;
    }
  }
}

// Gate a route on the signed-in user's role. Must run after requireAuth so
// req.userId is set. Managers are a superset of operators, so a "manager"
// requirement only admits managers, while an "operator" requirement admits
// everyone signed in. Resolving the role also creates the user's row on first
// sight (bootstrap), so this doubles as the place new staff get a default role.
export function requireRole(min: Role) {
  return async function (req: Request, res: Response, next: NextFunction): Promise<void> {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      const { role } = await getOrCreateUserRole(userId);
      req.role = role as Role;
      if (min === "manager" && role !== "manager") {
        res.status(403).json({ error: "Manager role required" });
        return;
      }
      next();
    } catch (err) {
      req.log.error({ err }, "role check failed");
      res.status(500).json({ error: "Role check failed" });
    }
  };
}
