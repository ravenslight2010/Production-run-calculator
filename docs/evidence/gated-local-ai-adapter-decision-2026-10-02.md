# Gated local AI adapter decision — no-go

**Decision date:** 2026-10-02  
**Code revision reviewed before this decision:** `517de1e49f677f9b3186b525dbe98ac5cdb6bd03`  
**Benchmark evidence:** [Local spec-import benchmark blocker](local-spec-import-benchmark-blocker-2026-10-02.md)  
**Privacy:** Metadata only. No workbook contents, prompts, credentials, or provider responses are included.

## Decision

Do not add local or hybrid provider routing. The Phase-0 result is inconclusive: there are zero independently verified spec-import gold cases, no approved local endpoint or model identity, and no Gemini/local comparison measurements. This is not evidence that Gemini is more accurate.

The current adapter remains Gemini-only. Setting `LOCAL_AI_BASE_URL` does not select or configure a provider, and readiness does not report AI as configured from that URL alone. No local request path or `AI_PROVIDER` mode is supported.

## Route eligibility

No route is eligible for local promotion on the available evidence.

The Phase-0 design identifies `/ai/parse-spec-sheet` as the primary text-only evaluation candidate and `/ai/match-import` and `/ai/match-premix` as optional cheap-tier smoke candidates. These are candidates for a future controlled benchmark, not approved local routes. Vision paths, including `/ai/parse-spec-images` and inventory photo extraction, remain on Gemini; no vision comparison was run. Other model-backed paths remain on Gemini unless separately evaluated.

## Resource and accounting decision

There are no local requests to meter or charge. Existing Gemini requests continue to use the existing server-side AI cost limits and adapter telemetry. Local GPU capacity accounting is therefore not applicable to this no-go. Any future local provider proposal must define concurrency/resource limits and its relationship to request-cost limits before routing is enabled; Gemini token metrics must not be treated as local resource measurements.

## Adapter review and scoped change

The uploaded replacement client is not adopted. It silently selected local inference from URL presence, broadly classified arbitrary `Error` values as fallback-eligible, did not bound all request lifetimes consistently, and counted stream creation as success before stream consumption. The current implementation keeps its Gemini-only routing, timeout, cancellation, selective retry, circuit, and export contracts.

This task corrects the existing Gemini stream lifecycle telemetry: metrics and circuit success are recorded only after complete stream consumption; mid-stream failures are propagated and recorded as failures without retrying a partially delivered response. The timeout/cancellation signal remains active while the returned stream is consumed.

## Verification

The adapter tests cover the OpenAI-compatible response contract, Gemini timeout/cancellation, selective retry, circuit behavior, and safe metrics. Added checks assert that a proposed local URL alone does not change runtime routing or readiness, and that a mid-stream provider error is not measured as success.

Reconsider local routing only after an access-controlled, independently verified gold set and an approved local endpoint/model support the same frozen Gemini-vs-local comparison described in the linked blocker report.

## Evaluation-only model approval update — 2026-10-07

The project owner accepted Ollama with Qwen3 8B instruct (`qwen3:8b`) as the local evaluation candidate. This is not approval to add local routing. Use only a loopback endpoint on a dedicated evaluator-controlled host, with one concurrent request, at most 32,768 context tokens, a 120-second request deadline, verified host resource limits, restricted evaluator access, and no raw prompt/response retention or payload logging. Customer/source material remains prohibited until separately authorized and reviewed.

No endpoint host/service, model digest, or actual resource enforcement is verified in this evidence. Pin and record the model digest and actual endpoint operator/host before any request; complete the source-backed case review and obtain separate Phase-0 run authorization. The Gemini-only adapter and production routing remain unchanged.