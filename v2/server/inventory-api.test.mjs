import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import * as XLSX from "xlsx";
import { createInventoryApi } from "./inventory-api.mjs";

const MANAGER = {
  verified: true,
  facilityId: "10000000-0000-4000-8000-000000000001",
  actorId: "10000000-0000-4000-8000-000000000002",
  capabilities: ["manage-inventory"],
};
const WAREHOUSE_ID = "10000000-0000-4000-8000-000000000003";

async function withApi(t, { auth = MANAGER, csrf = true, query = async () => ({ rows: [{ result: [] }] }), logger = () => {} } = {}) {
  const calls = [];
  const pool = {
    async query(text, values) {
      calls.push({ text, values });
      return query(text, values);
    },
  };
  const handler = createInventoryApi({
    pool,
    authenticate: async () => auth,
    verifyCsrf: async (request) => csrf && request.headers["x-csrf-token"] === "ok",
    logger,
  });
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, calls };
}

function send(baseUrl, path, { method = "GET", body, csrf = true } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? {} : {
      "content-type": "application/json",
      ...(csrf ? { "x-csrf-token": "ok" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function workbookBase64(rows) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Procedure");
  return XLSX.write(workbook, { type: "base64", bookType: "xlsx" });
}

test("inventory routes require a verified manager before database access", async (t) => {
  const unauthenticated = await withApi(t, { auth: null });
  const unauthResponse = await send(unauthenticated.baseUrl, "/api/v2/inventory/warehouses");
  assert.equal(unauthResponse.status, 401);
  assert.deepEqual(await unauthResponse.json(), { error: "Sign in to access inventory." });
  assert.equal(unauthenticated.calls.length, 0);

  const operator = await withApi(t, { auth: { ...MANAGER, capabilities: [] } });
  const operatorResponse = await send(operator.baseUrl, "/api/v2/inventory/warehouses");
  assert.equal(operatorResponse.status, 403);
  assert.equal(operator.calls.length, 0);
});

test("setup import CSV is validated before staging and request hash is server-computed", async (t) => {
  const staged = {
    outcome: "staged",
    importId: "10000000-0000-4000-8000-000000000004",
    kind: "products",
    rowCount: 1,
    replayed: false,
  };
  const api = await withApi(t, {
    query: async () => ({ rows: [{ result: staged }] }),
  });
  const invalid = await send(api.baseUrl, "/api/v2/imports", {
    method: "POST",
    body: { requestId: "import-1", kind: "products", csv: "name,code,unit\nFlour,FLOUR,lb\n" },
  });
  assert.equal(invalid.status, 400);
  assert.equal(api.calls.length, 0);

  const response = await send(api.baseUrl, "/api/v2/imports", {
    method: "POST",
    body: { requestId: "import-1", kind: "products", csv: "code,name,unit\nFLOUR,Bread Flour,lb\n" },
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    ...staged,
    records: [{ code: "FLOUR", name: "Bread Flour", unit: "lb" }],
  });
  assert.match(api.calls[0].text, /stage_setup_import/);
  assert.deepEqual(api.calls[0].values.slice(0, 5), [
    MANAGER.facilityId,
    MANAGER.actorId,
    "import-1",
    api.calls[0].values[3],
    "products",
  ]);
  assert.match(api.calls[0].values[3], /^[0-9a-f]{64}$/);
  assert.notEqual(api.calls[0].values[3], "client-hash");
  assert.equal(api.calls[0].values[5], JSON.stringify([{ code: "FLOUR", name: "Bread Flour", unit: "lb" }]));
});

test("workbook source rows are linked exactly and staged through the reviewed import lifecycle", async (t) => {
  const api = await withApi(t, {
    query: async (sql, values) => {
      if (sql.includes("list_inventory_products")) {
        return { rows: [{ result: [{ code: "DOUGH-A", name: "North Shop" }] }] };
      }
      if (sql.includes("list_workbook_source_links")) return { rows: [{ result: [] }] };
      if (sql.includes("stage_setup_import")) {
        return { rows: [{ result: {
          outcome: "staged",
          importId: "10000000-0000-4000-8000-000000000008",
          kind: values[4],
          rowCount: JSON.parse(values[5]).length,
          replayed: false,
        } }] };
      }
      throw new Error("Unexpected test query");
    },
  });
  const response = await send(api.baseUrl, "/api/v2/imports/workbooks", {
    method: "POST",
    body: {
      requestId: "dough-workbook-1",
      family: "dough-procedure",
      fileName: "north-dough.xlsx",
      workbookBase64: workbookBase64([
        ["Customer", "OZ", "LBS", "YIELD", "PER TRAY"],
        ["North Shop", 7.7, 310.5, 645.19, 84],
      ]),
    },
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.sourceFamily, "dough-procedure");
  assert.equal(body.linkedCount, 1);
  assert.equal(body.unmatchedCount, 0);
  assert.equal(body.records[0].productCode, "DOUGH-A");
  assert.equal(body.records[0].data.doughballYield, 645.19);
  assert.equal(body.records[0].data.source.yieldCell, "Procedure!D2");
  const stageCall = api.calls.find((call) => call.text.includes("stage_setup_import"));
  assert.ok(stageCall);
  assert.equal(stageCall.values[4], "recipes");
  assert.notEqual(stageCall.values[3], "client-hash");
});

test("workbook upload rejects unmatched rows and legacy XLS files without staging", async (t) => {
  const api = await withApi(t, {
    query: async (sql) => {
      if (sql.includes("list_inventory_products")) return { rows: [{ result: [] }] };
      if (sql.includes("list_workbook_source_links")) return { rows: [{ result: [] }] };
      throw new Error("Workbook with no matches should not stage");
    },
  });
  const validWorkbook = workbookBase64([
    ["Pizza", "Notes", "Pizzas/CS"],
    ["North Shop", "", 12],
  ]);
  const unmatched = await send(api.baseUrl, "/api/v2/imports/workbooks", {
    method: "POST",
    body: {
      requestId: "shipping-no-match",
      family: "shipping-guide",
      fileName: "shipping.xlsx",
      workbookBase64: validWorkbook,
    },
  });
  assert.equal(unmatched.status, 409);
  assert.match((await unmatched.json()).error, /matched an active product name exactly/u);

  const unsupported = await send(api.baseUrl, "/api/v2/imports/workbooks", {
    method: "POST",
    body: {
      requestId: "wrong-family",
      family: "dough-procedure",
      fileName: "schedule.xls",
      workbookBase64: validWorkbook,
    },
  });
  assert.equal(unsupported.status, 400);
  assert.equal(api.calls.length, 2);
});

test("setup import details can be reopened by another manager", async (t) => {
  const importId = "10000000-0000-4000-8000-000000000007";
  const record = {
    id: importId,
    kind: "recipes",
    status: "staged",
    records: [{ code: "DOUGH", name: "Bread Dough", productCode: "FLOUR", data: { hydration: 0.62 } }],
    createdBy: MANAGER.actorId,
    appliedBy: null,
    undoneBy: null,
    createdAt: "2026-11-16T12:00:00.000Z",
    appliedAt: null,
    undoneAt: null,
  };
  const api = await withApi(t, { query: async () => ({ rows: [{ result: record }] }) });
  const response = await send(api.baseUrl, `/api/v2/imports/${importId}`);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).import, record);
  assert.deepEqual(api.calls[0].values, [MANAGER.facilityId, importId]);
});

test("write routes enforce CSRF and bound the CSV body", async (t) => {
  const denied = await withApi(t, { csrf: false });
  const response = await send(denied.baseUrl, "/api/v2/inventory/warehouses", {
    method: "POST",
    body: { requestId: "warehouse-1", name: "Main" },
  });
  assert.equal(response.status, 403);
  assert.equal(denied.calls.length, 0);

  const api = await withApi(t);
  const oversized = await send(api.baseUrl, "/api/v2/imports", {
    method: "POST",
    body: { requestId: "too-large", kind: "products", csv: "x".repeat(2 * 1024 * 1024) },
  });
  assert.equal(oversized.status, 413);
  assert.equal(api.calls.length, 0);
});

test("CSV staging is rate-limited per manager with a Retry-After response", async (t) => {
  const api = await withApi(t, {
    query: async () => ({
      rows: [{
        result: {
          outcome: "staged",
          importId: "10000000-0000-4000-8000-000000000004",
          kind: "products",
          rowCount: 1,
          replayed: false,
        },
      }],
    }),
  });
  for (let index = 0; index < 10; index += 1) {
    const response = await send(api.baseUrl, "/api/v2/imports", {
      method: "POST",
      body: {
        requestId: `limited-${index}`,
        kind: "products",
        csv: `code,name,unit\nP${index},Product ${index},each\n`,
      },
    });
    assert.equal(response.status, 201);
  }
  const limited = await send(api.baseUrl, "/api/v2/imports", {
    method: "POST",
    body: { requestId: "limited-final", kind: "products", csv: "code,name,unit\nLAST,Last product,each\n" },
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
  assert.equal(api.calls.length, 10);
});

test("warehouse reads stay facility-scoped and reject unsupported query parameters", async (t) => {
  const api = await withApi(t, {
    query: async () => ({ rows: [{ result: [{ id: WAREHOUSE_ID, name: "Main", active: true }] }] }),
  });
  const response = await send(api.baseUrl, "/api/v2/inventory/warehouses?facilityId=other");
  assert.equal(response.status, 400);
  assert.equal(api.calls.length, 0);

  const valid = await send(api.baseUrl, `/api/v2/inventory/stock?warehouseId=${WAREHOUSE_ID}`);
  assert.equal(valid.status, 200);
  assert.deepEqual(api.calls[0].values, [MANAGER.facilityId, WAREHOUSE_ID]);
});

test("opening-count history is manager-scoped and bounded", async (t) => {
  const api = await withApi(t, {
    query: async () => ({
      rows: [{ result: [{
        id: "10000000-0000-4000-8000-000000000005",
        warehouseId: WAREHOUSE_ID,
        warehouseName: "Main",
        status: "reviewed",
        rowCount: 1,
        createdAt: "2026-11-16T12:00:00.000Z",
      }] }],
    }),
  });
  const response = await send(api.baseUrl, "/api/v2/inventory/opening-counts?limit=25");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).counts[0].status, "reviewed");
  assert.match(api.calls[0].text, /list_opening_counts/);
  assert.deepEqual(api.calls[0].values, [MANAGER.facilityId, 25]);

  const invalid = await send(api.baseUrl, "/api/v2/inventory/opening-counts?limit=101");
  assert.equal(invalid.status, 400);
  assert.equal(api.calls.length, 1);
});

test("movement history uses a bounded timestamp-and-ID cursor", async (t) => {
  const movementId = "10000000-0000-4000-8000-000000000006";
  const occurredAt = "2026-11-16T12:00:00.123456Z";
  const api = await withApi(t, {
    query: async () => ({
      rows: [{ result: {
        items: [{ id: movementId, actorId: MANAGER.actorId, occurredAt }],
        nextCursor: { id: movementId, occurredAt },
      } }],
    }),
  });
  const url = new URL(`/api/v2/inventory/movements?warehouseId=${WAREHOUSE_ID}&limit=25&beforeAt=${encodeURIComponent(occurredAt)}&beforeId=${movementId}`, "http://test");
  const response = await send(api.baseUrl, `${url.pathname}${url.search}`);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).nextCursor, { id: movementId, occurredAt });
  assert.deepEqual(api.calls[0].values, [MANAGER.facilityId, WAREHOUSE_ID, 25, occurredAt, movementId]);

  const invalid = await send(api.baseUrl, `/api/v2/inventory/movements?warehouseId=${WAREHOUSE_ID}&beforeId=${movementId}`);
  assert.equal(invalid.status, 400);
  assert.equal(api.calls.length, 1);
});

test("unexpected database errors are safe to callers and do not log request data", async (t) => {
  const logs = [];
  const api = await withApi(t, {
    query: async () => {
      throw Object.assign(new Error("sensitive SQL and CSV contents"), { code: "XX001", name: "DatabaseError" });
    },
    logger: (entry) => logs.push(entry),
  });
  const response = await send(api.baseUrl, "/api/v2/inventory/warehouses");
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "The inventory request could not be completed. Refresh and try again.",
  });
  assert.doesNotMatch(JSON.stringify(logs), /sensitive SQL|CSV contents/);
  assert.equal(logs[0].event, "v2.inventory_api.error");
  assert.equal(logs[0].operation, "list_warehouses");
});
