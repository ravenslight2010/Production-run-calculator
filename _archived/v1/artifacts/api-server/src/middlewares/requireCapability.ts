import type { Request, Response, NextFunction } from "express";
import { getOrCreateUserRole, getRole, type Capability } from "../lib/roles";
import { currentScope } from "../lib/requestScope";

type CapabilityMiddleware = ReturnType<typeof requireCapabilities>;
const requiredCapabilitiesByMiddleware = new WeakMap<CapabilityMiddleware, readonly Capability[]>();
const capabilityMatchByMiddleware = new WeakMap<CapabilityMiddleware, "all" | "any">();
const liveScopeMiddlewares = new WeakSet<Function>();
const managerRoleMiddlewares = new WeakSet<Function>();

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
liveScopeMiddlewares.add(requireLiveScope);

function requireCapabilities(capabilitiesRequired: readonly Capability[], match: "all" | "any") {
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
      const permitted = match === "all"
        ? capabilitiesRequired.every((capability) => capabilities.includes(capability))
        : capabilitiesRequired.some((capability) => capabilities.includes(capability));
      if (!permitted) {
        res.status(403).json({
          error: match === "all"
            ? `Missing capability: ${capabilitiesRequired.join(", ")}`
            : `Missing one of capabilities: ${capabilitiesRequired.join(", ")}`,
        });
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

export function requireCapability(capability: Capability) {
  const middleware = requireCapabilities([capability], "all");
  requiredCapabilitiesByMiddleware.set(middleware, [capability]);
  capabilityMatchByMiddleware.set(middleware, "all");
  return middleware;
}

/**
 * Gate a route only when its request selects a protected variant.  This keeps
 * current-shift collaboration auth-only while making an alternate target (for
 * example a scheduled day) capability-controlled before its handler runs.
 * The middleware is still tagged for route-inventory inspection.
 */
export function requireCapabilityWhen(
  capability: Capability,
  required: (req: Request) => boolean,
) {
  const capabilityMiddleware = requireCapabilities([capability], "all");
  const middleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!required(req)) {
      next();
      return;
    }
    await capabilityMiddleware(req, res, next);
  };
  requiredCapabilitiesByMiddleware.set(middleware, [capability]);
  capabilityMatchByMiddleware.set(middleware, "all");
  return middleware;
}

/**
 * Test-only route ownership hook. Express keeps middleware functions on each
 * route layer, so authorization inventory checks can discover capability gates
 * without duplicating route declarations or invoking the middleware.
 */
export function getRequiredCapabilities(
  middleware: unknown,
): readonly Capability[] | undefined {
  return typeof middleware === "function"
    ? requiredCapabilitiesByMiddleware.get(middleware as CapabilityMiddleware)
    : undefined;
}

export function getCapabilityMatch(
  middleware: unknown,
): "all" | "any" | undefined {
  return typeof middleware === "function"
    ? capabilityMatchByMiddleware.get(middleware as CapabilityMiddleware)
    : undefined;
}

export function isRequireLiveScope(middleware: unknown): boolean {
  return typeof middleware === "function" && liveScopeMiddlewares.has(middleware);
}

/**
 * Apply after requireCapability when an action is a literal manager attestation,
 * not merely a permission that a custom or supervisory role may hold.
 */
export function requireManagerRole(req: Request, res: Response, next: NextFunction): void {
  if (req.role !== "manager") {
    res.status(403).json({ error: "Manager role required" });
    return;
  }
  next();
}
managerRoleMiddlewares.add(requireManagerRole);

export function isRequireManagerRole(middleware: unknown): boolean {
  return typeof middleware === "function" && managerRoleMiddlewares.has(middleware);
}

/** Gate a shared operational read surface that is valid for either role. */
export function requireAnyCapability(capabilities: readonly Capability[]) {
  const middleware = requireCapabilities(capabilities, "any");
  requiredCapabilitiesByMiddleware.set(middleware, capabilities);
  capabilityMatchByMiddleware.set(middleware, "any");
  return middleware;
}
