// Unit tests for the local-AI smoke check. These run entirely against the
// in-process mock server (LOCAL_AI_BASE_URL is cleared), so they need no model
// download and no external API.

import assert from "node:assert/strict";
import test from "node:test";
import { runLocalAiCheck } from "./check-local-ai.mts";

test("local-ai adapter round-trips (non-stream + stream) through the mock server", async () => {
  const previousBaseURL = process.env.LOCAL_AI_BASE_URL;
  const previousFallback = process.env.LOCAL_AI_FALLBACK_TO_GEMINI;
  delete process.env.LOCAL_AI_BASE_URL;
  try {
    const result = await runLocalAiCheck();
    assert.equal(result.mode, "mock");
    assert.ok(result.nonStreamContent.trim().length > 0, "non-stream content is non-empty");
    assert.ok(result.streamContent.trim().length > 0, "stream content is non-empty");
    assert.equal(result.transportFailureThrew, true, "transport failure surfaced");
    assert.match(result.baseURL, /^http:\/\/127\.0\.0\.1:\d+\/v1$/);
  } finally {
    if (previousBaseURL === undefined) delete process.env.LOCAL_AI_BASE_URL;
    else process.env.LOCAL_AI_BASE_URL = previousBaseURL;
    if (previousFallback === undefined) delete process.env.LOCAL_AI_FALLBACK_TO_GEMINI;
    else process.env.LOCAL_AI_FALLBACK_TO_GEMINI = previousFallback;
  }
});

test("local-ai check restores the caller's environment", async () => {
  // Port 1 refuses immediately (no DNS, no wait), so this stays fast and
  // offline. Fallback is forced off so a configured Gemini key cannot mask it.
  const sentinel = "http://127.0.0.1:1/v1";
  const previousBaseURL = process.env.LOCAL_AI_BASE_URL;
  const previousFallback = process.env.LOCAL_AI_FALLBACK_TO_GEMINI;
  process.env.LOCAL_AI_BASE_URL = sentinel;
  process.env.LOCAL_AI_FALLBACK_TO_GEMINI = "false";
  try {
    // A real-mode run against an unreachable host must throw (no silent pass)…
    await assert.rejects(() => runLocalAiCheck());
    // …and must leave the caller's environment untouched.
    assert.equal(process.env.LOCAL_AI_BASE_URL, sentinel);
  } finally {
    if (previousBaseURL === undefined) delete process.env.LOCAL_AI_BASE_URL;
    else process.env.LOCAL_AI_BASE_URL = previousBaseURL;
    if (previousFallback === undefined) delete process.env.LOCAL_AI_FALLBACK_TO_GEMINI;
    else process.env.LOCAL_AI_FALLBACK_TO_GEMINI = previousFallback;
  }
});
