import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { readStationWorkerHealth } from "./worker-health.mjs";

test("worker health client only accepts bounded, redacted health snapshots", async () => {
  const workerHealth = {
    status: "active",
    lastCycleAt: "2026-11-17T06:00:00.000Z",
    lastSuccessAt: "2026-11-17T06:00:00.000Z",
    consecutiveFailures: 0,
    lastErrorName: null,
    processedLastCycle: 2,
    ownerId: "must-not-escape",
  };
  const result = await readStationWorkerHealth({
    port: 3001,
    fetchImpl: async (url, options) => {
      assert.equal(url, "http://127.0.0.1:3001/healthz");
      assert.equal(options.headers.accept, "application/json");
      assert.equal(options.redirect, "error");
      return new Response(JSON.stringify(workerHealth), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.deepEqual(result, {
    status: "active",
    lastCycleAt: "2026-11-17T06:00:00.000Z",
    lastSuccessAt: "2026-11-17T06:00:00.000Z",
    consecutiveFailures: 0,
    lastErrorName: null,
    processedLastCycle: 2,
  });
});

test("worker health client rejects invalid snapshots and unavailable worker processes", async () => {
  const invalidFetch = async () => new Response(JSON.stringify({
    status: "active",
    lastCycleAt: null,
    lastSuccessAt: null,
    consecutiveFailures: -1,
    lastErrorName: "bad error name!",
    processedLastCycle: 0,
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  await assert.rejects(readStationWorkerHealth({ port: 3001, fetchImpl: invalidFetch }), /invalid/i);
  await assert.rejects(
    readStationWorkerHealth({
      port: 3001,
      fetchImpl: async () => new Response("not available", { status: 503 }),
    }),
    /unavailable/i,
  );
  await assert.rejects(
    readStationWorkerHealth({
      port: 3001,
      fetchImpl: async () => new Response("x".repeat(4097), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    }),
    /too large/i,
  );
});

test("worker health listener is loopback-only and serves no other route", async () => {
  const { createHealthHandler } = await import("./worker-main.mjs");
  const health = {
    status: "standby",
    lastCycleAt: null,
    lastSuccessAt: null,
    consecutiveFailures: 0,
    lastErrorName: null,
    processedLastCycle: 0,
    ownerId: "must-not-escape",
  };
  const server = createServer(createHealthHandler(() => health));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    assert.equal(address.address, "127.0.0.1");
    const valid = await fetch(`http://127.0.0.1:${address.port}/healthz`);
    assert.equal(valid.status, 200);
    assert.deepEqual(await valid.json(), {
      status: "standby",
      lastCycleAt: null,
      lastSuccessAt: null,
      consecutiveFailures: 0,
      lastErrorName: null,
      processedLastCycle: 0,
    });
    const invalid = await fetch(`http://127.0.0.1:${address.port}/debug`);
    assert.equal(invalid.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
