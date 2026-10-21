// Smoke test for the local-first AI adapter
// (lib/integrations-openai-ai-server).
//
// The adapter dispatches to a self-hosted OpenAI-compatible server when
// LOCAL_AI_BASE_URL is set, and to Gemini otherwise. This check proves the
// local path end to end. It runs in two modes:
//
//   * REAL — when LOCAL_AI_BASE_URL is set, it exercises the configured
//     server (Ollama / llama.cpp) with a real completion and a real stream.
//   * MOCK — otherwise it boots an in-process OpenAI-compatible server and
//     runs the same assertions against it. This needs zero model downloads
//     and zero external API calls, so CI can gate the local dispatch path on
//     every run.
//
// Any failure throws, so the process exits non-zero and can gate a release.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";
import {
  openai,
  pickModel,
  resetGeminiResilienceForTests,
} from "@workspace/integrations-openai-ai-server";

const PROMPT = "ping";
const MOCK_TIMEOUT_MS = 20_000;
const REAL_TIMEOUT_MS = 120_000;

export interface LocalAiCheckResult {
  mode: "real" | "mock";
  baseURL: string;
  model: string;
  nonStreamContent: string;
  streamContent: string;
  transportFailureThrew: boolean;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

// A minimal OpenAI-compatible endpoint: enough for the SDK's chat.completions
// surface (non-stream + SSE stream) and the /models readiness probe.
async function handleMockRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? "";
  if (req.method === "GET" && (url === "/v1/models" || url === "/models")) {
    sendJson(res, 200, { object: "list", data: [{ id: "mock-model", object: "model" }] });
    return;
  }
  if (req.method === "POST" && url.startsWith("/v1/chat/completions")) {
    const raw = await readBody(req);
    let parsed: { model?: unknown; stream?: unknown } = {};
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      // Fall through with defaults; the SDK always sends valid JSON.
    }
    const model = typeof parsed.model === "string" ? parsed.model : "mock-model";
    const content = "pong";
    if (parsed.stream === true) {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const base = {
        id: "chatcmpl-mock",
        object: "chat.completion.chunk",
        created: 0,
        model,
      };
      res.write(
        `data: ${JSON.stringify({
          ...base,
          choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }],
        })}\n\n`,
      );
      res.write(
        `data: ${JSON.stringify({
          ...base,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        })}\n\n`,
      );
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    sendJson(res, 200, {
      id: "chatcmpl-mock",
      object: "chat.completion",
      created: 0,
      model,
      choices: [
        { index: 0, message: { role: "assistant", content }, finish_reason: "stop" },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    return;
  }
  sendJson(res, 404, { error: { message: `unhandled ${req.method} ${url}` } });
}

async function startMockServer(): Promise<{ server: Server; baseURL: string }> {
  const server = createServer((req, res) => {
    void handleMockRequest(req, res).catch((error: unknown) => {
      sendJson(res, 500, { error: { message: error instanceof Error ? error.message : "mock error" } });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as AddressInfo;
  return { server, baseURL: `http://127.0.0.1:${port}/v1` };
}

// Reserve an ephemeral port, then close it, so a connection attempt is refused.
async function closedPortBaseURL(): Promise<string> {
  const server = createServer((_req, res) => res.end());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${port}/v1`;
}

export async function runLocalAiCheck(): Promise<LocalAiCheckResult> {
  const configured = process.env.LOCAL_AI_BASE_URL?.trim();
  const mode: LocalAiCheckResult["mode"] = configured ? "real" : "mock";

  let server: Server | undefined;
  let baseURL: string;
  if (mode === "mock") {
    const started = await startMockServer();
    server = started.server;
    baseURL = started.baseURL;
  } else {
    baseURL = configured as string;
  }

  const previousBaseURL = process.env.LOCAL_AI_BASE_URL;
  const previousFallback = process.env.LOCAL_AI_FALLBACK_TO_GEMINI;
  process.env.LOCAL_AI_BASE_URL = baseURL;
  // The adapter caches its client; clear it so the new env takes effect.
  resetGeminiResilienceForTests();

  const timeoutMs = mode === "real" ? REAL_TIMEOUT_MS : MOCK_TIMEOUT_MS;
  const model = pickModel("full");

  try {
    // 1. Non-stream round-trip.
    const completion = await openai.chat.completions.create(
      {
        model,
        messages: [{ role: "user", content: PROMPT }],
        max_completion_tokens: 16,
      },
      { timeoutMs },
    );
    const nonStreamContent = completion.choices[0]?.message.content ?? "";
    if (!nonStreamContent.trim()) {
      throw new Error("non-stream completion returned empty content");
    }

    // 2. Streaming round-trip.
    const stream = await openai.chat.completions.create(
      {
        model,
        messages: [{ role: "user", content: PROMPT }],
        max_completion_tokens: 16,
        stream: true,
      },
      { timeoutMs },
    );
    let streamContent = "";
    for await (const chunk of stream) {
      streamContent += chunk.choices[0]?.delta.content ?? "";
    }
    if (!streamContent.trim()) {
      throw new Error("stream completion returned empty content");
    }

    // 3. A transport-level failure must surface (never a silent success).
    // Only asserted in mock mode, where we can point at a dead port without
    // disturbing a real deployment. Fallback is forced off so a configured
    // Gemini key cannot mask the failure.
    let transportFailureThrew = false;
    if (mode === "mock") {
      process.env.LOCAL_AI_BASE_URL = await closedPortBaseURL();
      process.env.LOCAL_AI_FALLBACK_TO_GEMINI = "false";
      resetGeminiResilienceForTests();
      try {
        await openai.chat.completions.create(
          { model, messages: [{ role: "user", content: PROMPT }] },
          { timeoutMs: 5_000 },
        );
      } catch {
        transportFailureThrew = true;
      }
      if (!transportFailureThrew) {
        throw new Error("a transport failure did not surface as an error");
      }
    }

    return { mode, baseURL, model, nonStreamContent, streamContent, transportFailureThrew };
  } finally {
    if (previousBaseURL === undefined) delete process.env.LOCAL_AI_BASE_URL;
    else process.env.LOCAL_AI_BASE_URL = previousBaseURL;
    if (previousFallback === undefined) delete process.env.LOCAL_AI_FALLBACK_TO_GEMINI;
    else process.env.LOCAL_AI_FALLBACK_TO_GEMINI = previousFallback;
    resetGeminiResilienceForTests();
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }
  }
}

async function main(): Promise<void> {
  const result = await runLocalAiCheck();
  console.log(`local-ai check: PASS (${result.mode} mode)`);
  console.log(`  baseURL:            ${result.baseURL}`);
  console.log(`  model:              ${result.model}`);
  console.log(`  non-stream content: ${JSON.stringify(result.nonStreamContent)}`);
  console.log(`  stream content:     ${JSON.stringify(result.streamContent)}`);
  if (result.mode === "mock") {
    console.log(`  transport failure surfaced: ${result.transportFailureThrew}`);
    console.log("  (mock mode: no model download, no external API)");
  }
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error("local-ai check: FAIL");
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
