import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createAuthApi } from "./auth-api.mjs";
import { createInventoryApi } from "./inventory-api.mjs";
import { createRunApiForDatabase } from "./run-api.mjs";

const RESPONSE_SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; worker-src 'self'",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

const WEB_ASSETS = new Map([
  ["/", { file: new URL("../web/index.html", import.meta.url), type: "text/html; charset=utf-8" }],
  // V2's worker precaches these aliases so a still-active V1 worker cannot
  // supply its cached root document, manifest, or icon during the V2 install.
  ["/v2/web/app-shell.html", { file: new URL("../web/index.html", import.meta.url), type: "text/html; charset=utf-8" }],
  ["/manifest.webmanifest", { file: new URL("../web/manifest.webmanifest", import.meta.url), type: "application/manifest+json; charset=utf-8" }],
  ["/v2/web/manifest.webmanifest", { file: new URL("../web/manifest.webmanifest", import.meta.url), type: "application/manifest+json; charset=utf-8" }],
  ["/service-worker.js", { file: new URL("../web/service-worker.js", import.meta.url), type: "text/javascript; charset=utf-8" }],
  ["/favicon.ico", { file: new URL("../web/favicon.svg", import.meta.url), type: "image/svg+xml" }],
  ["/v2/web/favicon.svg", { file: new URL("../web/favicon.svg", import.meta.url), type: "image/svg+xml" }],
  ["/v2/web/app.js", { file: new URL("../web/app.js", import.meta.url), type: "text/javascript; charset=utf-8" }],
  ["/v2/core/station-workflows.mjs", { file: new URL("../core/station-workflows.mjs", import.meta.url), type: "text/javascript; charset=utf-8" }],
  ["/v2/core/import-csv-templates.mjs", { file: new URL("../core/import-csv-templates.mjs", import.meta.url), type: "text/javascript; charset=utf-8" }],
  ["/v2/core/import-csv.mjs", { file: new URL("../core/import-csv.mjs", import.meta.url), type: "text/javascript; charset=utf-8" }],
  ["/v2/core/setup-catalog-csv.mjs", { file: new URL("../core/setup-catalog-csv.mjs", import.meta.url), type: "text/javascript; charset=utf-8" }],
  ["/v2/web/inventory.js", { file: new URL("../web/inventory.js", import.meta.url), type: "text/javascript; charset=utf-8" }],
  ["/v2/web/setup-catalog.js", { file: new URL("../web/setup-catalog.js", import.meta.url), type: "text/javascript; charset=utf-8" }],
  ["/v2/web/write-gate.mjs", { file: new URL("../web/write-gate.mjs", import.meta.url), type: "text/javascript; charset=utf-8" }],
  ["/v2/web/styles.css", { file: new URL("../web/styles.css", import.meta.url), type: "text/css; charset=utf-8" }],
]);

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    ...RESPONSE_SECURITY_HEADERS,
    ...headers,
  });
  response.end(JSON.stringify(body));
}

async function serveWebAsset(request, response, pathname) {
  const asset = WEB_ASSETS.get(pathname);
  if (!asset) return false;
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { error: "This method is not allowed for the web page." }, { Allow: "GET, HEAD" });
    return true;
  }
  const contents = await readFile(asset.file);
  response.writeHead(200, {
    ...RESPONSE_SECURITY_HEADERS,
    "Cache-Control": "no-cache",
    "Content-Type": asset.type,
    "Content-Length": contents.byteLength,
  });
  response.end(request.method === "HEAD" ? undefined : contents);
  return true;
}

function safeRouteName(url) {
  if (!url) return "invalid";
  if (url.pathname === "/") return "web.index";
  if (url.pathname === "/v2/web/app-shell.html") return "web.app_shell";
  if (url.pathname === "/favicon.ico") return "web.favicon";
  if (url.pathname === "/v2/web/favicon.svg") return "web.favicon_alias";
  if (url.pathname === "/manifest.webmanifest") return "web.manifest";
  if (url.pathname === "/v2/web/manifest.webmanifest") return "web.manifest_alias";
  if (url.pathname === "/service-worker.js") return "web.service_worker";
  if (url.pathname === "/v2/web/app.js") return "web.app";
  if (url.pathname === "/v2/core/station-workflows.mjs") return "web.station_workflows";
  if (url.pathname === "/v2/core/import-csv-templates.mjs") return "web.import_csv_templates";
  if (url.pathname === "/v2/core/import-csv.mjs") return "web.import_csv";
  if (url.pathname === "/v2/core/setup-catalog-csv.mjs") return "web.setup_catalog_csv";
  if (url.pathname === "/v2/web/inventory.js") return "web.inventory";
  if (url.pathname === "/v2/web/setup-catalog.js") return "web.setup_catalog";
  if (url.pathname === "/v2/web/write-gate.mjs") return "web.write-gate";
  if (url.pathname === "/v2/web/styles.css") return "web.styles";
  if (url.pathname === "/healthz") return "health";
  if (url.pathname === "/api/v2/auth/sign-in") return "auth.sign_in";
  if (url.pathname === "/api/v2/auth/session") return "auth.session";
  if (url.pathname === "/api/v2/auth/sign-out") return "auth.sign_out";
  if (url.pathname === "/api/v2/auth/bootstrap-status") return "auth.bootstrap_status";
  if (url.pathname === "/api/v2/auth/bootstrap") return "auth.bootstrap";
  if (url.pathname === "/api/v2/auth/staff") return "auth.staff";
  if (/^\/api\/v2\/auth\/staff\/[0-9a-f-]{36}$/i.test(url.pathname)) return "auth.staff_item";
  if (url.pathname === "/api/v2/runs") return "runs.collection";
  if (url.pathname === "/api/v2/runs/products") return "runs.products";
  if (/^\/api\/v2\/runs\/[^/]+\/commands$/.test(url.pathname)) return "runs.command";
  if (/^\/api\/v2\/runs\/[^/]+\/stations\/[^/]+\/commands$/.test(url.pathname)) return "runs.station_command";
  if (/^\/api\/v2\/runs\/[^/]+$/.test(url.pathname)) return "runs.detail";
  if (url.pathname === "/api/v2/imports") return "imports.collection";
  if (url.pathname === "/api/v2/setup-catalog/imports") return "setup_catalog_imports.collection";
  if (/^\/api\/v2\/setup-catalog\/imports\/[^/]+$/.test(url.pathname)) return "setup_catalog_imports.detail";
  if (/^\/api\/v2\/setup-catalog\/imports\/[^/]+\/(apply|undo)$/.test(url.pathname)) return "setup_catalog_imports.action";
  if (url.pathname === "/api/v2/imports/workbooks") return "imports.workbooks";
  if (url.pathname === "/api/v2/imports/workbooks/preview") return "imports.workbooks_preview";
  if (/^\/api\/v2\/imports\/[^/]+$/.test(url.pathname)) return "imports.detail";
  if (/^\/api\/v2\/imports\/[^/]+\/(apply|undo)$/.test(url.pathname)) return "imports.action";
  if (url.pathname.startsWith("/api/v2/inventory/")) return "inventory.operation";
  return "unmatched";
}

