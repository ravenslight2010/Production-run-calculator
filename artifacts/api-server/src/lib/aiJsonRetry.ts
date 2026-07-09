// Bounded retry for AI routes that JSON.parse a model reply and fail-safe to
// an empty result on malformed output. The model occasionally truncates or
// malforms its JSON mid-response; without a retry, that transient flakiness
// silently becomes an empty result the user reads as "the AI found nothing".
// One bounded retry absorbs it. Each attempt is a paid call, so the cap stays
// at 2 total (1 retry) — a systematically failing model at most doubles cost,
// and the caller's existing empty-result fallback still applies once attempts
// are exhausted.
//
// Provider errors (the call itself throwing) are NOT retried — those routes
// 502 immediately today, and a thrown call usually means quota/outage where a
// second paid attempt only adds cost. Only a returned-but-unparseable reply is
// retried, matching the established /ai/parse-spec-sheet behavior.
//
// EXCEPTION — 429 rate limits: a 429 rejection is free (the provider refused
// the call before running it), and provider per-minute limits often clear in
// seconds. So a 429 gets ONE retry after a short backoff, still inside the
// same 2-attempt cap. If the retry is also rejected, the result is
// reason "rate-limited" so routes can tell the user to wait and try again
// (HTTP 429) instead of a generic "AI provider error" (502).

export const AI_JSON_MAX_ATTEMPTS = 2;

export const AI_RATE_LIMITED_MESSAGE =
  "The AI service is temporarily busy (rate limit). Wait a minute and try again.";

// How long to wait before retrying a 429-rejected call. Provider per-minute
// buckets usually refill within seconds; 20s balances recovery odds against
// keeping the request comfortably inside client-side import timeouts (120s+).
let rateLimitBackoffMs = 20_000;

// Test hook: lets route/unit tests exercise the 429 retry path without a real
// 20-second sleep. Returns the previous value so tests can restore it.
export function setAiRateLimitBackoffMsForTests(ms: number): number {
  const prev = rateLimitBackoffMs;
  rateLimitBackoffMs = ms;
  return prev;
}

type RetryLogger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

export type AiJsonResult =
  | { ok: true; raw: unknown }
  | { ok: false; reason: "provider"; err: unknown }
  | { ok: false; reason: "rate-limited"; err: unknown }
  | { ok: false; reason: "malformed"; content: string };

// True when a thrown provider error is a 429 rate-limit/quota rejection.
// Covers the Google GenAI ApiError shape ({ status: 429 }, message embedding
// RESOURCE_EXHAUSTED) and OpenAI-style errors ({ status: 429 } / "429" in the
// message).
export function isAiRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = (err as { status?: unknown }).status;
  if (status === 429 || status === "429") return true;
  const code = (err as { code?: unknown }).code;
  if (code === 429) return true;
  const message = (err as { message?: unknown }).message;
  if (typeof message === "string") {
    if (message.includes("RESOURCE_EXHAUSTED")) return true;
    if (/\b429\b/.test(message)) return true;
  }
  return false;
}

// Maps a failed AiJsonResult (provider or rate-limited) to the HTTP status +
// user-facing message a route should return. `providerMessage` keeps each
// route's existing generic wording (e.g. "AI provider error" vs "Vision
// provider error") for non-429 failures.
export function aiCallFailureHttp(
  result: { reason: "provider" | "rate-limited" },
  providerMessage: string,
): { status: number; error: string } {
  if (result.reason === "rate-limited") {
    return { status: 429, error: AI_RATE_LIMITED_MESSAGE };
  }
  return { status: 502, error: providerMessage };
}

// Runs `call` (which performs the paid model call and returns the raw reply
// text) up to AI_JSON_MAX_ATTEMPTS times until the reply parses as JSON.
// `label` is the route's log prefix (e.g. "ai-forecast") so log lines keep
// their existing, greppable names.
export async function fetchModelJsonWithRetry(opts: {
  label: string;
  log: RetryLogger;
  call: () => Promise<string>;
}): Promise<AiJsonResult> {
  const { label, log, call } = opts;
  let content = "";
  for (let attempt = 1; attempt <= AI_JSON_MAX_ATTEMPTS; attempt++) {
    try {
      content = await call();
    } catch (err) {
      if (isAiRateLimitError(err)) {
        if (attempt < AI_JSON_MAX_ATTEMPTS) {
          log.warn(
            { err, attempt, backoffMs: rateLimitBackoffMs },
            `${label} rate-limited by AI provider; retrying after backoff`,
          );
          if (rateLimitBackoffMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, rateLimitBackoffMs));
          }
          continue;
        }
        log.error({ err, attempt }, `${label} still rate-limited after retry`);
        return { ok: false, reason: "rate-limited", err };
      }
      log.error({ err, attempt }, `${label} call failed`);
      return { ok: false, reason: "provider", err };
    }
    try {
      const raw: unknown = JSON.parse(content);
      if (attempt > 1) {
        log.info({ attempt }, `${label} retry recovered a valid response`);
      }
      return { ok: true, raw };
    } catch {
      log.warn(
        {
          attempt,
          maxAttempts: AI_JSON_MAX_ATTEMPTS,
          contentLength: content.length,
          content: content.slice(0, 200),
        },
        `${label} non-JSON response`,
      );
    }
  }
  return { ok: false, reason: "malformed", content };
}
