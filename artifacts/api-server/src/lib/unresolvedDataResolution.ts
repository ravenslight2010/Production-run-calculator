import {
  deterministicSuggestionMetadata,
  enrichedSuggestionMetadata,
  runBoundedJsonModel,
  unavailableSuggestionMetadata,
  type AiModelLogger,
  type AiStatusMetadata,
} from "./aiBoundedJson";

export type DeterministicResolution<TResolved, TUnresolved> = {
  resolved: TResolved;
  unresolved: TUnresolved;
};

export type UnresolvedDataResolutionResult<TOutput> = {
  data: TOutput;
  metadata: AiStatusMetadata;
};

export type UnresolvedEnrichment<TSuggestions> = {
  suggestions: TSuggestions;
  /** Cache-backed adapters retain model failure distinctions without exposing
   * their cache/cost mechanics to the orchestration layer. */
  status: "enriched" | "unavailable";
  modelStatus?: AiStatusMetadata["modelStatus"];
};

/**
 * Deterministic-first resolution for retained suggestion services.
 *
 * This is deliberately a two-phase orchestration boundary. The callback may
 * construct a grounded prompt, use a route-owned cache, and charge route-owned
 * cost, but it receives only the unresolved payload. We recompute deterministic
 * state after enrichment before merging so cached/model suggestions can never
 * cause stale request-local deterministic matches to be replayed.
 */
export async function resolveUnresolvedData<
  TInput,
  TResolved,
  TUnresolved,
  TModelInput,
  TModelSuggestions,
  TOutput,
>(input: {
  label: string;
  log: AiModelLogger;
  input: TInput;
  resolveDeterministically: (input: TInput) => DeterministicResolution<TResolved, TUnresolved>;
  hasUnresolved: (unresolved: TUnresolved) => boolean;
  buildModelInput: (unresolved: TUnresolved) => TModelInput;
  call: (modelInput: TModelInput) => Promise<string>;
  sanitize: (raw: unknown, unresolved: TUnresolved) => TModelSuggestions;
  merge: (resolved: TResolved, suggestions: TModelSuggestions) => TOutput;
}): Promise<UnresolvedDataResolutionResult<TOutput>> {
  const deterministic = input.resolveDeterministically(input.input);
  if (!input.hasUnresolved(deterministic.unresolved)) {
    return {
      data: input.merge(deterministic.resolved, input.sanitize({}, deterministic.unresolved)),
      metadata: deterministicSuggestionMetadata(),
    };
  }

  // Deliberately construct once and close over only this reduced payload.
  const modelInput = input.buildModelInput(deterministic.unresolved);
  const result = await runBoundedJsonModel({
    label: input.label,
    log: input.log,
    call: () => input.call(modelInput),
  });
  if (!result.ok) {
    return {
      data: input.merge(
        input.resolveDeterministically(input.input).resolved,
        input.sanitize({}, deterministic.unresolved),
      ),
      metadata: unavailableSuggestionMetadata(result.modelStatus),
    };
  }

  return {
    data: input.merge(
      input.resolveDeterministically(input.input).resolved,
      input.sanitize(result.raw, deterministic.unresolved),
    ),
    metadata: enrichedSuggestionMetadata(),
  };
}

/**
 * Cache-aware form of the same deterministic-first orchestration. Route-owned
 * cache/cost/review adapters get exactly one invocation and only unresolved
 * data; this service retains short-circuiting, canonical status, and the final
 * fresh deterministic merge.
 */
export async function resolveUnresolvedDataWithEnrichment<
  TInput,
  TResolved,
  TUnresolved,
  TSuggestions,
  TOutput,
>(input: {
  input: TInput;
  resolveDeterministically: (input: TInput) => DeterministicResolution<TResolved, TUnresolved>;
  hasUnresolved: (unresolved: TUnresolved) => boolean;
  enrichUnresolved: (unresolved: TUnresolved) => Promise<UnresolvedEnrichment<TSuggestions>>;
  emptySuggestions: (unresolved: TUnresolved) => TSuggestions;
  merge: (resolved: TResolved, suggestions: TSuggestions) => TOutput;
}): Promise<UnresolvedDataResolutionResult<TOutput>> {
  const deterministic = input.resolveDeterministically(input.input);
  if (!input.hasUnresolved(deterministic.unresolved)) {
    return {
      data: input.merge(deterministic.resolved, input.emptySuggestions(deterministic.unresolved)),
      metadata: deterministicSuggestionMetadata(),
    };
  }
  const enrichment = await input.enrichUnresolved(deterministic.unresolved);
  return {
    data: input.merge(
      input.resolveDeterministically(input.input).resolved,
      enrichment.suggestions,
    ),
    metadata:
      enrichment.status === "enriched"
        ? enrichedSuggestionMetadata()
        : unavailableSuggestionMetadata(
            enrichment.modelStatus === "rate-limited" ||
              enrichment.modelStatus === "provider-unavailable" ||
              enrichment.modelStatus === "malformed"
              ? enrichment.modelStatus
              : "malformed",
          ),
  };
}
