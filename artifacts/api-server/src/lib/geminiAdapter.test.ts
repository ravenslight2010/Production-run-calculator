import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateContent = vi.fn();
const generateContentStream = vi.fn();

// Mirrors the SDK's string-valued ThinkingLevel enum. The adapter reads
// ThinkingLevel.LOW when building its config, so the mock must supply it or
// every request fails on an undefined property read instead of on the
// resilience behaviour these tests actually cover.
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent, generateContentStream };
  },
  ThinkingLevel: {
    THINKING_LEVEL_UNSPECIFIED: "THINKING_LEVEL_UNSPECIFIED",
    MINIMAL: "MINIMAL",
    LOW: "LOW",
    MEDIUM: "MEDIUM",
    HIGH: "HIGH",
  },
}));

import {
  GeminiProviderUnavailableError,
  openai,
  resetGeminiResilienceForTests,
  setGeminiMetricsObserver,
  type GeminiRequestMetrics,
} from "@workspace/integrations-openai-ai-server";

const params = {
  model: "gemini-test",
  messages: [{ role: "user" as const, content: "sensitive prompt" }],
};

function transient(status = 503, retryAfter?: string): Error {
  return Object.assign(new Error("provider payload must not be logged"), {
    status,
    response: retryAfter
      ? { headers: { get: (name: string) => name === "retry-after" ? retryAfter : null } }
      : undefined,
  });
}

