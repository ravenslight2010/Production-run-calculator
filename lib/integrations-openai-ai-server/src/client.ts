// Gemini-backed adapter that preserves the OpenAI chat-completions surface the
// rest of the server is written against. Works with either the Replit AI
// Integrations proxy (AI_INTEGRATIONS_GEMINI_BASE_URL / API key) or a direct
// Gemini API key (GOOGLE_API_KEY from aistudio.google.com) — the client picks
// whichever is configured.
//
// Only the small slice of the OpenAI API the app actually uses is implemented:
//   openai.chat.completions.create({ model, messages, response_format,
//                                    max_completion_tokens, stream? })
// returning either { choices: [{ message: { content } }] } (non-stream) or an
// async iterable of { choices: [{ delta: { content } }] } (stream). Vision is
// supported via `image_url` data-URI parts. Everything else in the app (routes,
// prompts, parsing) stays byte-for-byte unchanged.
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import type { Content, Part, GenerateContentConfig } from "@google/genai";
import { modelChain } from "./models";

type TextPart = { type: "text"; text: string };
type ImagePart = { type: "image_url"; image_url: { url: string } };
type ChatContent = string | Array<TextPart | ImagePart> | null;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: ChatContent;
}

interface CreateParamsBase {
  model: string;
  messages: ChatMessage[];
  response_format?: { type: "json_object" | "text" };
  max_completion_tokens?: number;
}
interface CreateParamsSync extends CreateParamsBase {
  stream?: false;
}
interface CreateParamsStream extends CreateParamsBase {
  stream: true;
}

interface ChatResponse {
  choices: Array<{ message: { content: string | null } }>;
  /**
   * The model that actually produced the content — differs from the requested
   * model when a fallback served the call, so callers that cache results can
   * avoid filing fallback output under the primary model's key.
   */
  model: string;
}
interface ChatChunk {
  choices: Array<{ delta: { content: string | null } }>;
}

let _client: GoogleGenAI | null = null;
// Lazily construct the client so merely importing this module (e.g. in a
// non-AI context or a mocked test) never throws on a missing env var.
//
// Supports two paths:
//   1. Replit proxy (AI_INTEGRATIONS_GEMINI_API_KEY + BASE_URL) — the
//      original path; apiVersion is blanked and baseUrl is set explicitly.
//   2. Direct Gemini API (GOOGLE_API_KEY) — standard key from
//      aistudio.google.com; the SDK's default base URL is used.
function client(): GoogleGenAI {
  if (_client) return _client;
  const replitKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const replitBase = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  const directKey = process.env.GOOGLE_API_KEY;
  const apiKey = replitKey || directKey;
  if (!apiKey) {
    throw new Error(
      "No Gemini API key found. Set GOOGLE_API_KEY for the direct Gemini API " +
        "(get one at https://aistudio.google.com/apikey), or set " +
        "AI_INTEGRATIONS_GEMINI_API_KEY for the Replit proxy.",
    );
  }
  _client = new GoogleGenAI({
    apiKey,
    ...(replitKey && replitBase
      ? { httpOptions: { apiVersion: "", baseUrl: replitBase } }
      : {}),
  });
  return _client;
}

function dataUriToInlineData(
  url: string,
): { mimeType: string; data: string } | null {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(url);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

// Translate OpenAI-style messages into Gemini's system instruction + contents.
// System messages are merged into a single systemInstruction; user/assistant
// messages become user/model turns; string content becomes one text part while
// array content maps text and image_url parts (data URIs → inlineData).
function toGemini(messages: ChatMessage[]): {
  systemInstruction?: string;
  contents: Content[];
} {
  const systemChunks: string[] = [];
  const contents: Content[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      if (typeof msg.content === "string") {
        systemChunks.push(msg.content);
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === "text") systemChunks.push(part.text);
        }
      }
      continue;
    }

    const role = msg.role === "assistant" ? "model" : "user";
    const parts: Part[] = [];
    if (typeof msg.content === "string") {
      parts.push({ text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text") {
          parts.push({ text: part.text });
        } else if (part.type === "image_url") {
          const inline = dataUriToInlineData(part.image_url.url);
          if (inline) parts.push({ inlineData: inline });
        }
      }
    }
    contents.push({ role, parts });
  }

  return {
    systemInstruction: systemChunks.length
      ? systemChunks.join("\n\n")
      : undefined,
    contents,
  };
}

function buildConfig(
  params: CreateParamsBase,
  systemInstruction?: string,
  abortSignal?: AbortSignal,
): GenerateContentConfig {
  const config: GenerateContentConfig = {
    // Lower reasoning effort: Gemini 3.x models draw thoughts from the same
    // maxOutputTokens pool, so hidden thinking can consume the whole budget and
    // return EMPTY text with finishReason MAX_TOKENS. ThinkingLevel.LOW reduces
    // that risk without reserving output tokens. The gemini-2.5-flash era
    // removed this knob because 2.5 did not support thinkingLevel; it is
    // restored now that gemini-3.6-flash is active.
    thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
  };
  // Cancels the in-flight provider request when the caller aborts or the
  // route's timeout fires (abortable() below still guarantees a prompt
  // rejection if the SDK ignores the signal).
  if (abortSignal) config.abortSignal = abortSignal;
  if (systemInstruction) config.systemInstruction = systemInstruction;
  if (params.response_format?.type === "json_object") {
    config.responseMimeType = "application/json";
  }
  if (typeof params.max_completion_tokens === "number") {
    config.maxOutputTokens = params.max_completion_tokens;
  }
  return config;
}

