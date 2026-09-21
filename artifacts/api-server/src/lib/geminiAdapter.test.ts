import { beforeEach, describe, expect, it, vi } from "vitest";

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