export function createV2Api({
  pool,
  authAdapter,
  getClientKey,
  secureCookies = process.env.NODE_ENV === "production",
  logger = (record) => console.log(JSON.stringify(record)),
  healthTimeoutMs = 2000,
  workerHealth,
}) {
  if (!pool || typeof pool.query !== "function") throw new TypeError("A V2 PostgreSQL pool is required.");
  for (const method of ["authenticate", "verifyCsrf", "authorizeRun", "signIn", "signOut", "sessionCookie", "csrfCookie"]) {
    if (typeof authAdapter?.[method] !== "function") {
      throw new TypeError(`A V2 authentication adapter with ${method}() is required.`);
    }
  }
  if (typeof getClientKey !== "function") throw new TypeError("A trusted client-key resolver is required.");
  if (typeof logger !== "function") throw new TypeError("A structured logger is required.");
  if (workerHealth !== undefined && typeof workerHealth !== "function") {
    throw new TypeError("workerHealth must be a function when provided.");
  }
  if (!Number.isSafeInteger(healthTimeoutMs) || healthTimeoutMs < 100 || healthTimeoutMs > 10_000) {
    throw new TypeError("healthTimeoutMs must be between 100 and 10000.");
  }

  const runApi = createRunApiForDatabase({
    pool,
    authorize: (input) => authAdapter.authorizeRun(input),
    authenticate: (request) => authAdapter.authenticate(request),
    verifyCsrf: (request, auth) => authAdapter.verifyCsrf(request, auth),
    logger,
  });
  const authApi = createAuthApi({
    auth: authAdapter,
    getClientKey,
    secureCookies,
    logger,
  });
  const inventoryApi = createInventoryApi({
    pool,
    authenticate: (request) => authAdapter.authenticate(request),
    verifyCsrf: (request, auth) => authAdapter.verifyCsrf(request, auth),
    logger,
  });

  return async function handleV2Api(request, response) {
    const requestId = randomUUID();
    request.v2RequestId = requestId;
    response.setHeader("X-Request-Id", requestId);
    const startedAt = performance.now();
    for (const [header, value] of Object.entries(RESPONSE_SECURITY_HEADERS)) response.setHeader(header, value);
    let parsedUrl = null;
    try {
      parsedUrl = new URL(request.url || "/", "http://v2.local");
    } catch {
      sendJson(response, 400, { error: "The request URL is invalid." });
      return;
    }

    const route = safeRouteName(parsedUrl);
    response.once("finish", () => {
      logger({
        event: "v2.http.request",
        requestId,
        method: request.method,
        route,
        status: response.statusCode,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      });
    });

    try {
      if (await serveWebAsset(request, response, parsedUrl.pathname)) return;
      if (parsedUrl.pathname === "/healthz") {
        if (request.method !== "GET") {
          sendJson(response, 405, { error: "This method is not allowed for health checks." }, { Allow: "GET" });
          return;
        }
        try {
          await pool.query({ text: "SELECT 1", query_timeout: healthTimeoutMs });
          const body = { status: "ok" };
          if (workerHealth) {
            const stationWorker = await workerHealth();
            body.stationWorker = stationWorker;
            if (!stationWorker || ["starting", "degraded", "stopped"].includes(stationWorker.status)) {
              logger({
                event: "v2.health.worker_unavailable",
                requestId,
                workerStatus: stationWorker?.status ?? "unknown",
              });
              sendJson(response, 503, { error: "The service is temporarily unavailable." });
              return;
            }
          }
          sendJson(response, 200, body);
        } catch (error) {
          logger({
            event: "v2.health.unavailable",
            requestId,
            errorName: typeof error?.name === "string" ? error.name.slice(0, 80) : "UnknownError",
          });
          sendJson(response, 503, { error: "The service is temporarily unavailable." });
        }
        return;
      }

      if (await authApi(request, response)) return;
      if (await inventoryApi(request, response)) return;
      await runApi(request, response);
    } catch (error) {
      logger({
        event: "v2.http.unhandled",
        requestId,
        route,
        errorName: typeof error?.name === "string" ? error.name.slice(0, 80) : "UnknownError",
      });
      if (!response.headersSent) {
        sendJson(response, 500, { error: "The request could not be completed. Try again." });
      } else {
        response.destroy();
      }
    }
  };
}
