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
import { GoogleGenAI } from "@google/genai";
import type {
  Content,
  GenerateContentConfig,
  GenerateContentResponse,
  Part,
} from "@google/genai";

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
}
interface ChatChunk {
  choices: Array<{ delta: { content: string | null } }>;
}

let _client: GoogleGenAI | null = null;

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 1;
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 30_000;
const MAX_RETRY_DELAY_MS = 10_000;
const MAX_TOKEN_METRIC = 10_000_000;

export type GeminiRequestOutcome =
  | "success"
  | "cancelled"
  | "timeout"
  | "circuit_open"
  | "provider_error";

export interface GeminiRequestMetrics {
  durationMs: number;
  outcome: GeminiRequestOutcome;
  retryCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costMicrousd: number;
}

type GeminiMetricsObserver = (metrics: GeminiRequestMetrics) => void;

let metricsObserver: GeminiMetricsObserver = () => {};
let consecutiveTransientFailures = 0;
let circuitOpenedAt = 0;
let halfOpenProbeActive = false;

export function setGeminiMetricsObserver(observer?: GeminiMetricsObserver): void {
  metricsObserver = observer ?? (() => {});
}

export class GeminiProviderUnavailableError extends Error {
  constructor(message = "AI extraction is temporarily unavailable", options?: ErrorOptions) {
    super(message, options);
    this.name = "GeminiProviderUnavailableError";
  }
}

class GeminiRequestTimeoutError extends GeminiProviderUnavailableError {
  constructor() {
    super("AI provider request timed out");
    this.name = "GeminiRequestTimeoutError";
  }
}

class GeminiRequestCancelledError extends Error {
  constructor() {
    super("AI provider request was cancelled");
    this.name = "GeminiRequestCancelledError";
  }
}

export interface GeminiProviderEnvironment {
  AI_INTEGRATIONS_GEMINI_API_KEY?: string;
  GOOGLE_API_KEY?: string;
}

/**
 * Reports whether the Gemini adapter has a credential it can use.
 *
 * Keep readiness and other configuration checks on this helper so they cannot
 * drift from the credential selection performed by client().
 */
export function isGeminiProviderConfigured(
  env: GeminiProviderEnvironment = process.env,
): boolean {
  return Boolean(
    env.AI_INTEGRATIONS_GEMINI_API_KEY || env.GOOGLE_API_KEY,
  );
}

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
  if (!isGeminiProviderConfigured(process.env)) {
    throw new Error(
      "No Gemini API key found. Set GOOGLE_API_KEY for the direct Gemini API " +
        "(get one at https://aistudio.google.com/apikey), or set " +
        "AI_INTEGRATIONS_GEMINI_API_KEY for the Replit proxy.",
    );
  }
  const apiKey = replitKey || directKey!;
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
): GenerateContentConfig {
  const config: GenerateContentConfig = {
    // No thinkingConfig — gemini-2.5-flash does not support thinkingLevel.
    // (Gemini 3.x models used thinkingLevel: "low" to avoid thinking tokens
    // consuming the maxOutputTokens budget, but that knob is absent in 2.5.)
  };
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

function boundedInteger(value: unknown, maximum: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(0, Math.round(value)))
    : 0;
}

function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const status = (error as { status?: unknown }).status;
  if (typeof status === "number") return status;
  const responseStatus = (error as { response?: { status?: unknown } }).response?.status;
  return typeof responseStatus === "number" ? responseStatus : undefined;
}

function isTransientProviderError(error: unknown): boolean {
  if (error instanceof GeminiRequestTimeoutError) return true;
  const status = statusOf(error);
  if (status === 408 || status === 429 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && [
    "ECONNRESET",
    "ECONNREFUSED",
    "EPIPE",
    "ETIMEDOUT",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
  ].includes(code);
}

function retryAfterMs(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const headers = (error as {
    response?: { headers?: { get?: (name: string) => string | null } | Record<string, unknown> };
  }).response?.headers;
  const raw = typeof headers?.get === "function"
    ? headers.get("retry-after")
    : headers && typeof headers === "object"
      ? (headers as Record<string, unknown>)["retry-after"]
      : undefined;
  if (typeof raw !== "string") return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_RETRY_DELAY_MS, Math.round(seconds * 1_000));
  }
  const dateMs = Date.parse(raw);
  if (!Number.isFinite(dateMs)) return undefined;
  return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, dateMs - Date.now()));
}

function acquireCircuit(now = Date.now()): "closed" | "half_open" {
  if (consecutiveTransientFailures < CIRCUIT_FAILURE_THRESHOLD) return "closed";
  if (now - circuitOpenedAt < CIRCUIT_COOLDOWN_MS || halfOpenProbeActive) {
    throw new GeminiProviderUnavailableError();
  }
  halfOpenProbeActive = true;
  return "half_open";
}

function releaseCircuit(
  mode: "closed" | "half_open",
  result: "success" | "transient_failure" | "other_failure",
): void {
  if (mode === "half_open") halfOpenProbeActive = false;
  if (result === "success" || result === "other_failure") {
    consecutiveTransientFailures = 0;
    circuitOpenedAt = 0;
    return;
  }
  consecutiveTransientFailures += 1;
  if (
    mode === "half_open" ||
    consecutiveTransientFailures >= CIRCUIT_FAILURE_THRESHOLD
  ) {
    consecutiveTransientFailures = CIRCUIT_FAILURE_THRESHOLD;
    circuitOpenedAt = Date.now();
  }
}

