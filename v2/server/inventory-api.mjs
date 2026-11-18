import { createHash } from "node:crypto";
import {
  ImportCsvError,
  parseOpeningCountCsv,
  parseSetupImportCsv,
} from "../core/import-csv.mjs";
import { parseSetupCatalogCsv, setupCatalogCsvLimits } from "../core/setup-catalog-csv.mjs";
import {
  parseSourceWorkbook,
  SourceWorkbookImportError,
  sourceWorkbookImportLimits,
} from "../core/source-workbook-import.mjs";
import {
  linkWorkbookCapacityRows,
  parseDoughCapacityWorkbook,
  parseShippingCapacityWorkbook,
  WorkbookCapacityImportError,
  workbookCapacityImportLimits,
} from "../core/workbook-capacity-import.mjs";

const IMPORTS_PATH = "/api/v2/imports";
const SETUP_CATALOG_PATH = "/api/v2/setup-catalog/imports";
const SOURCE_WORKBOOK_PREVIEW_PATH = `${SETUP_CATALOG_PATH}/workbooks/preview`;
const INVENTORY_PATH = "/api/v2/inventory";
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_WORKBOOK_BODY_BYTES = 7_250 * 1024;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const QUANTITY = /^-?(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?$/;
const POSITIVE_QUANTITY = /^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?$/;

class InventoryApiError extends Error {
  constructor(status, message, retryAfterSeconds = undefined) {
    super(message);
    this.name = "InventoryApiError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request, maxBytes = MAX_BODY_BYTES) {
  const contentType = request.headers["content-type"];
  if (typeof contentType !== "string" || !/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new InventoryApiError(415, "Send this request as JSON.");
  }
  let bytes = 0;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new InventoryApiError(413, "The request is too large.");
    chunks.push(chunk);
  }
  if (bytes === 0) throw new InventoryApiError(400, "A JSON request body is required.");
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new InventoryApiError(400, "The request body is not valid JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new InventoryApiError(400, "The JSON request body must be an object.");
  }
  return body;
}

function requireKeys(body, keys) {
  const actual = Object.keys(body).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new InventoryApiError(400, "The request contains missing or unsupported fields.");
  }
}

function validateRequestId(value) {
  if (typeof value !== "string" || !REQUEST_ID.test(value)) {
    throw new InventoryApiError(400, "Enter a valid request ID.");
  }
  return value;
}

function validateUuid(value, name) {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new InventoryApiError(400, `${name} is invalid.`);
  }
  return value.toLowerCase();
}

function validateReason(value) {
  if (typeof value !== "string" || value.trim().length < 3 || value.trim().length > 500
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new InventoryApiError(400, "Enter a reason from 3 to 500 characters.");
  }
  return value.trim();
}

function validateQuantity(value, { positive = false, nonzero = false } = {}) {
  const pattern = positive ? POSITIVE_QUANTITY : QUANTITY;
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new InventoryApiError(400, positive
      ? "Enter a non-negative quantity with up to six decimal places."
      : "Enter a quantity with up to six decimal places.");
  }
  if (nonzero && /^-?0(?:\.0{1,6})?$/.test(value)) {
    throw new InventoryApiError(400, "Quantity must be greater than zero.");
  }
  return value;
}

function hashRequest(value) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function parseLimit(url, { extra = [] } = {}) {
  const keys = [...url.searchParams.keys()];
  const allowed = new Set(["limit", ...extra]);
  if (keys.some((key) => !allowed.has(key)) || url.searchParams.getAll("limit").length > 1) {
    throw new InventoryApiError(400, "Unsupported list query parameter.");
  }
  const value = url.searchParams.get("limit");
  if (value === null) return 50;
  if (!/^[1-9][0-9]*$/.test(value) || Number(value) > 100) {
    throw new InventoryApiError(400, "limit must be from 1 to 100.");
  }
  return Number(value);
}

function safeStatus(error) {
  if (error instanceof InventoryApiError) return error.status;
  if (error instanceof ImportCsvError) return 400;
  if (error instanceof WorkbookCapacityImportError) return 400;
  if (error instanceof SourceWorkbookImportError) return 400;
  switch (error?.code) {
    case "P0002": return 404;
    case "42501": return 403;
    case "23505":
    case "23503":
    case "40001":
    case "55000":
    case "22003": return 409;
    case "22023":
    case "23514": return 400;
    default: return 500;
  }
}

