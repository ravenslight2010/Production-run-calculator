import { V2AuthError } from "./auth-adapter.mjs";

const AUTH_PREFIX = "/api/v2/auth";
const MAX_AUTH_BODY_BYTES = 4096;

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function sendEmpty(response, status, headers = {}) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end();
}

async function readJsonBody(request) {
  const contentType = request.headers["content-type"];
  if (typeof contentType !== "string" || !/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new V2AuthError(415, "Send this request as JSON.");
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_AUTH_BODY_BYTES) throw new V2AuthError(413, "The request is too large.");
    chunks.push(chunk);
  }
  if (size === 0) throw new V2AuthError(400, "A JSON request body is required.");

  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new V2AuthError(400, "The request body is not valid JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new V2AuthError(400, "The JSON request body must be an object.");
  }
  return body;
}

function requireSignInKeys(body) {
  const keys = Object.keys(body).sort();
  if (keys.length !== 2 || keys[0] !== "password" || keys[1] !== "username") {
    throw new V2AuthError(400, "The sign-in request contains missing or unsupported fields.");
  }
}

function assertSameOriginRequest(request) {
  const fetchSite = request.headers["sec-fetch-site"];
  if (fetchSite === "cross-site") {
    throw new V2AuthError(403, "This request was not same-origin.");
  }

  const origin = request.headers.origin;
  if (origin === undefined) return;
  if (typeof origin !== "string" || origin.length > 512) {
    throw new V2AuthError(403, "This request was not same-origin.");
  }
  const host = request.headers.host;
  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    throw new V2AuthError(403, "This request was not same-origin.");
  }
  if (
    (parsedOrigin.protocol !== "https:" && parsedOrigin.protocol !== "http:")
    || typeof host !== "string"
    || parsedOrigin.host.toLowerCase() !== host.toLowerCase() && fetchSite !== "same-origin"
    || parsedOrigin.username
    || parsedOrigin.password
    || parsedOrigin.pathname !== "/"
    || parsedOrigin.search
    || parsedOrigin.hash
  ) {
    throw new V2AuthError(403, "This request was not same-origin.");
  }
}

function publicStaff(auth) {
  return {
    userId: auth.actorId,
    username: auth.username,
    role: auth.role,
    capabilities: [...auth.capabilities],
  };
}

function routeOperation(pathname) {
  if (pathname === `${AUTH_PREFIX}/sign-in`) return "sign_in";
  if (pathname === `${AUTH_PREFIX}/session`) return "session";
  if (pathname === `${AUTH_PREFIX}/sign-out`) return "sign_out";
  if (pathname === `${AUTH_PREFIX}/bootstrap-status`) return "bootstrap_status";
  if (pathname === `${AUTH_PREFIX}/bootstrap`) return "bootstrap";
  if (pathname === `${AUTH_PREFIX}/staff`) return "staff_collection";
  if (/^\/api\/v2\/auth\/staff\/[0-9a-f-]{36}$/i.test(pathname)) return "staff_item";
  return "unknown";
}

