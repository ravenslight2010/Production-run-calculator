import { fetchModelJsonWithRetry, type AiJsonResult } from "./aiJsonRetry";

/** Minimal logger shared by model-backed services without coupling them to Express. */
export type AiModelLogger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

/**
 * Stable, provider-neutral detail for a bounded JSON call. `aiStatus` remains
 * suitable for existing client response contracts while `modelStatus` preserves
 * the reason operators need to distinguish an outage from malformed output.
 */
export type AiModelStatus = "completed" | "provider-unavailable" | "rate-limited" | "malformed";

export type AiStatusMetadata = {
  aiGenerated: boolean;
  aiStatus: "deterministic" | "enriched" | "unavailable";
  modelStatus?: AiModelStatus;
  decision: "suggestion";
};

export type BoundedJsonModelResult =
  | { ok: true; raw: unknown; modelStatus: "completed" }
  | {
      ok: false;
      modelStatus: Exclude<AiModelStatus, "completed">;
      failure: Extract<AiJsonResult, { ok: false }>;
    };

/**
 * The one place retained services execute model JSON. It deliberately delegates
 * retry/backoff limits to aiJsonRetry and does not know about a request, DB,
 * cache, correction memory, or provider SDK.
 */
export async function runBoundedJsonModel(input: {
  label: string;
  log: AiModelLogger;
  call: () => Promise<string>;
}): Promise<BoundedJsonModelResult> {
  const result = await fetchModelJsonWithRetry(input);
  if (result.ok) return { ok: true, raw: result.raw, modelStatus: "completed" };

  const modelStatus =
    result.reason === "provider"
      ? "provider-unavailable"
      : result.reason === "rate-limited"
        ? "rate-limited"
        : "malformed";
  return { ok: false, modelStatus, failure: result };
}

export function deterministicSuggestionMetadata(): AiStatusMetadata {
  return { aiGenerated: false, aiStatus: "deterministic", decision: "suggestion" };
}

export function unavailableSuggestionMetadata(
  modelStatus: Exclude<AiModelStatus, "completed">,
): AiStatusMetadata {
  return {
    aiGenerated: false,
    aiStatus: "unavailable",
    modelStatus,
    decision: "suggestion",
  };
}

export function enrichedSuggestionMetadata(): AiStatusMetadata {
  return {
    aiGenerated: true,
    aiStatus: "enriched",
    modelStatus: "completed",
    decision: "suggestion",
  };
}