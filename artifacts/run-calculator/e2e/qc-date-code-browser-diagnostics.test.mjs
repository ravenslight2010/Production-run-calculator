import { test } from "node:test";
import assert from "node:assert/strict";
import { isBackgroundWebKitNetworkDiagnostic as classified } from "./qc-date-code-browser-diagnostics.mjs";

const diagnostic = (path) => ({
  name: "Fetch API cannot load http",
  message: `/127.0.0.1:12345${path} due to access control checks.`,
});

test("classifies only the exact local WebKit background network diagnostic", () => {
  for (const path of ["/api/me", "/app-build.json?check=1", "/api/incidents", "/api/field-checks/observations"]) {
    assert.equal(classified(diagnostic(path), "webkit"), true);
  }
});
test("never excludes QC requests, unexpected JS failures, external origins or another engine", () => {
  for (const path of ["/api/qc/date-code-checks", "/api/qc/date-code-references", "/api/sync/today", "/unknown"]) {
    assert.equal(classified(diagnostic(path), "webkit"), false);
  }
  assert.equal(classified({ ...diagnostic("/api/me"), name: "TypeError" }, "webkit"), false);
  assert.equal(classified({ ...diagnostic("/api/me"), message: "Unhandled exception" }, "webkit"), false);
  assert.equal(classified({ ...diagnostic("/api/me"), message: "/example.com/api/me due to access control checks." }, "webkit"), false);
  assert.equal(classified(diagnostic("/api/me"), "chromium"), false);
});
