import assert from "node:assert/strict";
import { test } from "node:test";
import { checkGeminiFallbackAvailability } from "./check-gemini-fallbacks.mts";

test("checks configured model rungs sequentially and reports availability only", async () => {
  const calls: string[] = [];
  const results = await checkGeminiFallbackAvailability(
    ["fallback-a", "fallback-b", "fallback-c"],
    async (model) => {
      calls.push(model);
      if (model === "fallback-b") throw new Error("private provider response");
    },
  );

  assert.deepEqual(calls, ["fallback-a", "fallback-b", "fallback-c"]);
  assert.deepEqual(results, [
    { rung: 1, model: "fallback-a", available: true },
    { rung: 2, model: "fallback-b", available: false },
    { rung: 3, model: "fallback-c", available: true },
  ]);
  assert.equal(
    JSON.stringify(results).includes("private provider response"),
    false,
  );
});

test("returns an empty report when no fallback models are configured", async () => {
  let called = false;
  const results = await checkGeminiFallbackAvailability([], async () => {
    called = true;
  });

  assert.deepEqual(results, []);
  assert.equal(called, false);
});
