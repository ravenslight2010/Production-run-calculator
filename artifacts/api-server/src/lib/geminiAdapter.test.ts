import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateContent = vi.fn();
const generateContentStream = vi.fn();

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent, generateContentStream };
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

  it("opens after repeated transient failures and permits only one half-open probe", async () => {
    vi.useFakeTimers();
    generateContent.mockRejectedValue(transient());

    for (let call = 0; call < 3; call += 1) {
      const request = openai.chat.completions.create(params);
      const rejected = expect(request).rejects.toBeInstanceOf(GeminiProviderUnavailableError);
      await vi.advanceTimersByTimeAsync(250);
      await rejected;
    }
    await expect(openai.chat.completions.create(params))
      .rejects.toBeInstanceOf(GeminiProviderUnavailableError);
    expect(generateContent).toHaveBeenCalledTimes(6);

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