import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

// CORS is scoped to known dev/preview origins plus any configured production
// domains. The mobile app's expo-web preview is served from a separate
// *.expo.worf.replit.dev origin and calls this API cross-origin, so its origin
// must be reflected — but we avoid blanket-reflecting every origin so the
// production CORS posture stays strict. Non-browser clients (native mobile,
// curl, server-to-server) send no Origin and are always allowed through.
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
    // Dev/preview-only origins: localhost and Replit workspace previews,
    // including the expo-web preview's *.expo.worf.replit.dev host. Never
    // reflected in production so the production CORS posture stays strict.
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

app.use(cors(buildCorsOptions()));
app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// The expo-web preview of the mobile app is served from a *.expo.worf.replit.dev
// origin and reaches the API cross-origin via EventSource, which cannot set an
// Authorization header. The web SSE client therefore passes the bearer token as
// a `?token=` query param; promote it to a bearer header before auth runs so the
// normal auth path applies. Dev/preview only — native (header) and same-origin
// web (cookie) never need this, so production auth posture is unchanged (no
// token-in-URL acceptance there).
if (process.env.NODE_ENV !== "production") {
  app.use((req, _res, next) => {
    if (
      !req.headers.authorization &&
      typeof req.query.token === "string" &&
      req.query.token
    ) {
      req.headers.authorization = `Bearer ${req.query.token}`;
    }
    next();
  });
}

app.use("/api", router);

// Central JSON error handler. WITHOUT this, a thrown route error — or a
// body-parser PayloadTooLargeError / JSON SyntaxError — falls through to
// Express's DEFAULT handler, which responds with an HTML stack-trace page.
// Every client parses error responses as JSON (`res.json().error`), so an HTML
// body leaves them with only the bare status code and the real reason is lost:
// a failed schedule import then surfaces as an undiagnosable "error 500" toast
// with no cause. Return a JSON `{ error }` with an appropriate status and log
// the underlying cause (with request correlation) so failures are debuggable.
app.use((err: unknown, req: Request, res: Response, _next: NextFunction): void => {
  const e = (err ?? {}) as { status?: number; statusCode?: number; type?: string; message?: string };
  const status = typeof e.status === "number" ? e.status : typeof e.statusCode === "number" ? e.statusCode : 500;
  // User-facing message. For known 4xx body-parser failures give a plain-language
  // reason; never echo a raw 5xx message (could leak internal detail).
  const message =
    status === 413
      ? "The data was too large to save. Try importing fewer days at once."
      : e.type === "entity.parse.failed"
        ? "The request body was not valid JSON."
        : status >= 400 && status < 500 && typeof e.message === "string" && e.message
          ? e.message
          : "Something went wrong on the server.";
  (req.log ?? logger).error(
    { err, status, method: req.method, url: req.url?.split("?")[0] },
    "request errored",
  );
  if (res.headersSent) return;
  res.status(status).json({ error: message });
});

export default app;
