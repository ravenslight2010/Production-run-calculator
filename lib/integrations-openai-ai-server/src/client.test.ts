import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  constructor: vi.fn(),
  generateContent: vi.fn(),
  generateContentStream: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = {
      generateContent: sdk.generateContent,
      generateContentStream: sdk.generateContentStream,
    };

    constructor(options: unknown) {
      sdk.constructor(options);
    }
  },
  ThinkingLevel: { LOW: "LOW" },
}));

import {
  GeminiProviderUnavailableError,
  openai,
  resetGeminiResilienceForTests,
  setGeminiMetricsObserver,
  type GeminiRequestMetrics,
} from "./client.js";

const baseParams = {
  model: "fixture-model",
  messages: [{ role: "user" as const, content: "Hello" }],
};

function failingStreamBeforeOutput(error: Error) {
  return (async function* () {
    throw error;
  })();
}

function transientProviderError(): Error & {
  status: number;
  response: { headers: { get: (name: string) => string | null } };
} {
  return Object.assign(new Error("provider unavailable"), {
    status: 503,
    response: {
      headers: {
        get: (name: string) => name === "retry-after" ? "0" : null,
      },
    },
  });
}

describe("Gemini-backed chat completions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("AI_INTEGRATIONS_GEMINI_API_KEY", "test-only-placeholder");
    resetGeminiResilienceForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("maps chat roles and JSON response options to a non-streaming Gemini request", async () => {
    sdk.generateContent.mockResolvedValueOnce({ text: '{"answer":"42"}' });

    const response = await openai.chat.completions.create({
      model: "fixture-model",
      messages: [
        { role: "system", content: "Answer in JSON." },
        { role: "system", content: "Keep it concise." },
        { role: "user", content: "What is the answer?" },
        { role: "assistant", content: "I will calculate it." },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 80,
    });

    expect(response).toEqual({
      choices: [{ message: { content: '{"answer":"42"}' } }],
    });
    expect(sdk.generateContent).toHaveBeenCalledTimes(1);
    expect(sdk.generateContent.mock.calls[0]?.[0]).toMatchObject({
      model: "fixture-model",
      contents: [
        { role: "user", parts: [{ text: "What is the answer?" }] },
        { role: "model", parts: [{ text: "I will calculate it." }] },
      ],
      config: {
        systemInstruction: "Answer in JSON.\n\nKeep it concise.",
        responseMimeType: "application/json",
        maxOutputTokens: 80,
      },
    });
  });

  it("converts data-URI image parts to Gemini inline image data", async () => {
    sdk.generateContent.mockResolvedValueOnce({ text: "Product label" });

    await openai.chat.completions.create({
      model: "fixture-model",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Read this label." },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,aGVsbG8=" },
          },
        ],
      }],
    });

    expect(sdk.generateContent.mock.calls[0]?.[0]).toMatchObject({
      contents: [{
        role: "user",
        parts: [
          { text: "Read this label." },
          { inlineData: { mimeType: "image/png", data: "aGVsbG8=" } },
        ],
      }],
    });
  });

  it("returns a null response for safety-blocked provider output", async () => {
    sdk.generateContent.mockResolvedValueOnce({
      text: "blocked text",
      candidates: [{ finishReason: "SAFETY" }],
    });

    const response = await openai.chat.completions.create(baseParams);

    expect(response).toEqual({
      choices: [{ message: { content: null } }],
    });
    expect(sdk.generateContent).toHaveBeenCalledTimes(1);
  });

  it("tries the configured fallback after an empty primary response", async () => {
    sdk.generateContent
      .mockResolvedValueOnce({ text: "  " })
      .mockResolvedValueOnce({ text: "Recovered answer" });

    const response = await openai.chat.completions.create(baseParams);

    expect(response).toEqual({
      choices: [{ message: { content: "Recovered answer" } }],
      model: "gemini-3.5-flash",
    });
    expect(sdk.generateContent.mock.calls.map(([request]) => request.model)).toEqual([
      "fixture-model",
      "gemini-3.5-flash",
    ]);
  });

  it("retries a transient provider failure once before returning a recovered response", async () => {
    const metrics: GeminiRequestMetrics[] = [];
    setGeminiMetricsObserver((sample) => metrics.push(sample));
    sdk.generateContent
      .mockRejectedValueOnce(transientProviderError())
      .mockResolvedValueOnce({ text: "Recovered answer" });

    const response = await openai.chat.completions.create(baseParams);

    expect(response).toEqual({
      choices: [{ message: { content: "Recovered answer" } }],
    });
    expect(sdk.generateContent).toHaveBeenCalledTimes(2);
    expect(sdk.generateContent.mock.calls.map(([request]) => request.model)).toEqual([
      "fixture-model",
      "fixture-model",
    ]);
    expect(metrics.map(({ modelRung, requestResult, fallbackTrigger, retryCount, outcome }) => ({
      modelRung,
      requestResult,
      fallbackTrigger,
      retryCount,
      outcome,
    }))).toEqual([{
      modelRung: 0,
      requestResult: "primary_success",
      fallbackTrigger: null,
      retryCount: 1,
      outcome: "success",
    }]);
  });

  it("reports a retried primary followed by fallback recovery against the SDK calls", async () => {
    const metrics: GeminiRequestMetrics[] = [];
    setGeminiMetricsObserver((sample) => metrics.push(sample));
    sdk.generateContent
      .mockRejectedValueOnce(transientProviderError())
      .mockRejectedValueOnce(transientProviderError())
      .mockResolvedValueOnce({ text: "Recovered from fallback" });

    const response = await openai.chat.completions.create(baseParams);

    expect(response).toEqual({
      choices: [{ message: { content: "Recovered from fallback" } }],
      model: "gemini-3.5-flash",
    });
    expect(sdk.generateContent.mock.calls.map(([request]) => request.model)).toEqual([
      "fixture-model",
      "fixture-model",
      "gemini-3.5-flash",
    ]);
    expect(metrics.map(({ modelRung, requestResult, fallbackTrigger, retryCount, outcome }) => ({
      modelRung,
      requestResult,
      fallbackTrigger,
      retryCount,
      outcome,
    }))).toEqual([
      {
        modelRung: 0,
        requestResult: "fallback_triggered",
        fallbackTrigger: null,
        retryCount: 1,
        outcome: "provider_error",
      },
      {
        modelRung: 1,
        requestResult: "fallback_success",
        fallbackTrigger: "service_unavailable",
        retryCount: 0,
        outcome: "success",
      },
    ]);
  });

  it("does not retry a transient failure after the caller cancels", async () => {
    const metrics: GeminiRequestMetrics[] = [];
    setGeminiMetricsObserver((sample) => metrics.push(sample));
    const controller = new AbortController();
    sdk.generateContent.mockImplementationOnce(async () => {
      controller.abort();
      throw transientProviderError();
    });

    await expect(
      openai.chat.completions.create(baseParams, { signal: controller.signal }),
    ).rejects.toThrow("AI provider request was cancelled");

    expect(sdk.generateContent).toHaveBeenCalledTimes(1);
    expect(metrics.map(({ modelRung, requestResult, fallbackTrigger, retryCount, outcome }) => ({
      modelRung,
      requestResult,
      fallbackTrigger,
      retryCount,
      outcome,
    }))).toEqual([{
      modelRung: 0,
      requestResult: "attempt_failed",
      fallbackTrigger: null,
      retryCount: 0,
      outcome: "cancelled",
    }]);
  });

  it("surfaces fallback exhaustion and blocks requests after repeated transient outages", async () => {
    const metrics: GeminiRequestMetrics[] = [];
    setGeminiMetricsObserver((sample) => metrics.push(sample));
    sdk.generateContent.mockRejectedValue(transientProviderError());

    for (let request = 0; request < 3; request += 1) {
      await expect(
        openai.chat.completions.create(baseParams),
      ).rejects.toBeInstanceOf(GeminiProviderUnavailableError);
    }

    const expectedModels = [
      "fixture-model",
      "gemini-3.5-flash",
      "gemini-3.1-flash-lite",
    ].flatMap((model) => [model, model]);
    expect(sdk.generateContent).toHaveBeenCalledTimes(18);
    expect(sdk.generateContent.mock.calls.map(([request]) => request.model)).toEqual([
      ...expectedModels,
      ...expectedModels,
      ...expectedModels,
    ]);
    expect(metrics.map(({ modelRung, requestResult, fallbackTrigger, retryCount, outcome }) => ({
      modelRung,
      requestResult,
      fallbackTrigger,
      retryCount,
      outcome,
    }))).toEqual(Array.from({ length: 3 }, () => [
      {
        modelRung: 0,
        requestResult: "fallback_triggered",
        fallbackTrigger: null,
        retryCount: 1,
        outcome: "provider_error",
      },
      {
        modelRung: 1,
        requestResult: "fallback_triggered",
        fallbackTrigger: "service_unavailable",
        retryCount: 1,
        outcome: "provider_error",
      },
      {
        modelRung: 2,
        requestResult: "fallback_exhausted",
        fallbackTrigger: "service_unavailable",
        retryCount: 1,
        outcome: "provider_error",
      },
    ]).flat());

    await expect(
      openai.chat.completions.create(baseParams),
    ).rejects.toBeInstanceOf(GeminiProviderUnavailableError);
    expect(sdk.generateContent).toHaveBeenCalledTimes(18);
    expect(metrics.at(-1)).toMatchObject({
      modelRung: 0,
      requestResult: "attempt_failed",
      fallbackTrigger: null,
      retryCount: 0,
      outcome: "circuit_open",
    });
    expect(metrics).toHaveLength(10);
  });

  it("maps streamed text and empty chunks to OpenAI-style deltas", async () => {
    sdk.generateContentStream.mockResolvedValueOnce((async function* () {
      yield { text: "first" };
      yield {};
      yield { text: " second" };
    })());

    const response = await openai.chat.completions.create({
      ...baseParams,
      stream: true,
    });
    const chunks: Array<{ choices: Array<{ delta: { content: string | null } }> }> = [];
    for await (const chunk of response) chunks.push(chunk);

    expect(chunks).toEqual([
      { choices: [{ delta: { content: "first" } }] },
      { choices: [{ delta: { content: null } }] },
      { choices: [{ delta: { content: " second" } }] },
    ]);
    expect(sdk.generateContentStream).toHaveBeenCalledTimes(1);
    expect(sdk.generateContent.mock.calls).toHaveLength(0);
  });

  it("tries the configured fallback when the primary stream fails before yielding output", async () => {
    const providerFailure = Object.assign(new Error("Service unavailable"), { status: 503 });
    sdk.generateContentStream
      .mockResolvedValueOnce(failingStreamBeforeOutput(providerFailure))
      .mockResolvedValueOnce((async function* () {
        yield { text: "Recovered " };
        yield { text: "answer" };
      })());

    const response = await openai.chat.completions.create({
      ...baseParams,
      stream: true,
    });
    const chunks: Array<{ choices: Array<{ delta: { content: string | null } }> }> = [];
    for await (const chunk of response) chunks.push(chunk);

    expect(sdk.generateContentStream.mock.calls.map(([request]) => request.model)).toEqual([
      "fixture-model",
      "gemini-3.5-flash",
    ]);
    expect(chunks).toEqual([
      { choices: [{ delta: { content: "Recovered " } }] },
      { choices: [{ delta: { content: "answer" } }] },
    ]);
    expect(chunks.map((chunk) => chunk.choices[0]?.delta.content).join("")).toBe("Recovered answer");
  });

  it("propagates a primary stream failure after output without switching models or replaying chunks", async () => {
    const providerFailure = Object.assign(new Error("Service unavailable"), { status: 503 });
    sdk.generateContentStream.mockResolvedValueOnce(
      failingStreamAfterOutput("Partial answer", providerFailure),
    );

    const response = await openai.chat.completions.create({
      ...baseParams,
      stream: true,
    });
    const chunks: Array<{ choices: Array<{ delta: { content: string | null } }> }> = [];

    await expect(async () => {
      for await (const chunk of response) chunks.push(chunk);
    }).rejects.toMatchObject({ name: "GeminiProviderUnavailableError" });

    expect(sdk.generateContentStream.mock.calls.map(([request]) => request.model)).toEqual([
      "fixture-model",
    ]);
    expect(chunks).toEqual([
      { choices: [{ delta: { content: "Partial answer" } }] },
    ]);
    expect(chunks.map((chunk) => chunk.choices[0]?.delta.content).join("")).toBe("Partial answer");
  });
});

function failingStreamAfterOutput(text: string, error: Error) {
  return (async function* () {
    yield { text };
    throw error;
  })();
}
