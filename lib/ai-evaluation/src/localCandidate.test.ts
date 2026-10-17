import { afterEach, describe, expect, it, vi } from "vitest";
import * as fc from "fast-check";
import {
  LOCAL_EVALUATION_ENDPOINT,
  LOCAL_EVALUATION_MODEL,
  LocalCandidateError,
  localCandidateRequestFingerprint,
  parseResolutionSuggestions,
  runLocalEvaluationCandidate,
  type LocalCandidateRequest,
} from "./localCandidate";

const base = {
  fixtureId: "synthetic:fixture-1",
  systemPrompt: "Return the validated extraction as a JSON object.",
  knowledgeQuery: "ingredient units and formula provenance",
  maxOutputTokens: 128,
} as const;

const syntheticCells = (textValue: string) => [
  {
    sheet: "Synthetic Spec",
    cell: "A1",
    textValue,
    formulaText: null,
    cachedValueText: null,
  },
  {
    sheet: "Synthetic Spec",
    cell: "B2",
    textValue: null,
    formulaText: "=1.25 * 2",
    cachedValueText: "2.50",
  },
];

function workbookRequest(sourceText: string) {
  return {
    ...base,
    route: "workbook-text" as const,
    sourceText,
    sourceCells: syntheticCells(sourceText),
  };
}

