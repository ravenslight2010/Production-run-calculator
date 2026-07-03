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

export const AI_JSON_MAX_ATTEMPTS = 2;

type RetryLogger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

export type AiJsonResult =
  | { ok: true; raw: unknown }
  | { ok: false; reason: "provider"; err: unknown }
  | { ok: false; reason: "malformed"; content: string };

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