export function createAuthApi({
  auth,
  getClientKey,
  secureCookies = process.env.NODE_ENV === "production",
  logger = () => {},
} = {}) {
  for (const method of [
    "signIn",
    "authenticate",
    "verifyCsrf",
    "signOut",
    "sessionCookie",
    "csrfCookie",
    "clearSessionCookie",
    "clearCsrfCookie",
    "bootstrapAvailable",
    "bootstrapManager",
    "listStaff",
    "createStaffAccount",
    "updateStaffAccount",
  ]) {
    if (typeof auth?.[method] !== "function") {
      throw new TypeError(`A V2 authentication adapter with ${method}() is required.`);
    }
  }
  if (typeof getClientKey !== "function") {
    throw new TypeError("A trusted client-key resolver is required for sign-in rate limiting.");
  }
  if (typeof logger !== "function") throw new TypeError("A structured logger is required.");

  return async function handleAuthApi(request, response) {
    let url;
    try {
      url = new URL(request.url || "/", "http://v2.local");
    } catch {
      return false;
    }
    if (url.pathname !== AUTH_PREFIX && !url.pathname.startsWith(`${AUTH_PREFIX}/`)) return false;

    const operation = routeOperation(url.pathname);
    try {
      if (operation === "bootstrap_status") {
        if (request.method !== "GET") {
          sendJson(response, 405, { error: "This method is not allowed for setup status." }, { Allow: "GET" });
          return true;
        }
        if (url.search) throw new V2AuthError(400, "Setup status does not accept query parameters.");
        sendJson(response, 200, { available: await auth.bootstrapAvailable({ clientKey: getClientKey(request) }) });
        return true;
      }

      if (operation === "bootstrap") {
        if (request.method !== "POST") {
          sendJson(response, 405, { error: "This method is not allowed for first-manager setup." }, { Allow: "POST" });
          return true;
        }
        assertSameOriginRequest(request);
        if (url.search) throw new V2AuthError(400, "First-manager setup does not accept query parameters.");
        const body = await readJsonBody(request);
        const keys = Object.keys(body).sort();
        if (keys.length !== 3 || keys[0] !== "bootstrapCode" || keys[1] !== "password" || keys[2] !== "username") {
          throw new V2AuthError(400, "The setup request contains missing or unsupported fields.");
        }
        const result = await auth.bootstrapManager({
          bootstrapCode: body.bootstrapCode,
          username: body.username,
          password: body.password,
          clientKey: getClientKey(request),
        });
        sendJson(response, 201, { staff: result.staff, expiresAt: result.expiresAt }, {
          "Set-Cookie": [
            auth.sessionCookie(result.token, { secure: secureCookies }),
            auth.csrfCookie(result.csrfToken, { secure: secureCookies }),
          ],
        });
        return true;
      }

      if (operation === "sign_in") {
        if (request.method !== "POST") {
          sendJson(response, 405, { error: "This method is not allowed for sign-in." }, { Allow: "POST" });
          return true;
        }
        assertSameOriginRequest(request);
        if (url.search) throw new V2AuthError(400, "Sign-in does not accept query parameters.");
        const body = await readJsonBody(request);
        requireSignInKeys(body);
        const result = await auth.signIn({
          username: body.username,
          password: body.password,
          clientKey: getClientKey(request),
        });
        sendJson(response, 200, { staff: result.staff, expiresAt: result.expiresAt }, {
          "Set-Cookie": [
            auth.sessionCookie(result.token, { secure: secureCookies }),
            auth.csrfCookie(result.csrfToken, { secure: secureCookies }),
          ],
        });
        return true;
      }

      if (operation === "session") {
        if (request.method !== "GET") {
          sendJson(response, 405, { error: "This method is not allowed for session reads." }, { Allow: "GET" });
          return true;
        }
        const current = await auth.authenticate(request);
        if (current?.verified !== true) {
          sendJson(response, 401, { error: "Sign in to access this app." });
          return true;
        }
        sendJson(response, 200, { staff: publicStaff(current), expiresAt: current.sessionExpiresAt });
        return true;
      }

      if (operation === "sign_out") {
        if (request.method !== "POST") {
          sendJson(response, 405, { error: "This method is not allowed for sign-out." }, { Allow: "POST" });
          return true;
        }
        assertSameOriginRequest(request);
        const current = await auth.authenticate(request);
        if (current?.verified === true && await auth.verifyCsrf(request, current) !== true) {
          sendJson(response, 403, { error: "Refresh your session before signing out." });
          return true;
        }
        if (current?.verified === true) await auth.signOut(request);
        sendEmpty(response, 204, {
          "Set-Cookie": [
            auth.clearSessionCookie({ secure: secureCookies }),
            auth.clearCsrfCookie({ secure: secureCookies }),
          ],
        });
        return true;
      }

      if (operation === "staff_collection") {
        if (request.method !== "GET" && request.method !== "POST") {
          sendJson(response, 405, { error: "This method is not allowed for staff accounts." }, { Allow: "GET, POST" });
          return true;
        }
        if (url.search) throw new V2AuthError(400, "Staff accounts do not accept query parameters.");
        if (request.method === "POST") assertSameOriginRequest(request);
        const current = await auth.authenticate(request);
        if (current?.verified !== true) {
          sendJson(response, 401, { error: "Sign in to manage staff accounts." });
          return true;
        }
        if (!current.capabilities.includes("manage-staff")) {
          sendJson(response, 403, { error: "You do not have permission to manage staff accounts." });
          return true;
        }
        if (
          request.method === "POST"
          && await auth.verifyCsrf(request, current) !== true
        ) {
          sendJson(response, 403, { error: "Refresh your session before changing staff accounts." });
          return true;
        }
        if (request.method === "GET") {
          sendJson(response, 200, await auth.listStaff(current.actorId));
          return true;
        }

        const body = await readJsonBody(request);
        const keys = Object.keys(body).sort();
        if (keys.length !== 3 || keys[0] !== "password" || keys[1] !== "roleName" || keys[2] !== "username") {
          throw new V2AuthError(400, "The staff account request contains missing or unsupported fields.");
        }
        await auth.createStaffAccount({
          actorId: current.actorId,
          username: body.username,
          password: body.password,
          roleName: body.roleName,
          clientKey: getClientKey(request),
        });
        sendJson(response, 201, await auth.listStaff(current.actorId));
        return true;
      }

      if (operation === "staff_item") {
        if (request.method !== "PATCH") {
          sendJson(response, 405, { error: "This method is not allowed for staff account changes." }, { Allow: "PATCH" });
          return true;
        }
        assertSameOriginRequest(request);
        if (url.search) throw new V2AuthError(400, "Staff account changes do not accept query parameters.");
        const current = await auth.authenticate(request);
        if (current?.verified !== true) {
          sendJson(response, 401, { error: "Sign in to manage staff accounts." });
          return true;
        }
        if (!current.capabilities.includes("manage-staff")) {
          sendJson(response, 403, { error: "You do not have permission to manage staff accounts." });
          return true;
        }
        if (await auth.verifyCsrf(request, current) !== true) {
          sendJson(response, 403, { error: "Refresh your session before changing staff accounts." });
          return true;
        }

        const body = await readJsonBody(request);
        const keys = Object.keys(body);
        if (
          keys.length < 1
          || keys.length > 2
          || keys.some((key) => key !== "disabled" && key !== "roleName")
        ) {
          throw new V2AuthError(400, "The staff account change contains missing or unsupported fields.");
        }
        const staffId = url.pathname.slice(`${AUTH_PREFIX}/staff/`.length);
        const updated = await auth.updateStaffAccount({
          actorId: current.actorId,
          staffId,
          disabled: body.disabled,
          roleName: body.roleName,
          clientKey: getClientKey(request),
        });
        sendJson(response, 200, {
          ...await auth.listStaff(current.actorId),
          outcome: updated.outcome,
        });
        return true;
      }

      sendJson(response, 404, { error: "Authentication route not found." });
      return true;
    } catch (error) {
      if (error instanceof V2AuthError) {
        const headers = error.retryAfterSeconds === undefined
          ? {}
          : { "Retry-After": String(error.retryAfterSeconds) };
        sendJson(response, error.status, { error: error.message }, headers);
        return true;
      }
      logger({
        event: "v2.auth.http_error",
        requestId: request.v2RequestId ?? null,
        operation,
        errorName: typeof error?.name === "string" ? error.name.slice(0, 80) : "UnknownError",
      });
      sendJson(response, 500, { error: "The sign-in request could not be completed. Try again." });
      return true;
    }
  };
}
