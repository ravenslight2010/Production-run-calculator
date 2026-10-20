import type { RequestHandler } from "express";

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://api.qrserver.com",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join("; ");

export const httpSecurityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  next();
};

export function createQueryTokenPromotionMiddleware(
  nodeEnv: string | undefined,
  optIn: string | undefined,
): RequestHandler {
  const production = nodeEnv?.trim().toLowerCase() === "production";
  const enabled = !production && optIn?.trim().toLowerCase() === "true";

  return (req, _res, next) => {
    if (
      enabled &&
      !req.headers.authorization &&
      typeof req.query.token === "string" &&
      req.query.token
    ) {
      req.headers.authorization = `Bearer ${req.query.token}`;
    }
    next();
  };
}
