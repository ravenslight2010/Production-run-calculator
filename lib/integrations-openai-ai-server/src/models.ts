// Model registry for the local-first AI adapter.
//
// Two backends can serve a request (see client.ts for the dispatch):
//
//   1. Self-hosted OpenAI-compatible server (Ollama / llama.cpp) when
//      LOCAL_AI_BASE_URL is set. Model names are whatever that server
//      serves — override with LOCAL_MODEL_FULL / LOCAL_MODEL_CHEAP without
//      touching any call site.
//   2. Gemini (Replit AI Integrations proxy or direct GOOGLE_API_KEY) — the
//      retained fallback path. gemini-3.6-flash is the current model: it
//      honors JSON response mode and supports vision and streaming. The 2.5
//      family is restricted for new users (the direct API returns 404 "no
//      longer available to new users" for gemini-2.5-*), so both tiers point
//      at gemini-3.6-flash and can diverge later without touching call sites.
//
// The two tiers exist so callers can still signal intent (cheap =
// matching/classification, full = extraction/vision).
//
// Resolution is lazy (per call) so tests and long-lived processes observe env
// changes; AI_MODELS is the snapshot taken at import time for introspection.

const GEMINI_FULL = process.env.GEMINI_MODEL_FULL ?? "gemini-3.6-flash";
const GEMINI_CHEAP = process.env.GEMINI_MODEL_CHEAP ?? "gemini-3.6-flash";

function useLocal(): boolean {
  return Boolean(process.env.LOCAL_AI_BASE_URL);
}

export function resolveModel(kind: "full" | "cheap"): string {
  if (useLocal()) {
    return kind === "cheap"
      ? process.env.LOCAL_MODEL_CHEAP ?? "qwen3:4b"
      : process.env.LOCAL_MODEL_FULL ?? "qwen3:14b";
  }
  return kind === "cheap" ? GEMINI_CHEAP : GEMINI_FULL;
}

export const AI_MODELS = {
  full: resolveModel("full"),
  cheap: resolveModel("cheap"),
} as const;

export type ModelKind = keyof typeof AI_MODELS;

export function pickModel(kind: ModelKind = "full"): string {
  return resolveModel(kind);
}
