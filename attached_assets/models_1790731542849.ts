// Local-first model registry. Names are whatever your self-hosted
// OpenAI-compatible server (Ollama / llama.cpp) serves — override via env
// without touching call sites. The two tiers exist so callers can still
// signal intent (cheap = matching/classification, full = extraction/vision)
// and the tiers can diverge later without touching call sites.
export const AI_MODELS = {
  full: process.env.LOCAL_MODEL_FULL ?? "qwen3:14b",
  cheap: process.env.LOCAL_MODEL_CHEAP ?? "qwen3:4b",
} as const;

export type ModelKind = keyof typeof AI_MODELS;

export function pickModel(kind: ModelKind = "full"): string {
  return AI_MODELS[kind];
}
