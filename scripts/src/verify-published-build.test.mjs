import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { buildInfoFromRecord, createSourceRecord } from "./build-source-identity.mjs";
import { sourceFixture } from "./fixtures/build-identity-fixture.mjs";
import { createPublishedSourceHandoff, verifyPublishedBuild } from "./verify-published-build.mjs";

async function fixture(t, respond, respondHealth = (res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ok" }));
}) {
  const expected = createSourceRecord(sourceFixture(t));
  const info = buildInfoFromRecord(expected, "release");
  const server = createServer((req, res) => {
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers.cookie, undefined);
    if (req.url === "/api/build-info") respond(res, info);
    else if (req.url === "/api") respondHealth(res);
    else { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { url: `http://127.0.0.1:${server.address().port}`, expected };
}

test("an exact source match creates an expiring receipt, never production approval", async (t) => {
  const input = await fixture(t, (res, info) => {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(info));
  });
  const receipt = await verifyPublishedBuild(input);
  assert.equal(receipt.status, "source-match");
  assert.equal(receipt.productionGo, false);
  assert.equal(receipt.authority, "application-source-comparison-only");
  assert(receipt.unresolvedIdentityRequirements.includes("controlled-published-deployment-handoff"));
  assert(!JSON.stringify(receipt).includes(input.url));
  assert.equal(Date.parse(receipt.expiresAt) - Date.parse(receipt.capturedAt), 86_400_000);
});

for (const [name, mutate] of [
  ["wrong source", (r) => ({ ...r, sourceFingerprintSha256: "f".repeat(64) })],
  ["wrong app build", (r) => ({ ...r, appBuildId: "app-build:00000000-0000-0000-0000-000000000000" })],
  ["development build", (r) => ({ ...r, buildMode: "development" })],
  ["unsupported schema", (r) => ({ ...r, schemaVersion: 2 })],
  ["sensitive extra field", (r) => ({ ...r, token: "synthetic" })],
  ["invalid timestamp", (r) => ({ ...r, completedAt: "tomorrow" })],
]) {
  test(`${name} cannot create a source-match receipt`, async (t) => {
    const input = await fixture(t, (res, info) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(mutate(info)));
    });
    await assert.rejects(verifyPublishedBuild(input));
  });
}

test("Git annotations are optional and cannot block an exact source match", async (t) => {
  const input = await fixture(t, (res, info) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ...info, gitRevision: "a".repeat(40), gitBinding: "verified" }));
  });
  assert.equal((await verifyPublishedBuild(input)).status, "source-match");
});

test("a source-based handoff is bound to the independent expectation without Git", async (t) => {
  const input = await fixture(t, (res, info) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(info));
  });
  assert.equal(input.expected.gitRevision, null);
  const handoff = await createPublishedSourceHandoff(input);
  assert.equal(handoff.schemaVersion, 2);
  assert.equal(handoff.deploymentId, input.expected.appBuildId);
  assert.equal(handoff.deployedRevision, `source-sha256:${input.expected.sourceFingerprintSha256}`);
  assert.deepEqual(handoff.expectedSource, input.expected);
  assert(!JSON.stringify(handoff).includes(input.url));
});

test("readiness verification waits through transient startup responses", async (t) => {
  let attempts = 0;
  const input = await fixture(t, (res, info) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(info));
  }, (res) => {
    attempts += 1;
    res.writeHead(attempts < 3 ? 503 : 200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: attempts < 3 ? "starting" : "ok" }));
  });
  assert.equal((await verifyPublishedBuild(input)).status, "source-match");
  assert.equal(attempts, 3);
});

test("unready or malformed health responses cannot produce a source-match receipt", async (t) => {
  const input = await fixture(t, (res, info) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(info));
  }, (res) => {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "starting" }));
  });
  await assert.rejects(verifyPublishedBuild({ ...input, timeoutMs: 100 }), /readiness timeout/);
});

for (const status of [401, 404, 503]) {
  test(`HTTP ${status} fails explicitly`, async (t) => {
    const input = await fixture(t, (res) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end("{}");
    });
    await assert.rejects(verifyPublishedBuild(input), /unavailable/);
  });
}

test("redirects, oversized bodies, invalid JSON and transport timeouts are rejected", async (t) => {
  for (const scenario of ["redirect", "oversize", "invalid", "timeout"]) {
    const input = await fixture(t, (res) => {
      if (scenario === "redirect") { res.writeHead(302, { Location: "/login" }); res.end(); }
      else if (scenario === "timeout") { /* timeout is the behavior under test */ }
      else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(scenario === "oversize" ? "x".repeat(8193) : "invalid JSON");
      }
    });
    await assert.rejects(verifyPublishedBuild({ ...input, timeoutMs: 100 }));
  }
});

test("invalid expected record fails before any fetch; insecure credential targets are rejected", async (t) => {
  const expected = createSourceRecord(sourceFixture(t));
  for (const url of ["http://example.invalid", "https://user:password@example.invalid",
    "https://example.invalid?token=synthetic"]) await assert.rejects(verifyPublishedBuild({ url, expected }));
  await assert.rejects(verifyPublishedBuild({ url: "https://example.invalid", expected: {} }), /prepared/);
});