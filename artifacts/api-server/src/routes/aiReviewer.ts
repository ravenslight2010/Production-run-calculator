import {
  normalizeReviewItems,
  type ReviewItem,
  type ReviewVerdict,
} from "@workspace/ai-review";

// Compatibility boundary for the retired second-pass reviewer. The corpus
// benchmark found no labeled material error that was not already surfaced by
// deterministic reconciliation/source evidence and mandatory human review.
// Keep callers' response shapes stable while ensuring this helper can never
// spend provider budget or make reviewer agreement look authoritative.

type ReviewLogger = {
  error: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
};

// The wire/OpenAPI ReviewVerdict is { status, reason? } — the `id` carried by the
// lib type is an internal correlation key (the map key), not part of the public
// contract, so it is stripped before the verdict is attached to a suggestion.
type PublicVerdict = Omit<ReviewVerdict, "id">;

export function clearReviewSuggestionCache(): void {
  // Retained for test/API compatibility; there is no reviewer cache anymore.
}

export async function reviewSuggestions(opts: {
  featureLabel: string;
  instructions: string;
  items: ReviewItem[];
  log: ReviewLogger;
}): Promise<Map<string, PublicVerdict>> {
  // Normalize to preserve the old bounded-input behavior for callers and tests,
  // but intentionally produce no advisory verdicts.
  normalizeReviewItems(opts.items);
  return new Map();
}