function requestSignal(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; dispose: () => void; timedOut: () => boolean } {
  const controller = new AbortController();
  let didTimeOut = false;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => {
    didTimeOut = true;
    controller.abort(new GeminiRequestTimeoutError());
  }, timeoutMs);
  timer.unref?.();
  return {
    signal: controller.signal,
    timedOut: () => didTimeOut,
    dispose: () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    },
  };
}

async function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new GeminiRequestCancelledError());
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
    timer.unref?.();
  });
}

function usageMetrics(response?: GenerateContentResponse): Pick<
  GeminiRequestMetrics,
  "promptTokens" | "completionTokens" | "totalTokens" | "costMicrousd"
> {
  return {
    promptTokens: boundedInteger(response?.usageMetadata?.promptTokenCount, MAX_TOKEN_METRIC),
    completionTokens: boundedInteger(response?.usageMetadata?.candidatesTokenCount, MAX_TOKEN_METRIC),
    totalTokens: boundedInteger(response?.usageMetadata?.totalTokenCount, MAX_TOKEN_METRIC),
    // The Gemini response has no authoritative price. Keep the numeric cost
    // total bounded at zero rather than estimating from request content.
    costMicrousd: 0,
  };
}

function observeMetrics(metrics: GeminiRequestMetrics): void {
  try {
    metricsObserver(Object.freeze({ ...metrics }));
  } catch {
    // Telemetry must never change provider behavior.
  }
}

async function create(params: CreateParamsStream, options?: CreateRequestOptions): Promise<AsyncIterable<ChatChunk>>;
async function create(params: CreateParamsSync, options?: CreateRequestOptions): Promise<ChatResponse>;
async function create(
  params: CreateParamsBase & { stream?: boolean },
  options?: CreateRequestOptions,
): Promise<ChatResponse | AsyncIterable<ChatChunk>> {
  const startedAt = performance.now();
  let retryCount = 0;
  let responseForMetrics: GenerateContentResponse | undefined;
  let outcome: GeminiRequestOutcome = "provider_error";
  let circuitMode: "closed" | "half_open";
  try {
    circuitMode = acquireCircuit();
  } catch (error) {
    observeMetrics({
      durationMs: boundedInteger(performance.now() - startedAt, MAX_TIMEOUT_MS),
      outcome: "circuit_open",
      retryCount: 0,
      ...usageMetrics(),
    });
    throw error;
  }

  const { systemInstruction, contents } = toGemini(params.messages);
  const config = buildConfig(params, systemInstruction);

  try {
    const ai = client();
    for (let attempt = 0; ; attempt += 1) {
      const timeoutMs = Math.min(
        MAX_TIMEOUT_MS,
        Math.max(1, options?.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      );
      const request = requestSignal(options?.signal, timeoutMs);
      try {
        const requestConfig = {
          model: params.model,
          contents,
          config: {
            ...config,
            httpOptions: { ...config.httpOptions, timeout: timeoutMs },
            abortSignal: request.signal,
          },
        };
        if (params.stream) {
          const stream = await ai.models.generateContentStream(requestConfig);
          outcome = "success";
          releaseCircuit(circuitMode, "success");
          return (async function* () {
            for await (const chunk of stream) {
              yield { choices: [{ delta: { content: chunk.text ?? null } }] };
            }
          })();
        }

        const response = await ai.models.generateContent(requestConfig);
        responseForMetrics = response;
        outcome = "success";
        releaseCircuit(circuitMode, "success");
        return { choices: [{ message: { content: response.text ?? null } }] };
      } catch (error) {
        const normalized = request.timedOut()
          ? new GeminiRequestTimeoutError()
          : options?.signal?.aborted
            ? new GeminiRequestCancelledError()
            : error;
        const transient = isTransientProviderError(normalized);
        if (transient && attempt < MAX_RETRIES && circuitMode !== "half_open") {
          retryCount += 1;
          request.dispose();
          await waitForRetry(retryAfterMs(error) ?? 250, options?.signal);
          continue;
        }
        outcome = normalized instanceof GeminiRequestCancelledError
          ? "cancelled"
          : normalized instanceof GeminiRequestTimeoutError
            ? "timeout"
            : "provider_error";
        releaseCircuit(
          circuitMode,
          transient ? "transient_failure" : "other_failure",
        );
        if (normalized instanceof GeminiRequestCancelledError) throw normalized;
        throw new GeminiProviderUnavailableError(undefined, { cause: normalized });
      } finally {
        request.dispose();
      }
    }
  } finally {
    observeMetrics({
      durationMs: boundedInteger(performance.now() - startedAt, MAX_TIMEOUT_MS * 2),
      outcome,
      retryCount,
      ...usageMetrics(responseForMetrics),
    });
  }
}

export function resetGeminiResilienceForTests(): void {
  _client = null;
  metricsObserver = () => {};
  consecutiveTransientFailures = 0;
  circuitOpenedAt = 0;
  halfOpenProbeActive = false;
}

// OpenAI-compatible surface consumed across the server.
export const openai = {
  chat: { completions: { create } },
};
