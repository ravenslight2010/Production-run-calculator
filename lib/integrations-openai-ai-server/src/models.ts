// Google Gemini models served via Replit AI Integrations or the direct Gemini
// API (GOOGLE_API_KEY). gemini-3.6-flash is the primary: it honors JSON response
// mode and supports vision and streaming — the right fit for this real-time
// floor app. The 2.5 family is restricted for new users: with this account's
// key, the direct API returns 404 "no longer available to new users" for
// gemini-2.5-flash / 2.5-pro / 2.0-flash (verified 2026-09-22), and Google
// points to gemini-3.6-flash.
//
// Routing is ONE provider with an ordered ladder of models — there is no local
// provider. See .agents/memory/ai-fallback-chain-design.md: the local adapter
// is a dated no-go (docs/evidence/gated-local-ai-adapter-decision-2026-10-02.md)
// and LOCAL_AI_BASE_URL stays inert.
//
// The fallbacks below are the failure backstop for the documented
// thinking-token starvation mode, where a 3.x flash model burns its whole
// output budget on hidden thoughts and still returns HTTP 200 with no text.
// Both ids are real models in @google/genai 2.25.x: gemini-3.5-flash and
// gemini-3.1-flash-lite. (An earlier proposal used "gemini-3.5-flash-lite",
// which is not a model id at all and would spend a ladder step on a 404.)
const DEFAULT_FULL_MODEL = "gemini-3.6-flash";
const DEFAULT_CHEAP_MODEL = "gemini-3.6-flash";
const DEFAULT_MODEL_FALLBACKS = ["gemini-3.5-flash", "gemini-3.1-flash-lite"] as const;

/** Read a trimmed environment override, using the fallback when unset or blank. */
function modelFromEnv(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

export const AI_MODELS = {
  full: modelFromEnv("AI_MODEL_FULL", DEFAULT_FULL_MODEL),
  cheap: modelFromEnv("AI_MODEL_CHEAP", DEFAULT_CHEAP_MODEL),
} as const;

export type ModelKind = keyof typeof AI_MODELS;

// Resolved per call rather than read once at import, so a test (or a runtime
// env change) that sets AI_MODEL_FULL/AI_MODEL_CHEAP is actually honoured.
export function pickModel(kind: ModelKind = "full"): string {
  return modelFromEnv(kind === "cheap" ? "AI_MODEL_CHEAP" : "AI_MODEL_FULL", AI_MODELS[kind]);
}

/**
 * Read AI_MODEL_FALLBACKS on each call as an ordered, comma-separated list.
 * Unset or whitespace-only values use the defaults; empty entries are removed,
 * so a commas-only value disables the fallback ladder entirely.
 */
export function aiModelFallbacks(): readonly string[] {
  const env = process.env.AI_MODEL_FALLBACKS?.trim();
  if (env) {
    return env.split(",").map((model) => model.trim()).filter((model) => model.length > 0);
  }
  return DEFAULT_MODEL_FALLBACKS;
}

/**
 * The primary followed by the configured fallbacks, with exact matches to the
 * primary dropped. Duplicate non-primary fallbacks keep their original order.
 */
export function modelChain(primary: string): readonly string[] {
  return [primary, ...aiModelFallbacks().filter((model) => model !== primary)];
}
