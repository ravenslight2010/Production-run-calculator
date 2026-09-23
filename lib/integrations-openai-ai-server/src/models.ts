// Google Gemini models served via Replit AI Integrations or the direct Gemini
// API (GOOGLE_API_KEY). Primary is gemini-3.8-flash (2026-09-23): on Render's
// key, gemini-3.6-flash (the previous default) is quota-exhausted — the API
// returns 429 "You exceeded your current quota" — and intermittently 503
// "high demand", so imports that "try" fail with empty/errored parses. The
// 2.5 family is retired on the direct API (404 "no longer available"), and
// 3.x flash capacity spikes are broad, so the client keeps an ordered fallback
// chain (aiModelFallbacks) and retries provider/empty-content failures on the
// next healthy model instead of 502'ing the route (see client.ts create).
//
// Env overrides (so a quota/retirement incident can be re-pinned without a
// code deploy + Render image switch):
//   AI_MODEL_FULL / AI_MODEL_CHEAP — override either tier's primary model.
//   AI_MODEL_FALLBACKS — comma-separated fallback chain in order.
const DEFAULT_FULL_MODEL = "gemini-3.8-flash";
const DEFAULT_CHEAP_MODEL = "gemini-3.8-flash";
const DEFAULT_MODEL_FALLBACKS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"] as const;

function modelFromEnv(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

export const AI_MODELS = {
  full: modelFromEnv("AI_MODEL_FULL", DEFAULT_FULL_MODEL),
  cheap: modelFromEnv("AI_MODEL_CHEAP", DEFAULT_CHEAP_MODEL),
} as const;

export type ModelKind = keyof typeof AI_MODELS;

export function pickModel(kind: ModelKind = "full"): string {
  return AI_MODELS[kind];
}

// Ordered fallback chain for provider failures (quota, capacity 503s, retired
// models). Configurable via AI_MODEL_FALLBACKS; the primary is never repeated.
export function aiModelFallbacks(): readonly string[] {
  const env = process.env.AI_MODEL_FALLBACKS?.trim();
  if (env) {
    return env.split(",").map((model) => model.trim()).filter((model) => model.length > 0);
  }
  return DEFAULT_MODEL_FALLBACKS;
}

// The full ordered model chain for a single call: primary first, then each
// fallback (deduped against the primary so a degraded model isn't retried).
export function modelChain(primary: string): readonly string[] {
  return [primary, ...aiModelFallbacks().filter((model) => model !== primary)];
}
