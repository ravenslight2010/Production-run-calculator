import { Logger } from "pino";

/**
 * Resilience patterns for external service calls (OpenAI, Google GenAI).
 * Provides fallback, retry, and circuit breaker strategies.
 */

export interface RetryOptions {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

export function isRetryableError(err: any): boolean {
  if (!err) return false;
  const message = err.message?.toLowerCase() || "";
  const status = err.status || err.statusCode;
  // Retry on rate limits, timeouts, 5xx
  return (
    status === 429 ||
    status === 408 ||
    (status >= 500 && status < 600) ||
    message.includes("timeout") ||
    message.includes("econnrefused") ||
    message.includes("econnreset")
  );
}

export async function withExponentialBackoff<T>(
  fn: () => Promise<T>,
  log: Logger,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastErr: any;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryableError(err) || attempt === opts.maxRetries) {
        throw err;
      }
      // Exponential backoff with jitter
      const delay = Math.min(
        opts.initialDelayMs * Math.pow(opts.backoffMultiplier, attempt) +
          Math.random() * 1000,
        opts.maxDelayMs,
      );
      log.warn(
        { attempt, delay, error: (err as any).message },
        `Retryable error, backing off ${delay}ms`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastErr;
}

/**
 * Circuit breaker: fail fast if a service is degraded.
 * Prevents cascading failures and unnecessary retries.
 */
export class CircuitBreaker {
  private failureCount = 0;
  private lastFailureTime = 0;
  private state: "closed" | "open" | "half-open" = "closed";

  constructor(
    private failureThreshold: number = 5,
    private resetTimeoutMs: number = 60000,
    private log: Logger,
  ) {}

  async call<T>(fn: () => Promise<T>, context: string = ""): Promise<T> {
    // If open, check if we should half-open (timeout expired)
    if (this.state === "open") {
      if (Date.now() - this.lastFailureTime > this.resetTimeoutMs) {
        this.state = "half-open";
        this.log.info(
          { context, failureCount: this.failureCount },
          "Circuit breaker half-open, attempting reset",
        );
      } else {
        const err = new Error(
          `Circuit breaker open for ${context}. Service unavailable.`,
        );
        (err as any).code = "CIRCUIT_BREAKER_OPEN";
        throw err;
      }
    }

    try {
      const result = await fn();
      // Success: reset failure count
      if (this.state === "half-open") {
        this.state = "closed";
        this.failureCount = 0;
        this.log.info({ context }, "Circuit breaker closed");
      }
      return result;
    } catch (err) {
      this.failureCount++;
      this.lastFailureTime = Date.now();

      if (this.failureCount >= this.failureThreshold) {
        this.state = "open";
        this.log.error(
          { context, failureCount: this.failureCount },
          "Circuit breaker opened",
        );
      }
      throw err;
    }
  }
}
