import type { NextFunction, Request, Response } from "express";
import { getStartupHealth } from "./startupHealth";

// Health routes are mounted before this middleware. Every other API route is
// held until required boot work has completed, so a process that is listening
// but still initializing cannot accept writes against a partially healed DB.
export function startupGate(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const startup = getStartupHealth();
  if (startup.phase === "ready") {
    next();
    return;
  }

  res.status(503).json({
    error: "Service is not ready",
    status: startup.phase,
    stage: startup.stage,
    durationMs: startup.durationMs,
    ...(startup.failure ? { errorCode: startup.failure.errorCode } : {}),
    correlationId: String(
      (req as Request & { correlationId?: string }).correlationId ??
        req.id ??
        "startup-gate",
    ),
  });
}
