// Local-first OpenAI-compatible adapter, preserving the exact surface the
// rest of the server is written against:
//
//   openai.chat.completions.create({ model, messages, response_format,
//                                    max_completion_tokens, stream? })
//   → { choices: [{ message: { content } }] }  (non-stream)
//   → async iterable of { choices: [{ delta: { content } }] }  (stream)
//
// Provider selection (all lazy — importing this module never throws):
//   1. LOCAL_AI_BASE_URL set  → self-hosted server (Ollama / llama.cpp).
//      apiKey is a placeholder; most local servers ignore it, but keep the
//      option to require one at the reverse proxy via LOCAL_AI_API_KEY.
//   2. Otherwise, Gemini (Replit proxy AI_INTEGRATIONS_GEMINI_* or direct
//      GOOGLE_API_KEY) — kept as the optional fallback path per the
//      AI-feature-value-audit retention decision.
//
// Per-call fallback: when LOCAL_AI is configured AND
// LOCAL_AI_FALLBACK_TO_GEMINI=true, a *transport-level* local failure
// (connection refused, DNS, timeout, 5xx) retries once against Gemini.
// Validation errors (4xx, malformed output) never fall back — retrying a
// deterministic failure against a different model just doubles the noise.
//
// Test contract (DO NOT BREAK): every vi.mock factory for this module must
// keep working — exports are exactly { openai, AI_MODELS, pickModel } plus
// the types re-exported below.
import OpenAI from "openai";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import type { Content, Part, GenerateContentConfig } from "@google/genai";
import type { Stream } from "openai/streaming";
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";

type TextPart = { type: "text"; text: string };
type ImagePart = { type: "image_url"; image_url: { url: string } };
export type ChatContent = string | Array<TextPart | ImagePart> | null;

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

export interface ChatResponse {
  choices: Array<{ message: { content: string | null } }>;
}
export interface ChatChunk {
  choices: Array<{ delta: { content: string | null } }>;
}

export type CreateRequestOptions = { signal?: AbortSignal; timeoutMs?: number };

// ---------------------------------------------------------------------------
// Local (OpenAI-compatible) backend
// ---------------------------------------------------------------------------

let _local: OpenAI | null = null;
function localClient(): OpenAI {
  if (_local) return _local;
  const baseURL = process.env.LOCAL_AI_BASE_URL;
  if (!baseURL) throw new Error("LOCAL_AI_BASE_URL is not set");
  _local = new OpenAI({
    baseURL,
    apiKey: process.env.LOCAL_AI_API_KEY ?? "local",
    // Local servers hang onto connections; keep this tight and let the
    // caller's timeoutMs govern the real budget.
    timeout: 10 * 60 * 1000,
  });
  return _local;
}

function isTransportError(err: unknown): boolean {
  if (err instanceof OpenAI.APIError) return err.status >= 500;
  // Connection refused / DNS / socket hang-up surface as plain TypeError or
  // fetch errors in the SDK, not APIError.
  return err instanceof TypeError || err instanceof Error;
}