function safeMessage(error, operation) {
  if (error instanceof InventoryApiError) return error.message;
  if (error instanceof ImportCsvError) return error.message;
  if (error instanceof WorkbookCapacityImportError) return error.message;
  if (error instanceof SourceWorkbookImportError) return error.message;
  switch (error?.code) {
    case "P0002": return "That warehouse, product, import, or count is no longer available.";
    case "42501": return "You do not have access to this inventory.";
    case "23505": return "A record with those details already exists.";
    case "23503": return operation === "create_import"
      ? "The import references a product that is not active in V2. Import products first."
      : "The request references a record that is not available.";
    case "40001": return "The data changed while you were working. Refresh and review it again.";
    case "55000": return "This operation is not available in the record’s current state.";
    case "22003": return "The available stock or quantity limit does not allow this change.";
    case "22023": return "The request values are invalid. Correct them and try again.";
    case "23514": return "The request conflicts with an inventory rule.";
    default: return "The inventory request could not be completed. Refresh and try again.";
  }
}

function requireManager(auth) {
  if (auth?.verified !== true) throw new InventoryApiError(401, "Sign in to access inventory.");
  if (!Array.isArray(auth.capabilities) || !auth.capabilities.includes("manage-inventory")) {
    throw new InventoryApiError(403, "A manager must approve this inventory action.");
  }
  if (typeof auth.actorId !== "string" || !UUID.test(auth.actorId)
    || typeof auth.facilityId !== "string" || !UUID.test(auth.facilityId)) {
    throw new InventoryApiError(401, "Refresh your V2 session before continuing.");
  }
}

function resultValue(result) {
  return result?.rows?.[0]?.result ?? null;
}

function parseWorkbookUpload(body) {
  if (!["dough-procedure", "shipping-guide"].includes(body.family)) {
    throw new InventoryApiError(400, "Choose a dough procedure or shipping guide workbook.");
  }
  if (typeof body.workbookBase64 !== "string"
    || body.workbookBase64.length > Math.ceil(workbookCapacityImportLimits.maxBytes / 3) * 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(body.workbookBase64)) {
    throw new InventoryApiError(400, "Choose a valid XLSX workbook no larger than 5 MiB.");
  }
  const workbookBytes = Buffer.from(body.workbookBase64, "base64");
  if (workbookBytes.byteLength > workbookCapacityImportLimits.maxBytes
    || workbookBytes.toString("base64") !== body.workbookBase64) {
    throw new InventoryApiError(400, "Choose a valid XLSX workbook no larger than 5 MiB.");
  }
  const parsed = body.family === "dough-procedure"
    ? parseDoughCapacityWorkbook(workbookBytes, body.fileName)
    : parseShippingCapacityWorkbook(workbookBytes, body.fileName);
  return parsed;
}

function parseSourceWorkbookUpload(body) {
  if (!sourceWorkbookImportLimits.families.includes(body.family)) {
    throw new InventoryApiError(400, "Choose one of the six supported V1 source families.");
  }
  const sauceDocx = body.family === "sauce-guides" && /\.docx$/iu.test(String(body.fileName ?? ""));
  if (typeof body.workbookBase64 !== "string"
    || body.workbookBase64.length > Math.ceil(sourceWorkbookImportLimits.maxBytes / 3) * 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(body.workbookBase64)) {
    throw new InventoryApiError(400, "Choose a valid supported source file no larger than 5 MiB.");
  }
  const workbookBytes = Buffer.from(body.workbookBase64, "base64");
  if (workbookBytes.byteLength > sourceWorkbookImportLimits.maxBytes
    || workbookBytes.toString("base64") !== body.workbookBase64) {
    throw new InventoryApiError(400, "Choose a valid supported source file no larger than 5 MiB.");
  }
  if (sauceDocx && workbookBytes.byteLength < 22) {
    throw new InventoryApiError(400, "Choose a valid sauce guide DOCX no larger than 5 MiB.");
  }
  return parseSourceWorkbook(body.family, workbookBytes, body.fileName);
}

function validateSourceSummary(value, importedRows) {
  if (value == null) return null;
  const required = [
    "sourceFamily", "sourceSha256", "parserVersion", "sourceRows",
    "importedRows", "skippedRows", "unresolvedRows",
  ];
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join("\u0000") !== [...required].sort().join("\u0000")
    || !sourceWorkbookImportLimits.families.includes(value.sourceFamily)
    || typeof value.sourceSha256 !== "string" || !/^[0-9a-f]{64}$/u.test(value.sourceSha256)
    || value.parserVersion !== sourceWorkbookImportLimits.parserVersion
    || !Number.isSafeInteger(value.sourceRows) || value.sourceRows < 0 || value.sourceRows > 2000
    || !Number.isSafeInteger(value.importedRows) || value.importedRows !== importedRows
    || !Number.isSafeInteger(value.skippedRows) || value.skippedRows < 0 || value.skippedRows > 2000
    || !Number.isSafeInteger(value.unresolvedRows) || value.unresolvedRows < 0 || value.unresolvedRows > 2000) {
    throw new InventoryApiError(400, "The source review counts are incomplete or do not match the staged rows.");
  }
  return value;
}

