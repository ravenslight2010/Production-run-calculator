import OpenAI from "openai";
import { CircuitBreaker, withExponentialBackoff } from "./resilience";
import { logger } from "./logger";

/**
 * OpenAI client with resilience patterns:
 * - Circuit breaker: fail fast if OpenAI is degraded
 * - Exponential backoff with jitter: retry transient failures
 * - Fallback helpers: graceful degradation when unavailable
 */

const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const openaiBreaker = new CircuitBreaker(
  5, // Fail after 5 consecutive errors
  60000, // Reset after 60 seconds
  logger
);

export async function callOpenAiWithResilience(
  prompt: string,
  model: string = "gpt-4-turbo",
  options: { maxTokens?: number } = {}
) {
  return await openaiBreaker.call(
    () =>
      withExponentialBackoff(
        () =>
          openaiClient.chat.completions.create({
            model,
            messages: [{ role: "user", content: prompt }],
            max_tokens: options.maxTokens ?? 2000,
          }),
        logger,
        { maxRetries: 3, initialDelayMs: 1000, maxDelayMs: 30000, backoffMultiplier: 2 }
      ),
    `openai-${model}`
  );
}

export async function callOpenAiJsonWithResilience(
  systemPrompt: string,
  userPrompt: string,
  model: string = "gpt-4-turbo",
  options: { maxTokens?: number } = {}
) {
  return await openaiBreaker.call(
    () =>
      withExponentialBackoff(
        () =>
          openaiClient.chat.completions.create({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            max_tokens: options.maxTokens ?? 2000,
            response_format: { type: "json_object" },
          }),
        logger,
        { maxRetries: 3, initialDelayMs: 1000, maxDelayMs: 30000, backoffMultiplier: 2 }
      ),
    `openai-json-${model}`
  );
}

export { openaiClient, openaiBreaker };
