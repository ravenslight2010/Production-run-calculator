import path from "node:path";
import { existsSync } from "node:fs";
import { setAppShellCacheHeaders } from "./lib/appShellCache";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { enhancedErrorMessages } from "./middlewares/errorMessagesEnhanced";
import { httpSecurityHeaders } from "./middlewares/httpSecurity";
import { isHealthProbePath, observabilityMiddleware } from "./lib/observability";

// CORS is scoped to known workspace dev/preview origins plus any configured
// production domains. We avoid blanket-reflecting every origin so the
// production CORS posture stays strict. Non-browser clients (curl and
// server-to-server) send no Origin and are always allowed through.
function buildCorsOptions(): cors.CorsOptions {
  const configuredDomains = (process.env.REPLIT_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);

  const isProduction = process.env.NODE_ENV === "production";

  function isAllowedOrigin(origin: string): boolean {
    let host: string;
    try {
      host = new URL(origin).hostname;
    } catch {
      return false;
    }
    // Configured production domains (web ↔ API are same-origin in production, but
    // reflect them so an explicit Origin header is still honored when present).
    if (configuredDomains.includes(host)) return true;
    // Dev/preview-only origins: localhost and Replit workspace previews.
    // Never reflected in production so the production CORS posture stays strict.
    if (!isProduction) {
      if (host === "localhost" || host === "127.0.0.1") return true;
      if (host === "replit.dev" || host.endsWith(".replit.dev")) return true;
    }
    return false;
  }

  return {
    credentials: true,
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      callback(null, isAllowedOrigin(origin));
    },
  };
}

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    customLogLevel(req, res, err) {
      // Readiness intentionally returns 503 while startup is incomplete. It is
      // a probe result, not an application request failure; health.ts records
      // the bounded startup state separately.
      if (isHealthProbePath(req.originalUrl ?? req.url ?? "")) return "silent";
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(observabilityMiddleware);
app.use(httpSecurityHeaders);

app.use(cors(buildCorsOptions()));
app.use(cookieParser());
app.use(
  "/api/profile-data/source-library-reconciliation/capture",
  (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  },
);
app.use(
  "/api/profile-data/source-library-reconciliation/capture",
  express.json({ limit: "8kb" }),
  express.urlencoded({ extended: true, limit: "8kb" }),
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use("/api", router);

// In production (Docker/Render/etc.), serve the pre-built web app from the same
// process so the SPA and API share an origin — no CORS issues, and relative
// /api/... fetches work without configuring a separate API base URL. The web
// build output lives at artifacts/run-calculator/dist/public relative to the
// repo root (or CWD). In dev, the Vite dev server handles the web app directly.
// Guarded to production only so integration tests (which import app.ts) are
// never affected by the catch-all route.
if (process.env.NODE_ENV === "production") {
  const WEB_DIST = path.resolve(process.cwd(), "artifacts/run-calculator/dist/public");
  if (existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST, {
      index: "index.html",
      setHeaders: setAppShellCacheHeaders,
    }));
    // SPA catch-all: any non-API, non-asset request serves index.html so client-side
    // routing works. Must come AFTER the /api router so API routes are never shadowed.
    app.get("/{*splat}", (req: Request, res: Response) => {
      res.setHeader("Cache-Control", "no-store");
      res.sendFile(path.join(WEB_DIST, "index.html"));
    });
  }
}

// Central JSON error handler — enhanced with actionable staff-facing messages.
// Covers body-parser failures (413, JSON SyntaxError), Zod validation errors,
// circuit-breaker open, DB connection refused, session expiry, and 5xx fallback.
app.use(enhancedErrorMessages);

export default app;
