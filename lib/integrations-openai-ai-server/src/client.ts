// Local-first OpenAI-compatible AI adapter.
//
// Preserves the exact surface the rest of the server is written against:
//
//   openai.chat.completions.create({ model, messages, response_format,
//                                    max_completion_tokens, stream? })
//   → { choices: [{ message: { content } }] }                (non-stream)
//   → async iterable of { choices: [{ delta: { content } }] } (stream)
//
// Provider selection (all lazy — importing this module never throws):
//   1. LOCAL_AI_BASE_URL set → self-hosted OpenAI-compatible server
//      (Ollama / llama.cpp). apiKey is a placeholder; most local servers
//      ignore it, but LOCAL_AI_API_KEY can satisfy a keyed reverse proxy.
//   2. Otherwise → Gemini (Replit AI Integrations proxy or direct
//      GOOGLE_API_KEY), fully preserved — including the resilience layer
//      (per-call timeout, cancellation, bounded retry, circuit breaker and
//      bounded telemetry) that the server relies on.
//
// Per-call fallback: when LOCAL_AI is configured AND
// LOCAL_AI_FALLBACK_TO_GEMINI=true, a *transport-level* local failure
// (connection refused, DNS, timeout, 5xx) retries once against Gemini.
// Validation errors (4xx, malformed output) and caller cancellation never
// fall back — retrying a deterministic failure against a different model
// just doubles the noise.
//
// Test contract (DO NOT BREAK): every vi.mock factory for this module must
// keep working. Exports are { openai, isGeminiProviderConfigured,
// GeminiProviderUnavailableError, resetGeminiResilienceForTests,
// setGeminiMetricsObserver, type GeminiRequestMetrics, type
// GeminiRequestOutcome, type GeminiProviderEnvironment } plus the chat types
// declared below.
import OpenAI from "openai";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import type {
  Content,
  GenerateContentConfig,
  GenerateContentResponse,
  Part,
} from "@google/genai";
import type { Stream } from "openai/streaming";
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
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
  /** Present only when a fallback model served the request. */
  model?: string;
}
interface ChatChunk {
  choices: Array<{ delta: { content: string | null } }>;
}

export type CreateRequestOptions = { signal?: AbortSignal; timeoutMs?: number };