function validateWorkbookProductLinks(value) {
  if (!Array.isArray(value) || value.length > workbookCapacityImportLimits.maxRows) {
    throw new InventoryApiError(400, "Review the workbook product links and try again.");
  }
  const seen = new Set();
  return value.map((link) => {
    if (!link || typeof link !== "object" || Array.isArray(link)
      || Object.keys(link).sort().join(",") !== "productCode,sourceKey"
      || typeof link.sourceKey !== "string" || !/^[0-9a-f]{64}$/u.test(link.sourceKey)
      || typeof link.productCode !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(link.productCode)
      || seen.has(link.sourceKey)) {
      throw new InventoryApiError(400, "Review the workbook product links and try again.");
    }
    seen.add(link.sourceKey);
    return { sourceKey: link.sourceKey, productCode: link.productCode };
  });
}

async function workbookLinkContext(pool, scope, family) {
  const productResult = await pool.query(
    "SELECT v2.list_inventory_products($1::uuid) AS result",
    scope,
  );
  const products = resultValue(productResult);
  if (!Array.isArray(products)
    || products.some((product) => !product || typeof product.code !== "string"
      || typeof product.name !== "string" || product.active !== true)) {
    throw new InventoryApiError(502, "The active product list is unavailable. Refresh and try again.");
  }
  const priorResult = await pool.query(
    "SELECT v2.list_workbook_source_links($1::uuid, $2::text) AS result",
    [...scope, family],
  );
  const priorLinks = resultValue(priorResult);
  if (!Array.isArray(priorLinks)) {
    throw new InventoryApiError(502, "Saved workbook product links are unavailable. Refresh and try again.");
  }
  return { products, priorLinks };
}

function createUploadLimiter({ maxRequests = 10, windowMs = 60_000, maxKeys = 10_000, clock = Date.now } = {}) {
  const entries = new Map();
  return {
    consume(key) {
      const now = clock();
      for (const [existingKey, entry] of entries) {
        if (entry.resetAt <= now) entries.delete(existingKey);
      }
      let entry = entries.get(key);
      if (!entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + windowMs };
        entries.delete(key);
        entries.set(key, entry);
      }
      if (entries.size > maxKeys) entries.delete(entries.keys().next().value);
      if (entry.count >= maxRequests) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
      }
      entry.count += 1;
      return { allowed: true };
    },
  };
}

function parseWarehouseId(url, { allowMovementCursor = false } = {}) {
  const values = url.searchParams.getAll("warehouseId");
  const allowed = allowMovementCursor
    ? new Set(["warehouseId", "limit", "beforeAt", "beforeId"])
    : new Set(["warehouseId"]);
  if (values.length !== 1 || [...url.searchParams.keys()].some((key) => !allowed.has(key))) {
    throw new InventoryApiError(400, "Specify one warehouseId.");
  }
  return validateUuid(values[0], "Warehouse ID");
}

function parseMovementCursor(url) {
  const times = url.searchParams.getAll("beforeAt");
  const ids = url.searchParams.getAll("beforeId");
  if (times.length === 0 && ids.length === 0) return [null, null];
  if (times.length !== 1 || ids.length !== 1 || !ISO_TIMESTAMP.test(times[0])
    || !Number.isFinite(Date.parse(times[0]))) {
    throw new InventoryApiError(400, "Specify a valid movement cursor.");
  }
  return [times[0], validateUuid(ids[0], "Movement cursor ID")];
}

