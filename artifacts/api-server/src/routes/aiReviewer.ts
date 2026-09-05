import { openai, pickModel } from "@workspace/integrations-openai-ai-server";
import {
  buildReviewPrompt,
  normalizeReviewItems,
  sanitizeReviewVerdicts,
  verdictsById,
  type ReviewItem,
  type ReviewVerdict,
} from "@workspace/ai-review";

// Second-set-of-eyes reviewer: after a helper's deterministic sanitizer has run,
// a second AI pass scores each surviving suggestion (ok / warn / reject + a short
// reason) so the UI can flag risky or likely-wrong items before staff confirm
// them. Strictly ADVISORY and FAIL-SAFE: any error, timeout, non-JSON response,
// or empty input yields an empty verdict map and the original suggestions flow
// through untouched. It never blocks or mutates a suggestion.

type ReviewLogger = {
  error: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
};

// The wire/OpenAPI ReviewVerdict is { status, reason? } — the `id` carried by the
// lib type is an internal correlation key (the map key), not part of the public
// contract, so it is stripped before the verdict is attached to a suggestion.
type PublicVerdict = Omit<ReviewVerdict, "id">;

const REVIEW_CACHE_TTL_MS = 10 * 60 * 1000;
const reviewCache = new Map<string, { expiresAt: number; verdicts: Map<string, PublicVerdict> }>();

function reviewFingerprint(
  featureLabel: string,
  instructions: string,
  items: ReadonlyArray<ReviewItem>,
): string {
  return JSON.stringify({
    featureLabel: featureLabel.trim(),
    instructions: instructions.trim(),
    items: normalizeReviewItems(items),
  });
}

export function clearReviewSuggestionCache(): void {
  reviewCache.clear();
}

export async function reviewSuggestions(opts: {
  featureLabel: string;
  instructions: string;
  items: ReviewItem[];
  log: ReviewLogger;
}): Promise<Map<string, PublicVerdict>> {
  const { featureLabel, instructions, items, log } = opts;
  // Nothing to review — skip the (paid) call entirely.
  if (items.length === 0) return new Map();

  const normalizedItems = normalizeReviewItems(items);
  const key = reviewFingerprint(featureLabel, instructions, normalizedItems);
  const cached = reviewCache.get(key);
  if (cached) {
    if (cached.expiresAt > Date.now()) return new Map(cached.verdicts);
    reviewCache.delete(key);
  }

  const { system, user } = buildReviewPrompt(featureLabel, instructions, normalizedItems);

  let content = "";
  try {
    const response = await openai.chat.completions.create({
      model: pickModel("full"),
      max_completion_tokens: 4096,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    content = response.choices[0]?.message?.content ?? "";
  } catch (err) {
    // Advisory only: a reviewer outage must not break the underlying helper.
    log.error({ err }, "ai reviewer call failed");
    return new Map();
  }

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    log.warn({ content: content.slice(0, 200) }, "ai reviewer non-JSON response");
    return new Map();
  }

  const verdicts = sanitizeReviewVerdicts(
    raw,
    items.map((i) => i.id),
  );
  const byId = verdictsById(verdicts);
  const out = new Map<string, PublicVerdict>();
  for (const [id, v] of byId) {
    out.set(id, v.reason !== undefined ? { status: v.status, reason: v.reason } : { status: v.status });
  }
  reviewCache.set(key, { expiresAt: Date.now() + REVIEW_CACHE_TTL_MS, verdicts: new Map(out) });
  return out;
}
