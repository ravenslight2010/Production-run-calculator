import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateContent = vi.fn();
const generateContentStream = vi.fn();

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
  probeGeminiModel,
  resetGeminiResilienceForTests,
  setGeminiMetricsObserver,
  MODEL_FALLBACKS,
  type GeminiRequestMetrics,
} from "@workspace/integrations-openai-ai-server";

const params = {
  model: "gemini-test",
  messages: [{
    role: "user" as const,
    content: "sensitive prompt; workbook cell: Sensitive Cheddar row",
  }],
};

function transient(
  status = 503,
  retryAfter?: string,
  message = "provider payload must not be logged",
): Error {
  return Object.assign(new Error(message), {
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

  it("probes each configured fallback with bounded synthetic input and discards output", async () => {
    generateContent.mockResolvedValue({
      text: "generated output must not escape",
    });

    for (const model of MODEL_FALLBACKS) {
      await expect(probeGeminiModel(model)).resolves.toBeUndefined();
    }

    expect(generateContent.mock.calls.map(([request]) => request)).toEqual(
      MODEL_FALLBACKS.map((model) => ({
        model,
        contents: "Reply with OK.",
        config: {
          maxOutputTokens: 1,
          temperature: 0,
          abortSignal: expect.any(AbortSignal),
        },
      })),
    );
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
      modelRung: 0,
      requestResult: "primary_success",
      fallbackTrigger: null,
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
      "fallbackTrigger",
      "modelRung",
      "outcome",
      "promptTokens",
      "requestResult",
      "retryCount",
      "totalTokens",
    ]);
    const serializedMetrics = JSON.stringify(metrics);
    expect(serializedMetrics).not.toContain("sensitive prompt");
    expect(serializedMetrics).not.toContain("Sensitive Cheddar row");
    expect(serializedMetrics).not.toContain("{\"ok\":true}");
    expect(serializedMetrics).not.toContain("gemini-test");
  });

  it("routes local-first and fails closed when the local endpoint is unreachable without opt-in fallback", async () => {
    vi.stubEnv("LOCAL_AI_BASE_URL", "http://127.0.0.1:11434/v1");
    generateContent.mockResolvedValue({ text: "Gemini response" });

    // Nothing listens on the local endpoint; without
    // LOCAL_AI_FALLBACK_TO_GEMINI=true the transport failure must surface
    // instead of silently falling through to Gemini.
    await expect(openai.chat.completions.create(params)).rejects.toThrow();

    expect(generateContent).not.toHaveBeenCalled();
    expect(generateContentStream).not.toHaveBeenCalled();
  });

  it("falls back to the Gemini chain on local transport failure when opted in", async () => {
    vi.stubEnv("LOCAL_AI_BASE_URL", "http://127.0.0.1:11434/v1");
    vi.stubEnv("LOCAL_AI_FALLBACK_TO_GEMINI", "true");
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
    expect(generateContent.mock.calls.map(([request]) => request.model))
      .toEqual(["gemini-test", "gemini-test"]);
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

  it("keeps other transient statuses on the primary instead of advancing the model chain", async () => {
    vi.useFakeTimers();
    generateContent.mockRejectedValue(transient(502));

    const request = openai.chat.completions.create(params);
    const rejected = expect(request).rejects.toBeInstanceOf(GeminiProviderUnavailableError);
    await vi.advanceTimersByTimeAsync(250);
    await rejected;

    expect(generateContent.mock.calls.map(([request]) => request.model))
      .toEqual(["gemini-test", "gemini-test"]);
  });

  it("recovers an upstream gateway deadline using the bounded fallback chain", async () => {
    vi.useFakeTimers();
    const metrics: GeminiRequestMetrics[] = [];
    setGeminiMetricsObserver(sample => metrics.push(sample));
    generateContent
      .mockRejectedValueOnce(transient(504))
      .mockRejectedValueOnce(transient(504))
      .mockResolvedValueOnce({ text: "recovered" });

    const request = openai.chat.completions.create(params);
    const settled = expect(request).resolves.toEqual({
      choices: [{ message: { content: "recovered" } }],
      model: "gemini-3.5-flash",
    });
    await vi.advanceTimersByTimeAsync(250);
    await settled;

    expect(generateContent.mock.calls.map(request => request[0].model)).toEqual([
      "gemini-test", "gemini-test", "gemini-3.5-flash",
    ]);
    expect(metrics.map(({ modelRung, requestResult, fallbackTrigger }) => ({
      modelRung, requestResult, fallbackTrigger,
    }))).toEqual([
      { modelRung: 0, requestResult: "fallback_triggered", fallbackTrigger: null },
      { modelRung: 1, requestResult: "fallback_success", fallbackTrigger: "service_unavailable" },
    ]);
  });

  it("advances to a fallback after exhausting transient retries and preserves the primary", async () => {
    vi.useFakeTimers();
    const metrics: GeminiRequestMetrics[] = [];
    setGeminiMetricsObserver((sample) => metrics.push(sample));
    generateContent
      .mockRejectedValueOnce(transient(503))
      .mockRejectedValueOnce(transient(503))
      .mockResolvedValueOnce({ text: "recovered" });

    const request = openai.chat.completions.create(params);
    const settled = expect(request).resolves.toEqual({
      choices: [{ message: { content: "recovered" } }],
      model: "gemini-3.5-flash",
    });
    await vi.advanceTimersByTimeAsync(250);
    await settled;

    expect(generateContent.mock.calls.map(([request]) => request.model)).toEqual([
      "gemini-test",
      "gemini-test",
      "gemini-3.5-flash",
    ]);
    expect(metrics.map(({ modelRung, requestResult, fallbackTrigger }) => ({
      modelRung,
      requestResult,
      fallbackTrigger,
    }))).toEqual([
      { modelRung: 0, requestResult: "fallback_triggered", fallbackTrigger: null },
      { modelRung: 1, requestResult: "fallback_success", fallbackTrigger: "service_unavailable" },
    ]);
    expect(JSON.stringify(metrics)).not.toContain("provider payload must not be logged");
    expect(JSON.stringify(metrics)).not.toContain("sensitive prompt");
    expect(JSON.stringify(metrics)).not.toContain("Sensitive Cheddar row");
    expect(JSON.stringify(metrics)).not.toContain("recovered");
  });

  it("advances to a fallback after the primary exhausts 429 retries", async () => {
    vi.useFakeTimers();
    const metrics: GeminiRequestMetrics[] = [];
    setGeminiMetricsObserver((sample) => metrics.push(sample));
    generateContent
      .mockRejectedValueOnce(transient(429))
      .mockRejectedValueOnce(transient(429))
      .mockResolvedValueOnce({ text: "recovered" });

    const request = openai.chat.completions.create(params);
    const settled = expect(request).resolves.toMatchObject({
      choices: [{ message: { content: "recovered" } }],
      model: "gemini-3.5-flash",
    });
    await vi.advanceTimersByTimeAsync(250);
    await settled;

    expect(generateContent.mock.calls.map(([request]) => request.model)).toEqual([
      "gemini-test",
      "gemini-test",
      "gemini-3.5-flash",
    ]);
    expect(metrics.map(({ modelRung, requestResult, fallbackTrigger }) => ({
      modelRung,
      requestResult,
      fallbackTrigger,
    }))).toEqual([
      { modelRung: 0, requestResult: "fallback_triggered", fallbackTrigger: null },
      { modelRung: 1, requestResult: "fallback_success", fallbackTrigger: "rate_limited" },
    ]);
  });

  it("advances for a retired-model 404 but not an unrelated 404", async () => {
    const metrics: GeminiRequestMetrics[] = [];
    setGeminiMetricsObserver((sample) => metrics.push(sample));
    generateContent
      .mockRejectedValueOnce(transient(404, undefined, "Model gemini-test is no longer available"))
      .mockResolvedValueOnce({ text: "recovered" });

    await expect(openai.chat.completions.create(params)).resolves.toMatchObject({
      choices: [{ message: { content: "recovered" } }],
      model: "gemini-3.5-flash",
    });
    expect(generateContent.mock.calls.map(([request]) => request.model)).toEqual([
      "gemini-test",
      "gemini-3.5-flash",
    ]);
    expect(metrics.map(({ modelRung, requestResult, fallbackTrigger }) => ({
      modelRung,
      requestResult,
      fallbackTrigger,
    }))).toEqual([
      { modelRung: 0, requestResult: "fallback_triggered", fallbackTrigger: null },
      { modelRung: 1, requestResult: "fallback_success", fallbackTrigger: "retired_model" },
    ]);

    resetGeminiResilienceForTests();
    generateContent.mockReset();
    generateContent.mockRejectedValue(transient(404, undefined, "Endpoint not found"));
    await expect(openai.chat.completions.create(params))
      .rejects.toBeInstanceOf(GeminiProviderUnavailableError);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("advances only for an HTTP 400 naming the selected unavailable model", async () => {
    const metrics: GeminiRequestMetrics[] = [];
    setGeminiMetricsObserver((sample) => metrics.push(sample));
    generateContent
      .mockRejectedValueOnce(transient(
        400,
        undefined,
        "Model gemini-test is not available for generateContent",
      ))
      .mockResolvedValueOnce({ text: "recovered" });

    await expect(openai.chat.completions.create(params)).resolves.toMatchObject({
      choices: [{ message: { content: "recovered" } }],
      model: "gemini-3.5-flash",
    });
    expect(generateContent.mock.calls.map(([request]) => request.model)).toEqual([
      "gemini-test",
      "gemini-3.5-flash",
    ]);
    expect(metrics.map(({ modelRung, requestResult, fallbackTrigger }) => ({
      modelRung,
      requestResult,
      fallbackTrigger,
    }))).toEqual([
      { modelRung: 0, requestResult: "fallback_triggered", fallbackTrigger: null },
      { modelRung: 1, requestResult: "fallback_success", fallbackTrigger: "retired_model" },
    ]);

    resetGeminiResilienceForTests();
    generateContent.mockReset();
    generateContent.mockRejectedValue(transient(
      400,
      undefined,
      "Model gemini-other is not available for generateContent",
    ));
    await expect(openai.chat.completions.create(params))
      .rejects.toBeInstanceOf(GeminiProviderUnavailableError);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("advances to a fallback after an empty successful response", async () => {
    const metrics: GeminiRequestMetrics[] = [];
    setGeminiMetricsObserver((sample) => metrics.push(sample));
    generateContent
      .mockResolvedValueOnce({ text: "  " })
      .mockResolvedValueOnce({ text: "recovered" });

    await expect(openai.chat.completions.create(params)).resolves.toEqual({
      choices: [{ message: { content: "recovered" } }],
      model: "gemini-3.5-flash",
    });
    expect(generateContent.mock.calls.map(([request]) => request.model)).toEqual([
      "gemini-test",
      "gemini-3.5-flash",
    ]);
    expect(metrics.map(({ modelRung, requestResult, fallbackTrigger }) => ({
      modelRung,
      requestResult,
      fallbackTrigger,
    }))).toEqual([
      { modelRung: 0, requestResult: "fallback_triggered", fallbackTrigger: null },
      { modelRung: 1, requestResult: "fallback_success", fallbackTrigger: "empty_response" },
    ]);
    expect(JSON.stringify(metrics)).not.toContain("recovered");
  });

  it("reports an exhausted fallback ladder using only bounded rung and trigger labels", async () => {
    vi.useFakeTimers();
    const metrics: GeminiRequestMetrics[] = [];
    setGeminiMetricsObserver((sample) => metrics.push(sample));
    generateContent.mockRejectedValue(transient(
      503,
      undefined,
      "provider response must not be logged",
    ));

    const request = openai.chat.completions.create(params);
    const rejected = expect(request).rejects.toBeInstanceOf(GeminiProviderUnavailableError);
    await vi.advanceTimersByTimeAsync(750);
    await rejected;

    expect(metrics.map(({ modelRung, requestResult, fallbackTrigger, outcome }) => ({
      modelRung,
      requestResult,
      fallbackTrigger,
      outcome,
    }))).toEqual([
      {
        modelRung: 0,
        requestResult: "fallback_triggered",
        fallbackTrigger: null,
        outcome: "provider_error",
      },
      {
        modelRung: 1,
        requestResult: "fallback_triggered",
        fallbackTrigger: "service_unavailable",
        outcome: "provider_error",
      },
      {
        modelRung: 2,
        requestResult: "fallback_exhausted",
        fallbackTrigger: "service_unavailable",
        outcome: "provider_error",
      },
    ]);
    const serializedMetrics = JSON.stringify(metrics);
    expect(serializedMetrics).not.toContain("sensitive prompt");
    expect(serializedMetrics).not.toContain("provider response must not be logged");
    expect(serializedMetrics).not.toContain("gemini-test");
  });

  it("does not advance the model chain after a safety block or deterministic 4xx", async () => {
    generateContent.mockResolvedValueOnce({
      text: "",
      candidates: [{ finishReason: "SAFETY" }],
    });

    await expect(openai.chat.completions.create(params)).resolves.toEqual({
      choices: [{ message: { content: null } }],
    });
    expect(generateContent).toHaveBeenCalledTimes(1);

    resetGeminiResilienceForTests();
    generateContent.mockReset();
    generateContent.mockRejectedValue(transient(400));
    await expect(openai.chat.completions.create(params))
      .rejects.toBeInstanceOf(GeminiProviderUnavailableError);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("does not advance the model chain after caller cancellation", async () => {
    const controller = new AbortController();
    generateContent.mockImplementation(() => {
      controller.abort();
      return Promise.reject(transient(503));
    });

    await expect(
      openai.chat.completions.create(params, { signal: controller.signal }),
    ).rejects.toThrow(/cancelled/);
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(generateContent.mock.calls[0]?.[0].model).toBe("gemini-test");
  });

  it("falls back on stream setup failure but never after a chunk is emitted", async () => {
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
    await vi.advanceTimersByTimeAsync(250);
    const stream = await request;
    const iterator = stream[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { choices: [{ delta: { content: "first" } }] },
    });
    expect(generateContentStream.mock.calls.map(([request]) => request.model)).toEqual([
      "gemini-test",
      "gemini-test",
      "gemini-3.5-flash",
    ]);
  });

  it("falls back on a pre-output stream failure", async () => {
    const metrics: GeminiRequestMetrics[] = [];
    setGeminiMetricsObserver((sample) => metrics.push(sample));
    generateContentStream
      .mockResolvedValueOnce({
        async *[Symbol.asyncIterator]() {
          throw transient(503);
        },
      })
      .mockResolvedValueOnce({
        async *[Symbol.asyncIterator]() {
          yield { text: "recovered" };
        },
      });

    const stream = await openai.chat.completions.create({ ...params, stream: true });
    const iterator = stream[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { choices: [{ delta: { content: "recovered" } }] },
    });
    await expect(iterator.next()).resolves.toMatchObject({ done: true });
    expect(generateContentStream.mock.calls.map(([request]) => request.model)).toEqual([
      "gemini-test",
      "gemini-3.5-flash",
    ]);
    expect(metrics.map(({ modelRung, requestResult, fallbackTrigger }) => ({
      modelRung,
      requestResult,
      fallbackTrigger,
    }))).toEqual([
      { modelRung: 0, requestResult: "fallback_triggered", fallbackTrigger: null },
      { modelRung: 1, requestResult: "fallback_success", fallbackTrigger: "service_unavailable" },
    ]);
    expect(JSON.stringify(metrics)).not.toContain("sensitive prompt");
    expect(JSON.stringify(metrics)).not.toContain("recovered");
  });

  it("opens after repeated transient failures and permits only one half-open probe", async () => {
    vi.useFakeTimers();
    generateContent.mockRejectedValue(transient());

    for (let call = 0; call < 3; call += 1) {
      const request = openai.chat.completions.create(params);
      const rejected = expect(request).rejects.toBeInstanceOf(GeminiProviderUnavailableError);
      await vi.advanceTimersByTimeAsync(750);
      await rejected;
    }
    await expect(openai.chat.completions.create(params))
      .rejects.toBeInstanceOf(GeminiProviderUnavailableError);
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