export function createInventoryApi({ pool, authenticate, verifyCsrf, logger = () => {} } = {}) {
  if (!pool || typeof pool.query !== "function") throw new TypeError("A V2 PostgreSQL pool is required.");
  if (typeof authenticate !== "function") throw new TypeError("A V2 session verifier is required.");
  if (typeof verifyCsrf !== "function") throw new TypeError("A V2 CSRF verifier is required.");
  if (typeof logger !== "function") throw new TypeError("A structured logger is required.");
  const uploadLimiter = createUploadLimiter();

  return async function handleInventoryApi(request, response) {
    let url;
    try {
      url = new URL(request.url || "/", "http://v2.local");
    } catch {
      sendJson(response, 400, { error: "The request URL is invalid." });
      return false;
    }
    const isImports = url.pathname === IMPORTS_PATH || url.pathname.startsWith(`${IMPORTS_PATH}/`);
    const isSetupCatalog = url.pathname === SETUP_CATALOG_PATH || url.pathname.startsWith(`${SETUP_CATALOG_PATH}/`);
    const isInventory = url.pathname === INVENTORY_PATH || url.pathname.startsWith(`${INVENTORY_PATH}/`);
    if (!isImports && !isSetupCatalog && !isInventory) return false;

    let operation = "unknown";
    try {
      if (url.search && request.method !== "GET") {
        throw new InventoryApiError(400, "This request does not accept query parameters.");
      }
      const auth = await authenticate(request);
      requireManager(auth);
      if (request.method !== "GET") {
        if (request.method !== "POST") throw new InventoryApiError(405, "This method is not allowed.");
        if (await verifyCsrf(request, auth) !== true) {
          throw new InventoryApiError(403, "Refresh your session before changing inventory.");
        }
        if (
          url.pathname === IMPORTS_PATH
          || url.pathname === `${IMPORTS_PATH}/workbooks`
          || url.pathname === `${IMPORTS_PATH}/workbooks/preview`
          || url.pathname === SETUP_CATALOG_PATH
          || url.pathname === SOURCE_WORKBOOK_PREVIEW_PATH
          || url.pathname === `${INVENTORY_PATH}/opening-counts`
        ) {
          const limit = uploadLimiter.consume(auth.actorId);
          if (!limit.allowed) {
            throw new InventoryApiError(429, "Too many imports. Wait briefly, then try again.", limit.retryAfterSeconds);
          }
        }
      }
      const scope = [auth.facilityId.toLowerCase()];
      const actor = auth.actorId.toLowerCase();

      if (isImports && url.pathname === IMPORTS_PATH && request.method === "GET") {
        operation = "list_imports";
        const result = await pool.query(
          "SELECT v2.list_setup_imports($1::uuid, $2::integer) AS result",
          [...scope, parseLimit(url)],
        );
        sendJson(response, 200, { imports: resultValue(result) });
        return true;
      }

      if (isSetupCatalog && url.pathname === SETUP_CATALOG_PATH && request.method === "GET") {
        operation = "list_setup_catalog_imports";
        const result = await pool.query(
          "SELECT v2.list_setup_catalog_imports($1::uuid, $2::integer) AS result",
          [...scope, parseLimit(url)],
        );
        sendJson(response, 200, { imports: resultValue(result) });
        return true;
      }

      if (isSetupCatalog && url.pathname === SETUP_CATALOG_PATH && request.method === "POST") {
        operation = "stage_setup_catalog_import";
        const body = await readJsonBody(request);
        const requiredKeys = ["requestId", "family", "csv"];
        const acceptedKeys = new Set([...requiredKeys, "sourceSummary"]);
        if (requiredKeys.some((key) => !Object.hasOwn(body, key))
          || Object.keys(body).some((key) => !acceptedKeys.has(key))) {
          throw new InventoryApiError(400, "The request contains missing or unsupported fields.");
        }
        const requestId = validateRequestId(body.requestId);
        if (typeof body.family !== "string" || !setupCatalogCsvLimits.families.includes(body.family)) {
          throw new InventoryApiError(400, "Choose a supported setup family.");
        }
        const records = parseSetupCatalogCsv(body.family, body.csv);
        const sourceSummary = validateSourceSummary(body.sourceSummary, records.length);
        if (sourceSummary && (sourceSummary.sourceFamily === "premix-sheets") !== (body.family === "mixes")) {
          throw new InventoryApiError(400, "The source family does not match its V2 setup target.");
        }
        if (sourceSummary && sourceSummary.sourceFamily !== "premix-sheets" && body.family !== "run-templates") {
          throw new InventoryApiError(400, "This source family must use the V2 run-template target.");
        }
        const requestHash = sourceSummary
          ? hashRequest({ family: body.family, records, sourceSummary })
          : hashRequest({ family: body.family, records });
        const result = await pool.query(
          "SELECT v2.stage_setup_catalog_import($1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::jsonb, $7::jsonb) AS result",
          [...scope, actor, requestId, requestHash, body.family, JSON.stringify(records), sourceSummary ? JSON.stringify(sourceSummary) : null],
        );
        const staged = resultValue(result);
        sendJson(response, staged.replayed ? 200 : 201, { ...staged, records });
        return true;
      }

      if (isSetupCatalog && url.pathname === SOURCE_WORKBOOK_PREVIEW_PATH && request.method === "POST") {
        operation = "preview_source_workbook_import";
        const body = await readJsonBody(request, MAX_WORKBOOK_BODY_BYTES);
        requireKeys(body, ["family", "fileName", "workbookBase64"]);
        const parsed = parseSourceWorkbookUpload(body);
        sendJson(response, 200, parsed);
        return true;
      }

      const setupCatalogDetail = url.pathname.match(/^\/api\/v2\/setup-catalog\/imports\/([^/]+)$/);
      if (isSetupCatalog && setupCatalogDetail && request.method === "GET") {
        operation = "get_setup_catalog_import";
        const importId = validateUuid(setupCatalogDetail[1], "Import ID");
        const result = await pool.query(
          "SELECT v2.get_setup_catalog_import($1::uuid, $2::uuid) AS result",
          [...scope, importId],
        );
        const item = resultValue(result);
        if (!item) throw new InventoryApiError(404, "That setup import is not available.");
        sendJson(response, 200, item);
        return true;
      }

      const setupCatalogAction = url.pathname.match(
        /^\/api\/v2\/setup-catalog\/imports\/([^/]+)\/(apply|undo)$/,
      );
      if (isSetupCatalog && setupCatalogAction && request.method === "POST") {
        operation = setupCatalogAction[2] === "apply"
          ? "apply_setup_catalog_import"
          : "undo_setup_catalog_import";
        const importId = validateUuid(setupCatalogAction[1], "Import ID");
        const body = await readJsonBody(request);
        requireKeys(body, []);
        const action = setupCatalogAction[2];
        const result = await pool.query(
          `SELECT v2.${action}_setup_catalog_import($1::uuid, $2::uuid, $3::uuid) AS result`,
          [...scope, actor, importId],
        );
        sendJson(response, 200, resultValue(result));
        return true;
      }

      if (isImports && url.pathname === IMPORTS_PATH && request.method === "POST") {
        operation = "create_import";
        const body = await readJsonBody(request);
        requireKeys(body, ["requestId", "kind", "csv"]);
        const requestId = validateRequestId(body.requestId);
        if (typeof body.kind !== "string") throw new InventoryApiError(400, "Choose a supported import type.");
        const records = parseSetupImportCsv(body.kind, body.csv);
        const requestHash = hashRequest({ kind: body.kind, records });
        const result = await pool.query(
          "SELECT v2.stage_setup_import($1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::jsonb) AS result",
          [...scope, actor, requestId, requestHash, body.kind, JSON.stringify(records)],
        );
        const staged = resultValue(result);
        sendJson(response, staged.replayed ? 200 : 201, { ...staged, records });
        return true;
      }

      if (isImports && url.pathname === `${IMPORTS_PATH}/workbooks/preview` && request.method === "POST") {
        operation = "preview_workbook_import";
        const body = await readJsonBody(request, MAX_WORKBOOK_BODY_BYTES);
        requireKeys(body, ["family", "fileName", "workbookBase64"]);
        const parsed = parseWorkbookUpload(body);
        const { products, priorLinks } = await workbookLinkContext(pool, scope, body.family);
        const rows = linkWorkbookCapacityRows(parsed.rows, products, priorLinks);
        sendJson(response, 200, {
          sourceFamily: body.family,
          fileName: parsed.fileName,
          fileSha256: parsed.fileSha256,
          rows: rows.map((row) => ({
            sourceKey: row.sourceKey,
            name: row.name,
            row: row.source.row,
            reason: row.linkType,
            productCode: row.productCode,
          })),
          products: products.map(({ code, name }) => ({ code, name })),
        });
        return true;
      }

      if (isImports && url.pathname === `${IMPORTS_PATH}/workbooks` && request.method === "POST") {
        operation = "create_workbook_import";
        const body = await readJsonBody(request, MAX_WORKBOOK_BODY_BYTES);
        const requiredKeys = ["requestId", "family", "fileName", "workbookBase64"];
        const allowedKeys = new Set([...requiredKeys, "productLinks"]);
        if (requiredKeys.some((key) => !Object.hasOwn(body, key))
          || Object.keys(body).some((key) => !allowedKeys.has(key))) {
          throw new InventoryApiError(400, "The request contains missing or unsupported fields.");
        }
        const requestId = validateRequestId(body.requestId);
        const managerLinks = validateWorkbookProductLinks(body.productLinks ?? []);
        const parsed = parseWorkbookUpload(body);
        const { products, priorLinks } = await workbookLinkContext(pool, scope, body.family);
        const automaticRows = linkWorkbookCapacityRows(parsed.rows, products, priorLinks);
        const unresolvedKeys = new Set(automaticRows.filter((row) => !row.productCode).map((row) => row.sourceKey));
        const productsByCode = new Map(products.map((product) => [product.code.toLocaleLowerCase("en-US"), product]));
        for (const link of managerLinks) {
          if (!unresolvedKeys.has(link.sourceKey)
            || !productsByCode.has(link.productCode.toLocaleLowerCase("en-US"))) {
            throw new InventoryApiError(400, "Choose an active product for an unmatched workbook row.");
          }
        }
        const linkedRows = linkWorkbookCapacityRows(parsed.rows, products, priorLinks, managerLinks);
        const records = linkedRows
          .filter((row) => row.productCode)
          .map((row) => ({
            code: `${body.family === "dough-procedure" ? "DOUGH" : "SHIP"}-${row.sourceKey}`,
            name: row.name,
            productCode: row.productCode,
            data: body.family === "dough-procedure"
              ? {
                sourceFamily: body.family,
                sourceKey: row.sourceKey,
                fileName: parsed.fileName,
                fileSha256: parsed.fileSha256,
                source: row.source,
                doughballYield: row.doughballYield,
                doughballWeightOz: row.doughballWeightOz,
                doughballsPerTray: row.doughballsPerTray,
              }
              : {
                sourceFamily: body.family,
                sourceKey: row.sourceKey,
                fileName: parsed.fileName,
                fileSha256: parsed.fileSha256,
                source: row.source,
                pizzasPerCase: row.pizzasPerCase,
              },
          }));
        if (records.length === 0) {
          throw new InventoryApiError(
            409,
            "No workbook rows are linked to active products. Select an active product for at least one row before staging.",
          );
        }
        const kind = body.family === "dough-procedure" ? "recipes" : "production-setups";
        const requestHash = hashRequest({ family: body.family, fileSha256: parsed.fileSha256, records });
        const result = await pool.query(
          "SELECT v2.stage_setup_import($1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::jsonb) AS result",
          [...scope, actor, requestId, requestHash, kind, JSON.stringify(records)],
        );
        const staged = resultValue(result);
        const unmatchedRows = linkedRows
          .filter((row) => !row.productCode)
          .map((row) => ({
            sourceKey: row.sourceKey,
            name: row.name,
            row: row.source.row,
            reason: row.linkType,
          }));
        sendJson(response, staged.replayed ? 200 : 201, {
          ...staged,
          records,
          sourceFamily: body.family,
          fileName: parsed.fileName,
          fileSha256: parsed.fileSha256,
          linkedCount: records.length,
          rememberedCount: linkedRows.filter((row) => row.linkType === "remembered").length,
          managerMappedCount: linkedRows.filter((row) => row.linkType === "manager").length,
          unmatchedRows: unmatchedRows.slice(0, 100),
          unmatchedCount: unmatchedRows.length,
          invalidValueCount: linkedRows.filter((row) => body.family === "dough-procedure"
            ? row.doughballYield === null
            : row.pizzasPerCase === null).length,
        });
        return true;
      }

      const importDetail = url.pathname.match(/^\/api\/v2\/imports\/([^/]+)$/);
      if (isImports && importDetail && request.method === "GET") {
        operation = "get_import";
        if (url.search) throw new InventoryApiError(400, "Import details do not accept query parameters.");
        const importId = validateUuid(importDetail[1], "Import ID");
        const result = await pool.query(
          "SELECT v2.get_setup_import($1::uuid, $2::uuid) AS result",
          [...scope, importId],
        );
        const value = resultValue(result);
        if (!value) throw new InventoryApiError(404, "Setup import not found.");
        sendJson(response, 200, { import: value });
        return true;
      }

      const importAction = url.pathname.match(/^\/api\/v2\/imports\/([^/]+)\/(apply|undo)$/);
      if (isImports && importAction && request.method === "POST") {
        const importId = validateUuid(importAction[1], "Import ID");
        const action = importAction[2];
        operation = action === "apply" ? "apply_import" : "undo_import";
        const body = await readJsonBody(request);
        requireKeys(body, []);
        const functionName = action === "apply" ? "apply_setup_import" : "undo_setup_import";
        const result = await pool.query(
          `SELECT v2.${functionName}($1::uuid, $2::uuid, $3::uuid) AS result`,
          [...scope, actor, importId],
        );
        sendJson(response, 200, resultValue(result));
        return true;
      }

      if (isInventory && url.pathname === `${INVENTORY_PATH}/warehouses` && request.method === "GET") {
        operation = "list_warehouses";
        if (url.search) throw new InventoryApiError(400, "Warehouse lists do not accept query parameters.");
        const result = await pool.query(
          "SELECT v2.list_inventory_warehouses($1::uuid) AS result",
          scope,
        );
        sendJson(response, 200, { warehouses: resultValue(result) });
        return true;
      }
      if (isInventory && url.pathname === `${INVENTORY_PATH}/warehouses` && request.method === "POST") {
        operation = "create_warehouse";
        const body = await readJsonBody(request);
        requireKeys(body, ["requestId", "name"]);
        const requestId = validateRequestId(body.requestId);
        if (typeof body.name !== "string") throw new InventoryApiError(400, "Enter a warehouse name.");
        const name = body.name.trim();
        const result = await pool.query(
          "SELECT v2.create_inventory_warehouse($1::uuid, $2::uuid, $3::text, $4::text, $5::text) AS result",
          [...scope, actor, requestId, hashRequest({ name }), name],
        );
        const value = resultValue(result);
        sendJson(response, value.replayed ? 200 : 201, value);
        return true;
      }
      if (isInventory && url.pathname === `${INVENTORY_PATH}/production-warehouse` && request.method === "POST") {
        operation = "set_production_warehouse";
        const body = await readJsonBody(request);
        requireKeys(body, ["requestId", "warehouseId"]);
        const requestId = validateRequestId(body.requestId);
        const warehouseId = validateUuid(body.warehouseId, "Production warehouse ID");
        const result = await pool.query(
          "SELECT v2.set_production_warehouse($1::uuid, $2::uuid, $3::text, $4::text, $5::uuid) AS result",
          [...scope, actor, requestId, hashRequest({ warehouseId }), warehouseId],
        );
        const value = resultValue(result);
        sendJson(response, value.replayed ? 200 : 201, value);
        return true;
      }
      if (isInventory && url.pathname === `${INVENTORY_PATH}/products` && request.method === "GET") {
        operation = "list_products";
        if (url.search) throw new InventoryApiError(400, "Product lists do not accept query parameters.");
        const result = await pool.query(
          "SELECT v2.list_inventory_products($1::uuid) AS result",
          scope,
        );
        sendJson(response, 200, { products: resultValue(result) });
        return true;
      }
      if (isInventory && url.pathname === `${INVENTORY_PATH}/stock` && request.method === "GET") {
        operation = "list_stock";
        const warehouseId = parseWarehouseId(url);
        const result = await pool.query(
          "SELECT v2.list_inventory_stock($1::uuid, $2::uuid) AS result",
          [...scope, warehouseId],
        );
        sendJson(response, 200, { stock: resultValue(result) });
        return true;
      }
      if (isInventory && url.pathname === `${INVENTORY_PATH}/movements` && request.method === "GET") {
        operation = "list_movements";
        const warehouseId = parseWarehouseId(url, { allowMovementCursor: true });
        const limit = parseLimit(url, { extra: ["warehouseId", "beforeAt", "beforeId"] });
        const [beforeAt, beforeId] = parseMovementCursor(url);
        const result = await pool.query(
          "SELECT v2.list_inventory_movements($1::uuid, $2::uuid, $3::integer, $4::timestamptz, $5::uuid) AS result",
          [...scope, warehouseId, limit, beforeAt, beforeId],
        );
        const page = resultValue(result);
        sendJson(response, 200, { movements: page.items, nextCursor: page.nextCursor });
        return true;
      }
      if (isInventory && url.pathname === `${INVENTORY_PATH}/movements` && request.method === "POST") {
        operation = "record_movement";
        const body = await readJsonBody(request);
        requireKeys(body, ["commandId", "warehouseId", "productCode", "type", "quantity", "reason"]);
        const commandId = validateRequestId(body.commandId);
        const warehouseId = validateUuid(body.warehouseId, "Warehouse ID");
        if (typeof body.productCode !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(body.productCode)) {
          throw new InventoryApiError(400, "Enter a valid product code.");
        }
        if (body.type !== "receipt" && body.type !== "adjustment") {
          throw new InventoryApiError(400, "Choose a receipt or stock adjustment.");
        }
        const quantity = validateQuantity(body.quantity, { nonzero: true });
        if (body.type === "receipt" && quantity.startsWith("-")) {
          throw new InventoryApiError(400, "A receipt quantity must be positive.");
        }
        const reason = validateReason(body.reason);
        const payload = { warehouseId, productCode: body.productCode, type: body.type, quantity, reason };
        const result = await pool.query(
          "SELECT v2.record_inventory_movement($1::uuid, $2::uuid, $3::text, $4::text, $5::uuid, $6::text, $7::text, $8::numeric, $9::text) AS result",
          [...scope, actor, commandId, hashRequest(payload), warehouseId, body.productCode, body.type, quantity, reason],
        );
        sendJson(response, 200, resultValue(result));
        return true;
      }
      if (isInventory && url.pathname === `${INVENTORY_PATH}/transfers` && request.method === "POST") {
        operation = "transfer_stock";
        const body = await readJsonBody(request);
        requireKeys(body, ["commandId", "sourceWarehouseId", "targetWarehouseId", "productCode", "quantity", "reason"]);
        const commandId = validateRequestId(body.commandId);
        const sourceId = validateUuid(body.sourceWarehouseId, "Source warehouse ID");
        const targetId = validateUuid(body.targetWarehouseId, "Target warehouse ID");
        if (sourceId === targetId) throw new InventoryApiError(400, "Choose two different warehouses.");
        if (typeof body.productCode !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(body.productCode)) {
          throw new InventoryApiError(400, "Enter a valid product code.");
        }
        const quantity = validateQuantity(body.quantity, { positive: true, nonzero: true });
        const reason = validateReason(body.reason);
        const payload = { sourceId, targetId, productCode: body.productCode, quantity, reason };
        const result = await pool.query(
          "SELECT v2.transfer_inventory($1::uuid, $2::uuid, $3::text, $4::text, $5::uuid, $6::uuid, $7::text, $8::numeric, $9::text) AS result",
          [...scope, actor, commandId, hashRequest(payload), sourceId, targetId, body.productCode, quantity, reason],
        );
        sendJson(response, 200, resultValue(result));
        return true;
      }
      if (isInventory && url.pathname === `${INVENTORY_PATH}/opening-counts` && request.method === "GET") {
        operation = "list_opening_counts";
        const result = await pool.query(
          "SELECT v2.list_opening_counts($1::uuid, $2::integer) AS result",
          [...scope, parseLimit(url)],
        );
        sendJson(response, 200, { counts: resultValue(result) });
        return true;
      }
      if (isInventory && url.pathname === `${INVENTORY_PATH}/opening-counts` && request.method === "POST") {
        operation = "stage_opening_count";
        const body = await readJsonBody(request);
        requireKeys(body, ["requestId", "warehouseId", "csv"]);
        const requestId = validateRequestId(body.requestId);
        const warehouseId = validateUuid(body.warehouseId, "Warehouse ID");
        const productsResult = await pool.query(
          "SELECT v2.list_inventory_products($1::uuid) AS result",
          scope,
        );
        const products = resultValue(productsResult);
        if (!Array.isArray(products) || products.length === 0) {
          throw new InventoryApiError(409, "Import products before starting an opening count.");
        }
        const rows = parseOpeningCountCsv(body.csv, products.map((product) => product.code));
        const requestHash = hashRequest({ warehouseId, rows });
        const result = await pool.query(
          "SELECT v2.stage_opening_count($1::uuid, $2::uuid, $3::text, $4::text, $5::uuid, $6::jsonb) AS result",
          [...scope, actor, requestId, requestHash, warehouseId, JSON.stringify(rows)],
        );
        const value = resultValue(result);
        sendJson(response, value.replayed ? 200 : 201, { ...value, rows });
        return true;
      }

      const countAction = url.pathname.match(/^\/api\/v2\/inventory\/opening-counts\/([^/]+)(?:\/(review|apply))?$/);
      if (isInventory && countAction) {
        const countId = validateUuid(countAction[1], "Count ID");
        const action = countAction[2];
        if (!action && request.method === "GET") {
          operation = "get_opening_count";
          const result = await pool.query(
            "SELECT v2.get_opening_count($1::uuid, $2::uuid) AS result",
            [...scope, countId],
          );
          const value = resultValue(result);
          if (!value) throw new InventoryApiError(404, "Opening count not found.");
          sendJson(response, 200, { count: value });
          return true;
        }
        if (action && request.method === "POST") {
          operation = action === "review" ? "review_opening_count" : "apply_opening_count";
          const body = await readJsonBody(request);
          requireKeys(body, []);
          const functionName = action === "review" ? "review_opening_count" : "apply_opening_count";
          const result = await pool.query(
            `SELECT v2.${functionName}($1::uuid, $2::uuid, $3::uuid) AS result`,
            [...scope, actor, countId],
          );
          sendJson(response, 200, resultValue(result));
          return true;
        }
      }
      throw new InventoryApiError(404, "Inventory route not found.");
    } catch (error) {
      const status = safeStatus(error);
      if (status >= 500) {
        logger({
          event: "v2.inventory_api.error",
          requestId: request.v2RequestId ?? null,
          operation,
          status,
          errorName: typeof error?.name === "string" ? error.name.slice(0, 80) : "UnknownError",
          databaseCode: typeof error?.code === "string" && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : undefined,
        });
      }
      const headers = Number.isSafeInteger(error?.retryAfterSeconds)
        ? { "Retry-After": String(error.retryAfterSeconds) }
        : {};
      sendJson(response, status, { error: safeMessage(error, operation) }, headers);
      return true;
    }
  };
}
