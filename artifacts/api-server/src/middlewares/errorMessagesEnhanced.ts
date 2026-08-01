import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";

/**
 * Enhanced error message handler for common failures.
 * Provides actionable feedback to staff (who lack console access).
 * Replaces the inline error handler in app.ts.
 */

export function enhancedErrorMessages(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const e = (err ?? {}) as {
    status?: number;
    statusCode?: number;
    type?: string;
    message?: string;
    code?: string;
  };

  const status =
    typeof e.status === "number"
      ? e.status
      : typeof e.statusCode === "number"
        ? e.statusCode
        : 500;

  let message: string;

  // Zod validation errors
  if (err instanceof ZodError) {
    const fieldErrors = err.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    message = `Validation error: ${fieldErrors}`;
  }
  // Database connection errors
  else if (
    e.code === "ECONNREFUSED" ||
    e.message?.includes("connect ECONNREFUSED")
  ) {
    message =
      "Database connection failed. The server will retry automatically. Please wait a moment and try again.";
  }
  // Circuit breaker open
  else if (
    e.code === "CIRCUIT_BREAKER_OPEN" ||
    e.message?.includes("Circuit breaker")
  ) {
    message =
      "External service is temporarily unavailable. Please try again in a few moments.";
  }
  // Timeout errors
  else if (e.message?.includes("timeout") || e.code === "ETIMEDOUT") {
    message = "Request timed out. Please check your connection and try again.";
  }
  // Body too large
  else if (status === 413) {
    message =
      "The data was too large to save. Try importing fewer days at once.";
  }
  // Invalid JSON
  else if (e.type === "entity.parse.failed") {
    message = "The request body was not valid JSON.";
  }
  // Unauthorized
  else if (status === 401) {
    message = "Your session has expired. Please sign in again.";
  }
  // Forbidden
  else if (status === 403) {
    message = "You don't have permission to perform this action.";
  }
  // Not found
  else if (status === 404) {
    message = "The requested resource was not found.";
  }
  // Known 4xx with a message
  else if (
    status >= 400 &&
    status < 500 &&
    typeof e.message === "string" &&
    e.message
  ) {
    message = e.message;
  }
  // Server errors
  else if (status >= 500) {
    message =
      "Something went wrong on the server. Our team has been notified. Please try again later.";
  } else {
    message = "Something went wrong. Please try again.";
  }

  ((req as any).log ?? console).error?.(
    { err, status, method: req.method, url: req.url?.split("?")[0] },
    "request errored",
  );

  if (res.headersSent) return;
  res.status(status).json({ error: message });
}
