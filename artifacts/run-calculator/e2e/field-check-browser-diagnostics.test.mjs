import { test } from "node:test";
import assert from "node:assert/strict";
import { reloadNetworkPath } from "./field-check-browser-diagnostics.mjs";

const context = { engine: "webkit", reloading: true, origin: "http://127.0.0.1:12345" };
const diagnostic = (path) => ({
  name: "Fetch API cannot load http",
  message: `/127.0.0.1:12345${path} due to access control checks.`,
});

test("retains exact same-origin WPE reload network diagnostics as route categories", () => {
  for (const path of ["/api/incidents", "/api/factory-data"]) {
    assert.equal(reloadNetworkPath(diagnostic(path), context), path);
  }
});
test("does not classify normal-operation errors, other engines, origins, routes or JS exceptions", () => {
  for (const altered of [{ reloading: false }, { engine: "chromium" }, { origin: "http://localhost:12345" }]) {
    assert.equal(reloadNetworkPath(diagnostic("/api/incidents"), { ...context, ...altered }), null);
  }
  for (const path of ["/api/sync/today", "/api/field-checks", "/unknown"]) {
    assert.equal(reloadNetworkPath(diagnostic(path), context), null);
  }
  assert.equal(reloadNetworkPath({ ...diagnostic("/api/incidents"), name: "TypeError" }, context), null);
  assert.equal(reloadNetworkPath({ ...diagnostic("/api/incidents"), message: "Unhandled error" }, context), null);
});