describe("Gemini adapter resilience", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.useRealTimers();
    generateContent.mockReset();
    generateContentStream.mockReset();
    resetGeminiResilienceForTests();
    process.env.AI_INTEGRATIONS_GEMINI_API_KEY = "test-key";
  });

  it("passes provider-native timeout and cancellation and reports safe metrics", async () => {
    const metrics: GeminiRequestMetrics[] = [];
    setGeminiMetricsObserver((sample) => metrics.push(sample));
    generateContent.mockResolvedValue({
      text: "{\"ok\":true}",
      usageMetadata: {
        promptTokenCount: 12,
        candidatesTokenCount: 7,
        totalTokenCount: 19,
      },
    });

    await expect(openai.chat.completions.create(params, { timeoutMs: 4321 }))
      .resolves.toEqual({ choices: [{ message: { content: "{\"ok\":true}" } }] });

    const request = generateContent.mock.calls[0]?.[0];
    expect(request.config.httpOptions.timeout).toBe(4321);
    expect(request.config.abortSignal).toBeInstanceOf(AbortSignal);
    expect(metrics).toEqual([expect.objectContaining({
      outcome: "success",
      retryCount: 0,
      promptTokens: 12,
      completionTokens: 7,
      totalTokens: 19,
      costMicrousd: 0,
    })]);
    expect(Object.keys(metrics[0] ?? {}).sort()).toEqual([
      "completionTokens",
      "costMicrousd",
      "durationMs",
      "outcome",
      "promptTokens",
      "retryCount",
      "totalTokens",
    ]);
    expect(JSON.stringify(metrics)).not.toContain("sensitive prompt");
  });

  it("keeps Gemini selected when only a proposed local endpoint is configured", async () => {
    vi.stubEnv("LOCAL_AI_BASE_URL", "http://127.0.0.1:11434/v1");
    generateContent.mockResolvedValue({ text: "Gemini response" });

    await expect(openai.chat.completions.create(params)).resolves.toEqual({
      choices: [{ message: { content: "Gemini response" } }],
    });

    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(generateContentStream).not.toHaveBeenCalled();
  });

  it("records stream success only after the iterator is fully consumed", async () => {
    const metrics: GeminiRequestMetrics[] = [];
    setGeminiMetricsObserver((sample) => metrics.push(sample));
    generateContentStream.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { text: "first" };
        yield { text: "last" };
      },
    });

    const stream = await openai.chat.completions.create({
      ...params,
      stream: true,
    });
    const iterator = stream[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { choices: [{ delta: { content: "first" } }] },
    });
    expect(metrics).toEqual([]);
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { choices: [{ delta: { content: "last" } }] },
    });
    expect(metrics).toEqual([]);
    await expect(iterator.next()).resolves.toMatchObject({ done: true });
    expect(metrics).toEqual([
      expect.objectContaining({ outcome: "success", retryCount: 0 }),
    ]);
  });

  it("reports a mid-stream provider failure instead of recording stream creation as success", async () => {
    const metrics: GeminiRequestMetrics[] = [];
    setGeminiMetricsObserver((sample) => metrics.push(sample));
    generateContentStream.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { text: "partial response" };
        throw transient(503);
      },
    });

    const stream = await openai.chat.completions.create({
      ...params,
      stream: true,
    });
    expect(metrics).toEqual([]);

    const iterator = stream[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { choices: [{ delta: { content: "partial response" } }] },
    });
    await expect(iterator.next()).rejects.toBeInstanceOf(
      GeminiProviderUnavailableError,
    );

    expect(generateContentStream).toHaveBeenCalledTimes(1);
    expect(metrics).toEqual([
      expect.objectContaining({
        outcome: "provider_error",
        retryCount: 0,
      }),
    ]);
  });

  it("keeps caller cancellation active while a stream is being consumed", async () => {
    const metrics: GeminiRequestMetrics[] = [];
    const controller = new AbortController();
    setGeminiMetricsObserver((sample) => metrics.push(sample));
    generateContentStream.mockImplementation(({ config }) => Promise.resolve({
      async *[Symbol.asyncIterator]() {
        yield { text: "started" };
        await new Promise((_resolve, reject) => {
          config.abortSignal.addEventListener(
            "abort",
            () => reject(config.abortSignal.reason),
            { once: true },
          );
        });
      },
    }));

    const stream = await openai.chat.completions.create(
      { ...params, stream: true },
      { signal: controller.signal },
    );
    const iterator = stream[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({ done: false });
    const cancelled = expect(iterator.next()).rejects.toMatchObject({
      name: "GeminiRequestCancelledError",
    });
    controller.abort();
    await cancelled;

    expect(metrics).toEqual([
      expect.objectContaining({ outcome: "cancelled", retryCount: 0 }),
    ]);
  });

  it("keeps the explicit timeout active while a stream is being consumed", async () => {
    vi.useFakeTimers();
    const metrics: GeminiRequestMetrics[] = [];
    setGeminiMetricsObserver((sample) => metrics.push(sample));
    generateContentStream.mockImplementation(({ config }) => Promise.resolve({
      async *[Symbol.asyncIterator]() {
        yield { text: "started" };
        await new Promise((_resolve, reject) => {
          config.abortSignal.addEventListener(
            "abort",
            () => reject(config.abortSignal.reason),
            { once: true },
          );
        });
      },
    }));

    const stream = await openai.chat.completions.create(
      { ...params, stream: true },
      { timeoutMs: 25 },
    );
    const iterator = stream[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({ done: false });
    const timedOut = expect(iterator.next()).rejects.toBeInstanceOf(
      GeminiProviderUnavailableError,
    );
    await vi.advanceTimersByTimeAsync(25);
    await timedOut;

    expect(metrics).toEqual([
      expect.objectContaining({ outcome: "timeout", retryCount: 0 }),
    ]);
  });

  it("aborts the underlying request when the explicit timeout expires", async () => {
    vi.useFakeTimers();
    generateContent.mockImplementation(({ config }) => new Promise((_resolve, reject) => {
      config.abortSignal.addEventListener("abort", () => reject(config.abortSignal.reason));
    }));

    const request = openai.chat.completions.create(params, { timeoutMs: 25 });
    const rejected = expect(request).rejects.toBeInstanceOf(GeminiProviderUnavailableError);
    await vi.advanceTimersByTimeAsync(25);
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(25);

    await rejected;
    expect(generateContent.mock.calls[0]?.[0].config.abortSignal.aborted).toBe(true);
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("retries one transient failure and honors Retry-After", async () => {
    vi.useFakeTimers();
    generateContent
      .mockRejectedValueOnce(transient(429, "2"))
      .mockResolvedValueOnce({ text: "ok" });

    const request = openai.chat.completions.create(params);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(generateContent).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(request).resolves.toEqual({
      choices: [{ message: { content: "ok" } }],
    });
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-transient provider failures", async () => {
    generateContent.mockRejectedValue(transient(400));

    await expect(openai.chat.completions.create(params))
      .rejects.toBeInstanceOf(GeminiProviderUnavailableError);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("advances to the next model after an exhausted rung and reports the serving model", async () => {
    vi.useFakeTimers();
    generateContent
      .mockRejectedValueOnce(transient(503))
      .mockRejectedValueOnce(transient(503))
      .mockResolvedValueOnce({ text: "recovered" });

    const request = openai.chat.completions.create(params);
    const settled = expect(request).resolves.toEqual({
      choices: [{ message: { content: "recovered" } }],
      model: "gemini-3.5-flash",
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await settled;
    expect(generateContent).toHaveBeenCalledTimes(3);
  });

  it("advances past empty content instead of returning a hollow answer", async () => {
    generateContent
      .mockResolvedValueOnce({ text: "" })
      .mockResolvedValueOnce({ text: "recovered" });

    await expect(openai.chat.completions.create(params)).resolves.toEqual({
      choices: [{ message: { content: "recovered" } }],
      model: "gemini-3.5-flash",
    });
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("stops the ladder on a safety block rather than retrying another model", async () => {
    generateContent.mockResolvedValueOnce({
      text: "",
      candidates: [{ finishReason: "SAFETY" }],
    });

    await expect(openai.chat.completions.create(params)).resolves.toEqual({
      choices: [{ message: { content: null } }],
    });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("does not advance the ladder on a caller cancellation", async () => {
    const controller = new AbortController();
    generateContent.mockImplementation(() => {
      controller.abort();
      return Promise.reject(transient(503));
    });

    await expect(
      openai.chat.completions.create(params, { signal: controller.signal }),
    ).rejects.toThrow(/cancelled/);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("falls back when stream SETUP fails but never mid-stream", async () => {
    vi.useFakeTimers();
    generateContentStream
      .mockRejectedValueOnce(transient(503))
      .mockRejectedValueOnce(transient(503))
      .mockResolvedValueOnce({
        async *[Symbol.asyncIterator]() {
          yield { text: "first" };
        },
      });

    const request = openai.chat.completions.create({ ...params, stream: true });
    // The failed setup retries once behind a 250ms backoff before the ladder
    // advances, so fake time has to move while the call is in flight.
    await vi.advanceTimersByTimeAsync(1_000);
    const stream = await request;
    const iterator = stream[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { choices: [{ delta: { content: "first" } }] },
    });
    expect(generateContentStream).toHaveBeenCalledTimes(3);
  });

  it("opens after repeated transient failures and permits only one half-open probe", async () => {
    vi.useFakeTimers();
    generateContent.mockRejectedValue(transient());

    // The breaker counts EXHAUSTED LADDERS, not individual rungs: a rung that
    // fails while fallbacks remain must not count, or the circuit would open
    // partway down and the fallbacks would never be tried.
    for (let call = 0; call < 3; call += 1) {
      const request = openai.chat.completions.create(params);
      const rejected = expect(request).rejects.toBeInstanceOf(GeminiProviderUnavailableError);
      // Each rung retries once behind a 250ms backoff, so walking the whole
      // ladder needs 3 x 250ms before the call settles.
      await vi.advanceTimersByTimeAsync(1_000);
      await rejected;
    }
    await expect(openai.chat.completions.create(params))
      .rejects.toBeInstanceOf(GeminiProviderUnavailableError);
    // 3 exhausted ladders x 3 rungs x (initial attempt + 1 retry).
    expect(generateContent).toHaveBeenCalledTimes(18);

    await vi.advanceTimersByTimeAsync(30_000);
    let resolveProbe!: (value: { text: string }) => void;
    generateContent.mockImplementationOnce(() => new Promise((resolve) => {
      resolveProbe = resolve;
    }));
    const probe = openai.chat.completions.create(params);
    await expect(openai.chat.completions.create(params))
      .rejects.toBeInstanceOf(GeminiProviderUnavailableError);
    resolveProbe({ text: "recovered" });
    await expect(probe).resolves.toEqual({
      choices: [{ message: { content: "recovered" } }],
    });
  });
});