// Native OpenAI message shape: system stays system, image_url data URIs pass
// straight through — the Gemini-era translators are gone.
function toOpenAIMessages(messages: ChatMessage[]): ChatCompletionMessageParam[] {
  return messages.map((msg) => {
    if (typeof msg.content === "string" || msg.content === null) {
      return { role: msg.role, content: msg.content ?? "" };
    }
    return {
      role: msg.role,
      content: msg.content.map((part) =>
        part.type === "text"
          ? { type: "text" as const, text: part.text }
          : { type: "image_url" as const, image_url: { url: part.image_url.url } },
      ),
    };
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

// ---------------------------------------------------------------------------
// Gemini fallback backend (retained from the previous adapter, trimmed)
// ---------------------------------------------------------------------------

let _gemini: GoogleGenAI | null = null;
function geminiClient(): GoogleGenAI {
  if (_gemini) return _gemini;
  const replitKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const replitBase = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  const directKey = process.env.GOOGLE_API_KEY;
  const apiKey = replitKey || directKey;
  if (!apiKey) {
    throw new Error(
      "No Gemini API key found. Set GOOGLE_API_KEY, or AI_INTEGRATIONS_GEMINI_API_KEY.",
    );
  }
  _gemini = new GoogleGenAI({
    apiKey,
    ...(replitKey && replitBase
      ? { httpOptions: { apiVersion: "", baseUrl: replitBase } }
      : {}),
  });
  return _gemini;
}

function dataUriToInlineData(url: string): { mimeType: string; data: string } | null {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(url);
  return match ? { mimeType: match[1], data: match[2] } : null;
}

function toGemini(messages: ChatMessage[]): {
  systemInstruction?: string;
  contents: Content[];
} {
  const systemChunks: string[] = [];
  const contents: Content[] = [];
  for (const msg of messages) {
    if (msg.role === "system") {
      if (typeof msg.content === "string") systemChunks.push(msg.content);
      else if (Array.isArray(msg.content))
        for (const p of msg.content) if (p.type === "text") systemChunks.push(p.text);
      continue;
    }
    const role = msg.role === "assistant" ? "model" : "user";
    const parts: Part[] = [];
    if (typeof msg.content === "string") parts.push({ text: msg.content });
    else if (Array.isArray(msg.content))
      for (const p of msg.content) {
        if (p.type === "text") parts.push({ text: p.text });
        else {
          const inline = dataUriToInlineData(p.image_url.url);
          if (inline) parts.push({ inlineData: inline });
        }
      }
    contents.push({ role, parts });
  }
  return {
    systemInstruction: systemChunks.length ? systemChunks.join("\n\n") : undefined,
    contents,
  };
}

function geminiConfig(params: CreateParamsBase, systemInstruction?: string): GenerateContentConfig {
  const config: GenerateContentConfig = {
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

async function createGemini(
  params: CreateParamsBase,
  options?: CreateRequestOptions,
): Promise<ChatResponse> {
  const { systemInstruction, contents } = toGemini(params.messages);
  const res = await geminiClient().models.generateContent({
    model: params.model,
    contents,
    config: geminiConfig(params, systemInstruction),
  });
  return { choices: [{ message: { content: res.text ?? null } }] };
}

async function createGeminiStream(
  params: CreateParamsBase,
  options?: CreateRequestOptions,
): Promise<AsyncIterable<ChatChunk>> {
  const { systemInstruction, contents } = toGemini(params.messages);
  const stream = await geminiClient().models.generateContentStream({
    model: params.model,
    contents,
    config: geminiConfig(params, systemInstruction),
  });
  return (async function* () {
    for await (const chunk of stream) {
      yield { choices: [{ delta: { content: chunk.text ?? null } }] };
    }
  })();
}

// ---------------------------------------------------------------------------
// Provider dispatch + abort/timeout wrapper
// ---------------------------------------------------------------------------

function abortable<T>(promise: Promise<T>, options?: CreateRequestOptions): Promise<T> {
  if (!options?.signal && !options?.timeoutMs) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = options?.timeoutMs
      ? setTimeout(() => reject(new Error("AI provider request timed out")), options.timeoutMs)
      : undefined;
    const abort = () => reject(new Error("AI provider request was cancelled"));
    if (options?.signal?.aborted) { abort(); return; }
    options?.signal?.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => {
      if (timer) clearTimeout(timer);
      options?.signal?.removeEventListener("abort", abort);
    });
  });
}

const useLocal = () => Boolean(process.env.LOCAL_AI_BASE_URL);
const fallbackToGemini = () => process.env.LOCAL_AI_FALLBACK_TO_GEMINI === "true";

async function dispatch(
  params: CreateParamsBase,
  options?: CreateRequestOptions,
): Promise<ChatResponse> {
  if (useLocal()) {
    try {
      return await abortable(createLocal(params, options), options);
    } catch (err) {
      if (!fallbackToGemini() || !isTransportError(err)) throw err;
    }
  }
  return abortable(createGemini(params, options), options);
}

async function dispatchStream(
  params: CreateParamsBase,
  options?: CreateRequestOptions,
): Promise<AsyncIterable<ChatChunk>> {
  if (useLocal()) {
    try {
      return await abortable(createLocalStream(params, options), options);
    } catch (err) {
      if (!fallbackToGemini() || !isTransportError(err)) throw err;
    }
  }
  return abortable(createGeminiStream(params, options), options);
}

async function create(params: CreateParamsStream, options?: CreateRequestOptions): Promise<AsyncIterable<ChatChunk>>;
async function create(params: CreateParamsSync, options?: CreateRequestOptions): Promise<ChatResponse>;
async function create(
  params: CreateParamsBase & { stream?: boolean },
  options?: CreateRequestOptions,
): Promise<ChatResponse | AsyncIterable<ChatChunk>> {
  if (params.stream) return dispatchStream(params, options);
  return dispatch(params, options);
}

// OpenAI-compatible surface consumed across the server.
export const openai = {
  chat: { completions: { create } },
};
