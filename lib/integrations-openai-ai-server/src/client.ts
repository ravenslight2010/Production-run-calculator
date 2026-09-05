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
import type { Content, Part, GenerateContentConfig } from "@google/genai";

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

async function create(params: CreateParamsStream): Promise<AsyncIterable<ChatChunk>>;
async function create(params: CreateParamsSync): Promise<ChatResponse>;
async function create(
  params: CreateParamsBase & { stream?: boolean },
): Promise<ChatResponse | AsyncIterable<ChatChunk>> {
  const { systemInstruction, contents } = toGemini(params.messages);
  const config = buildConfig(params, systemInstruction);
  const ai = client();

  if (params.stream) {
    const stream = await ai.models.generateContentStream({
      model: params.model,
      contents,
      config,
    });
    return (async function* () {
      for await (const chunk of stream) {
        yield { choices: [{ delta: { content: chunk.text ?? null } }] };
      }
    })();
  }

  const response = await ai.models.generateContent({
    model: params.model,
    contents,
    config,
  });
  return { choices: [{ message: { content: response.text ?? null } }] };
}

// OpenAI-compatible surface consumed across the server.
export const openai = {
  chat: { completions: { create } },
};
