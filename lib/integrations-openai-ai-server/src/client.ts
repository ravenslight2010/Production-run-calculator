// Gemini-backed adapter that preserves the OpenAI chat-completions surface the
// rest of the server is written against. Backed by Google Gemini through Replit
// AI Integrations (no user-supplied API key required — the modelfarm proxy is
// configured via AI_INTEGRATIONS_GEMINI_BASE_URL / AI_INTEGRATIONS_GEMINI_API_KEY).
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
function client(): GoogleGenAI {
  if (_client) return _client;
  const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  if (!apiKey || !baseUrl) {
    throw new Error(
      "AI_INTEGRATIONS_GEMINI_API_KEY and AI_INTEGRATIONS_GEMINI_BASE_URL must be set. " +
        "These are provisioned automatically by the Replit Gemini AI integration.",
    );
  }
  _client = new GoogleGenAI({
    apiKey,
    httpOptions: { apiVersion: "", baseUrl },
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
    // Disable Gemini's internal "thinking". These tasks are structured
    // extraction / classification / advisory generation, not deep multi-step
    // reasoning. Disabling thinking keeps latency low (this powers a real-time
    // floor app + token streaming) and, crucially, guarantees the visible
    // output is never starved by the caller's token budget — thinking tokens
    // are drawn from the same maxOutputTokens pool.
    thinkingConfig: { thinkingBudget: 0 },
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