interface ChainAttempt extends ChatResponse {
  blocked: boolean;
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

export type GeminiFallbackTrigger =
  | "rate_limited"
  | "service_unavailable"
  | "retired_model"
  | "empty_response";

export type GeminiRequestResult =
  | "primary_success"
  | "fallback_success"
  | "fallback_triggered"
  | "fallback_exhausted"
  | "attempt_failed";

export interface GeminiRequestMetrics {
  durationMs: number;
  outcome: GeminiRequestOutcome;
  /** Zero is the selected model; positive values are bounded fallback rungs. */
  modelRung: number;
  requestResult: GeminiRequestResult;
  /** Why this fallback rung was selected; null for the primary model. */
  fallbackTrigger: GeminiFallbackTrigger | null;
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

/**
 * Makes a bounded, synthetic request to confirm that one configured model is
 * currently accepted by the provider. The response is intentionally discarded.
 */
export async function probeGeminiModel(model: string): Promise<void> {
  if (!model.trim()) throw new Error("A Gemini model ID is required");
  await client().models.generateContent({
    model,
    contents: "Reply with OK.",
    config: {
      maxOutputTokens: 1,
      temperature: 0,
      abortSignal: AbortSignal.timeout(15_000),
    },
  });
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
    // Lower reasoning effort: Gemini 3.x models draw thoughts from the same
    // maxOutputTokens pool, so hidden thinking can consume the whole budget and
    // return EMPTY text with finishReason MAX_TOKENS. ThinkingLevel.LOW reduces
    // that risk without reserving output tokens. The gemini-2.5-flash era
    // removed this knob because 2.5 did not support thinkingLevel; it is
    // restored now that gemini-3.6-flash is active.
    thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
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

function fallbackTriggerFor(error: unknown): GeminiFallbackTrigger | null {
  const cause = error instanceof Error && error.cause !== undefined
    ? error.cause
    : error;
  const status = statusOf(cause);
  if (status === 429) return "rate_limited";
  if (status === 503 || status === 504) return "service_unavailable";
  if (isRetiredModelError(cause)) return "retired_model";
  return null;
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

function isRetiredModelError(error: unknown): boolean {
  if (statusOf(error) !== 404 || !error || typeof error !== "object") return false;
  const providerError = error as {
    message?: unknown;
    response?: { data?: { message?: unknown; error?: { message?: unknown } } | string };
  };
  const data = providerError.response?.data;
  const messages = [
    providerError.message,
    typeof data === "string" ? data : data?.message,
    typeof data === "object" ? data.error?.message : undefined,
  ];
  const message = messages
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  return message.includes("model") && [
    "not found",
    "not available",
    "no longer",
    "retired",
    "decommissioned",
    "not supported",
    "does not exist",
  ].some((marker) => message.includes(marker));
}

function isChainAdvanceError(error: unknown): boolean {
  if (error instanceof GeminiRequestCancelledError || error instanceof GeminiRequestTimeoutError) {
    return false;
  }
  // Provider errors are wrapped by this adapter. Inspect their cause so that
  // timeouts remain ineligible even though they are same-model retryable.
  const cause = error instanceof Error && error.cause !== undefined ? error.cause : error;
  if (cause instanceof GeminiRequestCancelledError || cause instanceof GeminiRequestTimeoutError) {
    return false;
  }
  const status = statusOf(cause);
  // A remote gateway deadline is an availability failure, not our local
  // request timeout. Healthy backups can recover a stalled upstream model.
  // Keep client cancellation/timeouts and other gateway errors ineligible.
  return status === 429 || status === 503 || status === 504 || isRetiredModelError(cause);
}

function isSafetyBlockedResponse(response: GenerateContentResponse): boolean {
  return Boolean(response.promptFeedback?.blockReason) ||
    (response.candidates ?? []).some((candidate) => candidate?.finishReason === "SAFETY");
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

function releaseIntermediateCircuit(mode: "closed" | "half_open"): void {
  // Model rungs belong to one logical request. Do not count each failed model
  // as a separate circuit failure or the breaker can block the remaining
  // fallbacks in the same request.
  if (mode === "half_open") halfOpenProbeActive = false;
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

async function createForModel(
  params: CreateParamsBase & { stream?: boolean },
  options: CreateRequestOptions | undefined,
  chainIndex: number,
  finalModel: boolean,
  fallbackTrigger: GeminiFallbackTrigger | null = null,
): Promise<ChainAttempt | AsyncIterable<ChatChunk>> {
  const startedAt = performance.now();
  let retryCount = 0;
  let responseForMetrics: GenerateContentResponse | undefined;
  let outcome: GeminiRequestOutcome = "provider_error";
  let requestResult: GeminiRequestResult = "attempt_failed";
  let deferStreamCleanup = false;
  let circuitMode: "closed" | "half_open";
  try {
    circuitMode = acquireCircuit();
  } catch (error) {
    observeMetrics({
      durationMs: boundedInteger(performance.now() - startedAt, MAX_TIMEOUT_MS),
      outcome: "circuit_open",
      modelRung: boundedInteger(chainIndex, 2),
      requestResult: chainIndex > 0 && finalModel ? "fallback_exhausted" : "attempt_failed",
      fallbackTrigger,
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
          // Stream creation only confirms that response headers arrived. Keep
          // the timeout/cancellation signal and defer success metrics until the
          // iterator has been consumed without an error.
          deferStreamCleanup = true;
          let streamSettled = false;
          let onStreamAbort = () => {};
          const finishStream = (
            streamOutcome: GeminiRequestOutcome,
            circuitResult: "success" | "transient_failure" | "other_failure",
          ) => {
            if (streamSettled) return;
            streamSettled = true;
            request.signal.removeEventListener("abort", onStreamAbort);
            request.dispose();
            outcome = streamOutcome;
            releaseCircuit(circuitMode, circuitResult);
            observeMetrics({
              durationMs: boundedInteger(
                performance.now() - startedAt,
                MAX_TIMEOUT_MS * 2,
              ),
              outcome,
              modelRung: boundedInteger(chainIndex, 2),
              requestResult,
              fallbackTrigger,
              retryCount,
              ...usageMetrics(responseForMetrics),
            });
          };
          onStreamAbort = () => {
            const timedOut = request.timedOut();
            finishStream(
              timedOut ? "timeout" : "cancelled",
              timedOut ? "transient_failure" : "other_failure",
            );
          };
          request.signal.addEventListener("abort", onStreamAbort, { once: true });
          if (request.signal.aborted) onStreamAbort();
          return (async function* () {
            let emittedChunk = false;
            try {
              for await (const chunk of stream) {
                emittedChunk = true;
                yield { choices: [{ delta: { content: chunk.text ?? null } }] };
              }
              if (request.timedOut()) throw new GeminiRequestTimeoutError();
              if (options?.signal?.aborted) {
                throw new GeminiRequestCancelledError();
              }
              requestResult = chainIndex === 0 ? "primary_success" : "fallback_success";
              finishStream("success", "success");
            } catch (error) {
              const normalized = request.timedOut()
                ? new GeminiRequestTimeoutError()
                : options?.signal?.aborted
                  ? new GeminiRequestCancelledError()
                  : error;
              const transient = isTransientProviderError(normalized);
              outcome = normalized instanceof GeminiRequestCancelledError
                ? "cancelled"
                : normalized instanceof GeminiRequestTimeoutError
                  ? "timeout"
                  : "provider_error";
              requestResult = finalModel && chainIndex > 0 && !emittedChunk &&
                  !(normalized instanceof GeminiRequestCancelledError)
                ? "fallback_exhausted"
                : !finalModel && !emittedChunk && isChainAdvanceError(normalized)
                  ? "fallback_triggered"
                  : "attempt_failed";
              finishStream(
                outcome,
                transient ? "transient_failure" : "other_failure",
              );
              if (normalized instanceof GeminiRequestCancelledError) {
                throw normalized;
              }
              throw new GeminiProviderUnavailableError(undefined, {
                cause: normalized,
              });
            } finally {
              if (!streamSettled) {
                // A consumer can stop reading an otherwise healthy stream.
                // Treat that as incomplete, not as provider success.
                finishStream("cancelled", "other_failure");
              }
            }
          })();
        }

        const response = await ai.models.generateContent(requestConfig);
        responseForMetrics = response;
        outcome = "success";
        releaseCircuit(circuitMode, "success");
        const blocked = isSafetyBlockedResponse(response);
        const content = blocked ? null : response.text ?? null;
        const hasUsableContent = blocked ||
          (typeof content === "string" && content.trim().length > 0);
        requestResult = hasUsableContent
          ? chainIndex === 0 ? "primary_success" : "fallback_success"
          : finalModel ? "fallback_exhausted" : "fallback_triggered";
        return {
          choices: [{ message: { content } }],
          blocked,
          ...(chainIndex > 0 ? { model: params.model } : {}),
        };
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
        requestResult = finalModel && chainIndex > 0 &&
            !(normalized instanceof GeminiRequestCancelledError)
          ? "fallback_exhausted"
          : !finalModel && isChainAdvanceError(normalized)
            ? "fallback_triggered"
            : "attempt_failed";
        if (isChainAdvanceError(normalized) && !finalModel) {
          releaseIntermediateCircuit(circuitMode);
        } else {
          releaseCircuit(
            circuitMode,
            transient ? "transient_failure" : "other_failure",
          );
        }
        if (normalized instanceof GeminiRequestCancelledError) throw normalized;
        throw new GeminiProviderUnavailableError(undefined, { cause: normalized });
      } finally {
        if (!deferStreamCleanup) request.dispose();
      }
    }
  } finally {
    if (!deferStreamCleanup) {
      observeMetrics({
        durationMs: boundedInteger(performance.now() - startedAt, MAX_TIMEOUT_MS * 2),
        outcome,
        modelRung: boundedInteger(chainIndex, 2),
        requestResult,
        fallbackTrigger,
        retryCount,
        ...usageMetrics(responseForMetrics),
      });
    }
  }
}

function streamWithModelFallback(
  initial: AsyncIterable<ChatChunk>,
  params: CreateParamsBase & { stream?: boolean },
  options: CreateRequestOptions | undefined,
  models: readonly string[],
  startIndex: number,
): AsyncIterable<ChatChunk> {
  return (async function* () {
    let stream = initial;
    let lastError: unknown;
    let fallbackTrigger: GeminiFallbackTrigger | null = null;

    for (let index = startIndex; index < models.length; index += 1) {
      const finalModel = index === models.length - 1;
      if (index > startIndex) {
        try {
          const attempt = await createForModel(
            { ...params, model: models[index]!, stream: true },
            options,
            index,
            finalModel,
            fallbackTrigger,
          );
          stream = attempt as AsyncIterable<ChatChunk>;
        } catch (error) {
          lastError = error;
          if (finalModel || !isChainAdvanceError(error)) throw error;
          fallbackTrigger = fallbackTriggerFor(error);
          continue;
        }
      }

      let emittedChunk = false;
      try {
        for await (const chunk of stream) {
          emittedChunk = true;
          yield chunk;
        }
        return;
      } catch (error) {
        lastError = error;
        if (emittedChunk || finalModel || !isChainAdvanceError(error)) throw error;
        fallbackTrigger = fallbackTriggerFor(error);
      }
    }

    throw lastError ?? new GeminiProviderUnavailableError();
  })();
}

let _local: OpenAI | null = null;

function localClient(): OpenAI {
  if (_local) return _local;
  const baseURL = process.env.LOCAL_AI_BASE_URL;
  if (!baseURL) throw new Error("LOCAL_AI_BASE_URL is not set");
  _local = new OpenAI({
    baseURL,
    apiKey: process.env.LOCAL_AI_API_KEY ?? "local",
    // Local servers hang onto connections; keep this generous and let the
    // caller's timeoutMs govern the real budget.
    timeout: 10 * 60 * 1000,
  });
  return _local;
}

function isTransportError(err: unknown): boolean {
  // A caller cancellation must never trigger a cross-provider retry.
  if (err instanceof GeminiRequestCancelledError) return false;
  // Connection-level failures (refused / DNS / socket hang-up) carry no HTTP
  // status at all — they are transport by definition.
  if (err instanceof OpenAI.APIConnectionError) return true;
  // 4xx (validation / auth / schema) are deterministic — never fall back.
  if (err instanceof OpenAI.APIError) return err.status >= 500;
  // Other fetch-level failures surface as plain TypeError in the SDK, not
  // APIError. Treat timeouts as transport too.
  return err instanceof GeminiRequestTimeoutError
    || err instanceof TypeError;
}

// Native OpenAI message shape: system stays system, image_url data URIs pass
// straight through — no Gemini-era translation on the local path.
function toOpenAIMessages(messages: ChatMessage[]): ChatCompletionMessageParam[] {
  return messages.map((msg) => {
    const content =
      typeof msg.content === "string" || msg.content === null
        ? msg.content ?? ""
        : msg.content.map((part) =>
            part.type === "text"
              ? { type: "text" as const, text: part.text }
              : { type: "image_url" as const, image_url: { url: part.image_url.url } },
          );
    // The adapter's simplified ChatMessage maps 1:1 onto the OpenAI wire
    // shape. system/assistant turns only ever carry text in practice, so the
    // image_url branch is meaningful for user turns; the cast collapses the
    // per-role content unions that TypeScript cannot narrow from a shared
    // { role, content } object literal.
    return { role: msg.role, content } as ChatCompletionMessageParam;
  });
}

async function createLocal(
  params: CreateParamsBase,
  options?: CreateRequestOptions,
): Promise<ChatResponse> {
  const res: ChatCompletion = await localClient().chat.completions.create(
    {
      model: params.model,
      messages: toOpenAIMessages(params.messages),
      ...(params.response_format
        ? { response_format: { type: params.response_format.type } }
        : {}),
      ...(typeof params.max_completion_tokens === "number"
        ? { max_tokens: params.max_completion_tokens }
        : {}),
      stream: false,
    },
    { signal: options?.signal },
  );
  return { choices: [{ message: { content: res.choices[0]?.message.content ?? null } }] };
}

async function createLocalStream(
  params: CreateParamsBase,
  options?: CreateRequestOptions,
): Promise<AsyncIterable<ChatChunk>> {
  const stream: Stream<ChatCompletionChunk> =
    await localClient().chat.completions.create(
      {
        model: params.model,
        messages: toOpenAIMessages(params.messages),
        ...(params.response_format
          ? { response_format: { type: params.response_format.type } }
          : {}),
        ...(typeof params.max_completion_tokens === "number"
          ? { max_tokens: params.max_completion_tokens }
          : {}),
        stream: true,
      },
      { signal: options?.signal },
    );
  return (async function* () {
    for await (const chunk of stream) {
      yield { choices: [{ delta: { content: chunk.choices[0]?.delta?.content ?? null } }] };
    }
  })();
}

const useLocal = () => Boolean(process.env.LOCAL_AI_BASE_URL);
const fallbackToGemini = () => process.env.LOCAL_AI_FALLBACK_TO_GEMINI === "true";

// Abort/timeout wrapper for the local path. Reuses the typed cancellation and
// timeout errors so callers (and telemetry) see one consistent failure model.
function abortable<T>(promise: Promise<T>, options?: CreateRequestOptions): Promise<T> {
  if (!options?.signal && !options?.timeoutMs) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = options?.timeoutMs
      ? setTimeout(() => reject(new GeminiRequestTimeoutError()), options.timeoutMs)
      : undefined;
    const abort = () => reject(new GeminiRequestCancelledError());
    if (options?.signal?.aborted) {
      if (timer) clearTimeout(timer);
      abort();
      return;
    }
    options?.signal?.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => {
      if (timer) clearTimeout(timer);
      options?.signal?.removeEventListener("abort", abort);
    });
  });
}

async function createLocalWithMetrics(
  params: CreateParamsBase & { stream?: boolean },
  options?: CreateRequestOptions,
): Promise<ChatResponse | AsyncIterable<ChatChunk>> {
  const startedAt = performance.now();
  let outcome: GeminiRequestOutcome = "provider_error";
  try {
    const result = params.stream
      ? await abortable(createLocalStream(params, options), options)
      : await abortable(createLocal(params, options), options);
    outcome = "success";
    return result;
  } catch (error) {
    outcome = error instanceof GeminiRequestCancelledError
      ? "cancelled"
      : error instanceof GeminiRequestTimeoutError
        ? "timeout"
        : "provider_error";
    throw error;
  } finally {
    observeMetrics({
      durationMs: boundedInteger(performance.now() - startedAt, MAX_TIMEOUT_MS * 2),
      outcome,
      // The local path has no model chain: it always serves rung 0 directly.
      modelRung: 0,
      requestResult: outcome === "success" ? "primary_success" : "attempt_failed",
      fallbackTrigger: null,
      retryCount: 0,
      ...usageMetrics(),
    });
  }
}

async function createGeminiChain(params: CreateParamsStream, options?: CreateRequestOptions): Promise<AsyncIterable<ChatChunk>>;
async function createGeminiChain(params: CreateParamsSync, options?: CreateRequestOptions): Promise<ChatResponse>;
async function createGeminiChain(
  params: CreateParamsBase & { stream?: boolean },
  options?: CreateRequestOptions,
): Promise<ChatResponse | AsyncIterable<ChatChunk>> {
  const models = modelChain(params.model);
  let lastError: unknown;
  let fallbackTrigger: GeminiFallbackTrigger | null = null;

  for (const [index, model] of models.entries()) {
    const finalModel = index === models.length - 1;
    let attempt: ChainAttempt | AsyncIterable<ChatChunk>;
    try {
      attempt = await createForModel(
        { ...params, model },
        options,
        index,
        finalModel,
        fallbackTrigger,
      );
    } catch (error) {
      if (finalModel || !isChainAdvanceError(error)) throw error;
      lastError = error;
      fallbackTrigger = fallbackTriggerFor(error);
      continue;
    }

    // A stream may switch models until its first chunk is yielded. Once output
    // reaches the caller, the remainder must stay on that model.
    if (params.stream) {
      return streamWithModelFallback(
        attempt as AsyncIterable<ChatChunk>,
        params,
        options,
        models,
        index,
      );
    }

    const { blocked, ...response } = attempt as ChainAttempt;
    if (blocked) return response;
    const content = response.choices[0]?.message.content;
    if (typeof content === "string" && content.trim().length > 0) return response;

    // A successful HTTP response with no text is still unusable for an import.
    fallbackTrigger = "empty_response";
    lastError = new GeminiProviderUnavailableError(
      `AI provider returned empty content from ${model}`,
    );
    if (finalModel) throw lastError;
  }

  throw lastError ?? new GeminiProviderUnavailableError();
}

// Provider dispatch: local-first, Gemini chain as fallback-within-provider.
async function create(params: CreateParamsStream, options?: CreateRequestOptions): Promise<AsyncIterable<ChatChunk>>;
async function create(params: CreateParamsSync, options?: CreateRequestOptions): Promise<ChatResponse>;
async function create(
  params: CreateParamsBase & { stream?: boolean },
  options?: CreateRequestOptions,
): Promise<ChatResponse | AsyncIterable<ChatChunk>> {
  if (useLocal()) {
    try {
      return await createLocalWithMetrics(params, options);
    } catch (err) {
      // Only a transport-level failure, and only when explicitly opted in,
      // falls through to the Gemini chain. Everything else is rethrown as-is.
      if (!fallbackToGemini() || !isTransportError(err)) throw err;
    }
  }
  if (params.stream) {
    return createGeminiChain({ ...params, stream: true }, options);
  }
  return createGeminiChain({ ...params, stream: false }, options);
}

export function resetGeminiResilienceForTests(): void {
  _client = null;
  _local = null;
  metricsObserver = () => {};
  consecutiveTransientFailures = 0;
  circuitOpenedAt = 0;
  halfOpenProbeActive = false;
}

// OpenAI-compatible surface consumed across the server.
export const openai = {
  chat: { completions: { create } },
};
