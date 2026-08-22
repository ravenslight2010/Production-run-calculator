export const SYNC_RETRY_BASE_MS = 1_000;
export const SYNC_RETRY_MAX_MS = 30_000;
export const SYNC_RETRY_JITTER_RATIO = 0.2;

/**
 * Calculate a bounded exponential delay. The random source is injectable so
 * retry behavior can be tested without sleeping or relying on wall-clock time.
 */
export function syncRetryDelay(
  retryIndex: number,
  random: () => number = Math.random,
): number {
  const exponent = Math.max(0, Math.floor(retryIndex));
  const exponential = Math.min(SYNC_RETRY_MAX_MS, SYNC_RETRY_BASE_MS * 2 ** exponent);
  const jitter = (Math.min(1, Math.max(0, random())) * 2 - 1) * SYNC_RETRY_JITTER_RATIO;
  return Math.round(Math.max(0, Math.min(SYNC_RETRY_MAX_MS, exponential * (1 + jitter))));
}

export type SyncRetryTimer = ReturnType<typeof setTimeout>;

/**
 * Small coalescing boundary for retryable work. One key has at most one active
 * attempt and one scheduled retry; callers can cancel it when a newer
 * generation (for example a foreground adoption) makes the work obsolete.
 */
export function createSyncRetryController(options: {
  maxRetries: number;
  onState?: (state: "idle" | "running" | "waiting" | "failed") => void;
  random?: () => number;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
}) {
  const random = options.random ?? Math.random;
  const schedule = options.setTimeout ?? setTimeout;
  const clear = options.clearTimeout ?? clearTimeout;
  let timer: SyncRetryTimer | null = null;
  let cancelled = false;
  let attempt = 0;
  let activeResolve: ((value: boolean) => void) | null = null;

  function cancel(): void {
    cancelled = true;
    if (timer !== null) clear(timer);
    timer = null;
    activeResolve?.(false);
    activeResolve = null;
    options.onState?.("idle");
  }

  function run(task: (retryIndex: number) => Promise<boolean>): Promise<boolean> {
    cancel();
    cancelled = false;
    attempt = 0;
    options.onState?.("running");
    return new Promise<boolean>((resolve) => {
      activeResolve = resolve;
      const tryOnce = () => {
        if (cancelled) {
          activeResolve = null;
          return resolve(false);
        }
        void task(attempt).then((ok) => {
          if (cancelled) {
            activeResolve = null;
            return resolve(false);
          }
          if (ok) {
            activeResolve = null;
            options.onState?.("idle");
            return resolve(true);
          }
          if (attempt >= options.maxRetries) {
            activeResolve = null;
            options.onState?.("failed");
            return resolve(false);
          }
          const delay = syncRetryDelay(attempt, random);
          attempt += 1;
          options.onState?.("waiting");
          timer = schedule(() => {
            timer = null;
            options.onState?.("running");
            tryOnce();
          }, delay);
        }).catch(() => {
          if (cancelled) {
            activeResolve = null;
            return resolve(false);
          }
          if (attempt >= options.maxRetries) {
            activeResolve = null;
            options.onState?.("failed");
            return resolve(false);
          }
          const delay = syncRetryDelay(attempt, random);
          attempt += 1;
          options.onState?.("waiting");
          timer = schedule(() => {
            timer = null;
            options.onState?.("running");
            tryOnce();
          }, delay);
        });
      };
      tryOnce();
    });
  }

  return { run, cancel };
}