function successResponse(content = '{"items":[]}') {
  return new Response(JSON.stringify({
    model: LOCAL_EVALUATION_MODEL,
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 42, completion_tokens: 3 },
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("evaluation-only local candidate adapter", () => {
  it("uses the fixed loopback endpoint and route-scoped source-linked knowledge", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(LOCAL_EVALUATION_ENDPOINT);
      expect(init?.redirect).toBe("error");
      requestBody = JSON.parse(String(init?.body));
      return successResponse();
    });
    vi.stubGlobal("fetch", fetchMock);

    const request: LocalCandidateRequest = workbookRequest(
      "Synthetic row: Mozzarella, 1.25 oz per pizza.",
    );
    const result = await runLocalEvaluationCandidate(request);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestBody?.model).toBe(LOCAL_EVALUATION_MODEL);
    expect(requestBody?.temperature).toBe(0);
    expect(requestBody?.max_tokens).toBe(128);
    expect(requestBody?.response_format).toEqual({ type: "json_object" });
    const messages = requestBody?.messages as Array<{ role: string; content: unknown }>;
    expect(messages[0]?.role).toBe("system");
    expect(String(messages[0]?.content)).toContain("APP KNOWLEDGE VERSION");
    expect(String(messages[0]?.content)).toContain("REFERENCE DATA ONLY");
    expect(String(messages[0]?.content)).toContain("workbookSource.ts");
    expect(String(messages[0]?.content)).not.toContain("gold-evidence");
    const sourcePayload = JSON.parse(String(messages[1]?.content));
    expect(sourcePayload.sourceText).toContain("Synthetic row");
    expect(sourcePayload.sourceCells[0]).toEqual({
      sheet: "Synthetic Spec",
      cell: "A1",
      textValue: "Synthetic row: Mozzarella, 1.25 oz per pizza.",
      formulaText: null,
      cachedValueText: null,
    });
    expect(sourcePayload.sourceCells[1]).toEqual({
      sheet: "Synthetic Spec",
      cell: "B2",
      textValue: null,
      formulaText: "=1.25 * 2",
      cachedValueText: "2.50",
    });
    expect(result.model).toBe(LOCAL_EVALUATION_MODEL);
    expect(result.knowledgeSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.promptTokens).toBe(42);
    expect(result.content).toBe('{"items":[]}');
  });

  it("preserves generated decimal strings exactly with their workbook formula provenance", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 99_999 }),
        fc.integer({ min: 0, max: 9_999 }),
        fc.integer({ min: 0, max: 4 }),
        async (whole, fraction, scale) => {
          const cachedValueText = scale === 0
            ? String(whole)
            : `${whole}.${String(fraction).padStart(scale, "0").slice(0, scale)}`;
          let requestBody: Record<string, unknown> | undefined;
          vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            requestBody = JSON.parse(String(init?.body));
            return successResponse();
          }));
          await runLocalEvaluationCandidate({
            ...workbookRequest("synthetic decimal provenance"),
            sourceCells: [{
              sheet: "Synthetic Spec",
              cell: "C7",
              textValue: null,
              formulaText: "=A7/2",
              cachedValueText,
            }],
          });
          const messages = requestBody?.messages as Array<{ content: unknown }>;
          const payload = JSON.parse(String(messages[1]?.content));
          expect(payload.sourceCells[0]).toEqual({
            sheet: "Synthetic Spec",
            cell: "C7",
            textValue: null,
            formulaText: "=A7/2",
            cachedValueText,
          });
        },
      ),
      { numRuns: 24 },
    );
  });

  it("uses the separate inline-image contract and rejects remote image URLs", async () => {
    let requestBody: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return successResponse();
    }));
    const imageRequest: LocalCandidateRequest = {
      ...base,
      route: "spec-images",
      instruction: "Transcribe the synthetic table.",
      pageImages: ["data:image/png;base64,aGVsbG8="],
    };
    await runLocalEvaluationCandidate(imageRequest);
    const messages = requestBody?.messages as Array<{ content: unknown }>;
    const parts = messages[1]?.content as Array<{ type: string; image_url?: { url: string } }>;
    expect(parts[1]?.type).toBe("image_url");
    expect(parts[1]?.image_url?.url).toBe("data:image/png;base64,aGVsbG8=");

    await expect(runLocalEvaluationCandidate({
      ...imageRequest,
      pageImages: ["https://example.invalid/customer-sheet.png"],
    })).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("requires completed deterministic resolution and exposes only unresolved candidates", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.messages[1].content).toContain("Unresolved Pepperoni");
      expect(body.messages[1].content).not.toContain("Already matched Cheese");
      return successResponse(
        '{"suggestions":[{"source":"Unresolved Pepperoni","target":"Pepperoni Blend"}]}',
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const unresolved = {
      ...base,
      route: "unresolved-resolution",
      deterministicPassComplete: true,
      unresolvedCandidates: ["Unresolved Pepperoni"],
      allowedTargets: ["Pepperoni Blend"],
    } as const;
    const result = await runLocalEvaluationCandidate(unresolved);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(parseResolutionSuggestions(
      result.content,
      unresolved.unresolvedCandidates,
      unresolved.allowedTargets,
    )).toEqual([
      { source: "Unresolved Pepperoni", target: "Pepperoni Blend" },
    ]);

    await expect(runLocalEvaluationCandidate({
      ...unresolved,
      deterministicPassComplete: false,
    } as never)).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("rejects invented sources, disallowed targets, duplicate sources, and malformed JSON", () => {
    const unresolved = ["Unresolved Pepperoni"];
    const targets = ["Pepperoni Blend"];
    expect(parseResolutionSuggestions(
      '{"suggestions":[{"source":"Unresolved Pepperoni","target":"Pepperoni Blend"}]}',
      unresolved,
      targets,
    )).toEqual([{ source: unresolved[0], target: targets[0] }]);
    for (const bad of [
      '{"suggestions":[{"source":"Invented","target":"Pepperoni Blend"}]}',
      '{"suggestions":[{"source":"Unresolved Pepperoni","target":"New Target"}]}',
      '{"suggestions":[{"source":"Unresolved Pepperoni","target":"Pepperoni Blend"},{"source":"Unresolved Pepperoni","target":"Pepperoni Blend"}]}',
      '{"suggestions":[],"authorized":true}',
      "not-json",
    ]) {
      expect(() => parseResolutionSuggestions(bad, unresolved, targets))
        .toThrowError(LocalCandidateError);
    }
  });

  it("rejects non-synthetic identities and oversized budgets before contacting the endpoint", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(runLocalEvaluationCandidate({
      ...workbookRequest("private"),
      fixtureId: "production:customer-sheet",
    })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(runLocalEvaluationCandidate({
      ...workbookRequest("synthetic"),
      maxOutputTokens: 257,
    })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(runLocalEvaluationCandidate({
      ...workbookRequest("synthetic"),
      sourceCells: [],
    })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(runLocalEvaluationCandidate({
      ...workbookRequest("synthetic"),
      sourceCells: [
        ...syntheticCells("synthetic"),
        { ...syntheticCells("duplicate")[0]! },
      ],
    })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(runLocalEvaluationCandidate({
      ...workbookRequest("synthetic"),
      sourceCells: [
        { ...syntheticCells("synthetic")[0]!, cell: "XFE1" },
      ],
    })).rejects.toMatchObject({ code: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not expose provider error bodies or accept a mismatched model identity", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      "synthetic-private-error-marker",
      { status: 503 },
    )));
    await expect(runLocalEvaluationCandidate({
      ...workbookRequest("synthetic"),
    })).rejects.toMatchObject({
      code: "unavailable",
      message: "Local evaluation candidate unavailable.",
    });

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      model: "unapproved-model",
      choices: [{ message: { content: "synthetic-private-response-marker" } }],
    }), { status: 200 })));
    await expect(runLocalEvaluationCandidate({
      ...workbookRequest("synthetic"),
    })).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("classifies cancellation and serializes inference without retrying", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(runLocalEvaluationCandidate({
      ...workbookRequest("synthetic"),
      signal: controller.signal,
    })).rejects.toMatchObject({ code: "cancelled" });
    expect(fetchMock).not.toHaveBeenCalled();

    let release!: (response: Response) => void;
    const pendingResponse = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const pendingFetch = vi.fn(() => pendingResponse);
    vi.stubGlobal("fetch", pendingFetch);
    const first = runLocalEvaluationCandidate({
      ...workbookRequest("synthetic"),
    });
    await Promise.resolve();
    await expect(runLocalEvaluationCandidate({
      ...workbookRequest("second synthetic case"),
    })).rejects.toMatchObject({ code: "busy" });
    release(successResponse());
    await expect(first).resolves.toMatchObject({ model: LOCAL_EVALUATION_MODEL });
    expect(pendingFetch).toHaveBeenCalledTimes(1);
  });

  it("binds request fingerprints to synthetic input identity without retaining the input", () => {
    const first: LocalCandidateRequest = workbookRequest("synthetic source A");
    const second: LocalCandidateRequest = workbookRequest("synthetic source B");
    expect(localCandidateRequestFingerprint(first))
      .toMatch(/^[a-f0-9]{64}$/);
    expect(localCandidateRequestFingerprint(first))
      .not.toBe(localCandidateRequestFingerprint(second));
    const changedProvenance: LocalCandidateRequest = {
      ...first,
      sourceCells: [
        ...first.sourceCells,
        {
          sheet: "Synthetic Spec",
          cell: "C3",
          textValue: null,
          formulaText: "=1.25 * 3",
          cachedValueText: "3.75",
        },
      ],
    };
    expect(localCandidateRequestFingerprint(first))
      .not.toBe(localCandidateRequestFingerprint(changedProvenance));
  });
});
