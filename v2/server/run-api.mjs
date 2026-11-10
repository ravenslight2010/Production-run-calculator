import { createRunCommandService } from "../core/run-command-service.mjs";
import { createRunService } from "../core/run-service.mjs";

const API_PREFIX = "/api/v2/runs";
const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_MAX_BODY_BYTES = 16 * 1024;

class RunApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "RunApiError";
    this.status = status;
  }
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request, maxBytes) {
  const contentType = request.headers["content-type"];
  if (typeof contentType !== "string" || !/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new RunApiError(415, "Send this request as JSON.");
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new RunApiError(413, "The request is too large.");
    }
    chunks.push(chunk);
  }
  if (size === 0) throw new RunApiError(400, "A JSON request body is required.");

  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RunApiError(400, "The request body is not valid JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RunApiError(400, "The JSON request body must be an object.");
  }
  return body;
}

function requireExactKeys(value, expectedKeys) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new RunApiError(400, "The request contains missing or unsupported fields.");
  }
}

function safeStatus(error) {
  const knownService = error?.name === "RunServiceError" || error?.name === "RunCommandServiceError";
  if (error instanceof RunApiError) return error.status;
  if (knownService && Number.isInteger(error.status) && error.status >= 400 && error.status <= 599) {
    return error.status;
  }
  return 500;
}

function safeMessage(error) {
  if (error instanceof RunApiError
    || error?.name === "RunServiceError"
    || error?.name === "RunCommandServiceError") {
    return error.message;
  }
  return "The run request could not be completed. Refresh and try again.";
}

function parseLimit(url) {
  for (const key of url.searchParams.keys()) {
    if (key !== "limit") throw new RunApiError(400, "Unsupported run-list query parameter.");
  }
  const values = url.searchParams.getAll("limit");
  if (values.length > 1) throw new RunApiError(400, "Specify run-list limit once.");
  if (values.length === 0) return 50;
  if (!/^[1-9][0-9]*$/.test(values[0])) throw new RunApiError(400, "limit must be from 1 to 100.");
  const limit = Number(values[0]);
  if (!Number.isSafeInteger(limit) || limit > 100) throw new RunApiError(400, "limit must be from 1 to 100.");
  return limit;
}

function normalizePathRunId(value) {
  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new RunApiError(400, "Run ID is invalid.");
  }
  if (!RUN_ID_PATTERN.test(decoded)) throw new RunApiError(400, "Run ID is invalid.");
  return decoded.toLowerCase();
}

export function createRunApi({ runs, commands, authenticate, verifyCsrf, maxBodyBytes = DEFAULT_MAX_BODY_BYTES }) {
  if (!runs || typeof runs.create !== "function" || typeof runs.get !== "function" || typeof runs.list !== "function") {
    throw new TypeError("Run read and creation services are required.");
  }
  if (!commands || typeof commands.execute !== "function") {
    throw new TypeError("The lifecycle command service is required.");
  }
  if (typeof authenticate !== "function") {
    throw new TypeError("A server authentication adapter is required.");
  }
  if (typeof verifyCsrf !== "function") {
    throw new TypeError("A server CSRF verification adapter is required.");
  }
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1 || maxBodyBytes > 1024 * 1024) {
    throw new TypeError("maxBodyBytes must be an integer from 1 byte to 1 MiB.");
  }

  return async function handleRunApi(request, response) {
    try {
      const url = new URL(request.url || "/", "http://v2.local");
      if (url.pathname !== API_PREFIX && !url.pathname.startsWith(`${API_PREFIX}/`)) {
        throw new RunApiError(404, "Run route not found.");
      }

      const auth = await authenticate(request);
      if (auth?.verified !== true) throw new RunApiError(401, "Sign in to access runs.");
      const isMutation = request.method === "POST";
      if (isMutation && await verifyCsrf(request, auth) !== true) {
        throw new RunApiError(403, "Refresh your session before changing run state.");
      }

      if (url.pathname === API_PREFIX && request.method === "GET") {
        const listedRuns = await runs.list({ auth, limit: parseLimit(url) });
        sendJson(response, 200, { runs: listedRuns });
        return;
      }

      if (url.pathname === API_PREFIX && request.method === "POST") {
        const body = await readJsonBody(request, maxBodyBytes);
        requireExactKeys(body, ["requestId", "setupSnapshot"]);
        const result = await runs.create({
          auth,
          requestId: body.requestId,
          setupSnapshot: body.setupSnapshot,
        });
        sendJson(response, result.replayed ? 200 : 201, result);
        return;
      }

      const match = url.pathname.match(/^\/api\/v2\/runs\/([^/]+)(?:\/(commands))?$/);
      if (!match) throw new RunApiError(404, "Run route not found.");
      const runId = normalizePathRunId(match[1]);

      if (!match[2] && request.method === "GET") {
        const run = await runs.get({ auth, runId });
        if (!run) throw new RunApiError(404, "Run not found.");
        sendJson(response, 200, { run });
        return;
      }

      if (match[2] === "commands" && request.method === "POST") {
        const body = await readJsonBody(request, maxBodyBytes);
        requireExactKeys(body, ["commandId", "commandType", "expectedRevision"]);
        const result = await commands.execute({
          auth,
          command: { ...body, runId },
        });
        const status = result?.outcome === "accepted" ? 200 : 409;
        sendJson(response, status, result);
        return;
      }

      throw new RunApiError(405, "This method is not allowed for the run route.");
    } catch (error) {
      sendJson(response, safeStatus(error), { error: safeMessage(error) });
    }
  };
}

export function createRunApiForDatabase({ pool, authorize, authenticate, verifyCsrf, maxBodyBytes }) {
  if (!pool || typeof pool.query !== "function") {
    throw new TypeError("A V2 PostgreSQL pool is required.");
  }
  if (typeof authorize !== "function") {
    throw new TypeError("A server authorization function is required.");
  }

  const query = (sql, params) => pool.query(sql, params);
  const runs = createRunService({ query, authorize });
  const commands = createRunCommandService({ query, authorize });
  return createRunApi({ runs, commands, authenticate, verifyCsrf, maxBodyBytes });
}