type CreateRequestOptions = { signal?: AbortSignal; timeoutMs?: number };

function abortable<T>(promise: Promise<T>, options?: CreateRequestOptions): Promise<T> {
  if (!options?.signal && !options?.timeoutMs) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = options.timeoutMs ? setTimeout(() => reject(new Error("AI provider request timed out")), options.timeoutMs) : undefined;
    const abort = () => reject(new Error("AI provider request was cancelled"));
    if (options.signal?.aborted) { abort(); return; }
    options.signal?.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    });
  });
}

// One signal for the whole model chain: the caller's cancellation plus the
// adapter's timeout deadline, handed to the SDK so an abandoned import stops
// the provider request instead of leaving it running.
function requestSignal(options?: CreateRequestOptions): {
  signal: AbortSignal | undefined;
  dispose: () => void;
} {
  if (!options?.signal && !options?.timeoutMs) {
    return { signal: undefined, dispose: () => {} };
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  const timer = options.timeoutMs ? setTimeout(abort, options.timeoutMs) : undefined;
  return {
    signal: controller.signal,
    dispose: () => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    },
  };
}

// A blocked prompt (safety filter) is a definitive answer, not a transient
// failure: surface the empty result on the first model instead of re-asking
// the same prompt against every fallback.
function isBlockedResponse(response: {
  promptFeedback?: { blockReason?: string | null } | null;
  candidates?: Array<{ finishReason?: string | null } | null> | null;
}): boolean {
  if (response.promptFeedback?.blockReason) return true;
  return (response.candidates ?? []).some((candidate) => candidate?.finishReason === "SAFETY");
}

// Only provider-side transients earn a second model: quota 429, capacity
// 500/502/503/504, and a 404 for a model this key can no longer serve (the
// shape a retirement takes on the direct Gemini API). Cancellation, timeouts,
// and 400/401/403 credential-or-request errors are deterministic — another
// model cannot fix them, so they rethrow on the first attempt.
function isFallbackWorthyError(err: unknown): boolean {
  const candidate = err as { status?: unknown; name?: unknown; message?: unknown } | null;
  if (candidate?.name === "AbortError") return false;
  const message = typeof candidate?.message === "string" ? candidate.message : "";
  if (message.includes("AI provider request timed out")) return false;
  if (message.includes("AI provider request was cancelled")) return false;
  const status = Number(candidate?.status);
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return true;
  if (status === 404) return true;
  return (
    /\b(429|500|502|503|504)\b/.test(message) ||
    message.includes("UNAVAILABLE") ||
    message.includes("RESOURCE_EXHAUSTED") ||
    message.includes("high demand") ||
    message.includes("not found for API version")
  );
}

async function create(params: CreateParamsStream, options?: CreateRequestOptions): Promise<AsyncIterable<ChatChunk>>;
async function create(params: CreateParamsSync, options?: CreateRequestOptions): Promise<ChatResponse>;
async function create(
  params: CreateParamsBase & { stream?: boolean },
  options?: CreateRequestOptions,
): Promise<ChatResponse | AsyncIterable<ChatChunk>> {
  const { systemInstruction, contents } = toGemini(params.messages);
  // Ordered model chain: primary first, then the fallback models. Provider
  // transients (quota 429s, capacity 503s, retired-model 404s) and empty-content
  // responses (3.x flash can burn its whole output budget on hidden thoughts
  // and still return HTTP 200 with no text) move on to the next model instead
  // of 502'ing the route or surfacing a hollow "0 specs / 0 recipes" parse.
  // Bounded: primary + configured fallbacks (default 3 calls worst case).
  const models = modelChain(params.model);
  const { signal, dispose } = requestSignal(options);
  let lastError: unknown;
  // The stream branch hands the signal off to the generator it returns, which
  // disposes it only when iteration ends — disposing in the outer finally
  // would strip the caller's abort listener and clear the timeout before the
  // first chunk is ever pulled.
  let signalHandedOff = false;

  try {
    for (const model of models) {
      const config = buildConfig(params, systemInstruction, signal);
      try {
        const ai = client();
        if (params.stream) {
          const stream = await abortable(ai.models.generateContentStream({
            model,
            contents,
            config,
          }), options);
          signalHandedOff = true;
          return (async function* () {
            try {
              for await (const chunk of stream) {
                yield { choices: [{ delta: { content: chunk.text ?? null } }] };
              }
            } finally {
              dispose();
            }
          })();
        }

        const response = await abortable(ai.models.generateContent({
          model,
          contents,
          config,
        }), options);
        const content = response.text ?? null;
        if (isBlockedResponse(response)) {
          return { choices: [{ message: { content: null } }], model };
        }
        if (content === null || content.trim() === "") {
          lastError = new Error(`AI provider returned empty content from ${model}`);
          continue;
        }
        return { choices: [{ message: { content } }], model };
      } catch (err) {
        if (!isFallbackWorthyError(err)) throw err;
        lastError = err;
      }
    }
    throw lastError;
  } finally {
    if (!signalHandedOff) dispose();
  }
}

// OpenAI-compatible surface consumed across the server.
export const openai = {
  chat: { completions: { create } },
};
