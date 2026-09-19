## Repository Findings

**Revision reviewed:** `b0f9d281ece0002fc0ad9543edb8dbdac84ceeb4`.

- `/livez` is intentionally independent of database, AI configuration, startup state, and background workers; it returns 200 whenever the Node process can answer (`artifacts/api-server/src/routes/health.ts:119-123`).
- `/readyz`, `/healthz`, and `/` are the readiness contract. After startup reaches `ready`, they check `SELECT 1`, AI configuration, and sustained background-worker diagnostics. Any non-`ok` check returns 503 (`health.ts:17-115`).
- Startup itself gates all non-health routes until database initialization, role seeding, and data heals complete. AI is not part of startup initialization (`startupGate.ts:4-29`; `index.ts:99-173`).
- Existing tests prove bounded startup 503 behavior, independent liveness, background-worker 503/recovery, and non-secret diagnostics. They do not prove a live production 503-to-200 sequence; the assigned task for that evidence already exists and is intentionally not duplicated (`health.test.ts:118-146,149-209`).
- The readiness AI check is broader than the actual adapter contract in one direction and narrower in another: it accepts `AI_INTEGRATIONS_GEMINI_API_KEY` or `OPENAI_API_KEY` (`health.ts:48-53`), while the adapter actually supports Replit Gemini credentials or direct `GOOGLE_API_KEY` and throws when neither Gemini key is present (`lib/integrations-openai-ai-server/src/client.ts:46-74`). Thus a direct `GOOGLE_API_KEY` deployment can be marked degraded despite having a usable configured provider, while an `OPENAI_API_KEY` alone can be marked ready even though this adapter does not use it. This is a concrete readiness/configuration mismatch, not merely policy.
- The AI audit says retained extraction and unresolved-name workflows use AI, while recap, anomaly detection, schedule ordering, reconciliation, and most floor/sync operations have deterministic behavior or fallbacks (`docs/ai-feature-value-audit-2026-09-05.md:19-29,127-145`). The sync and core operational routes therefore do not appear to require AI for their basic serving path.

## External Evidence

1. **Kubernetes official probe documentation — Tier 1, official platform docs**
   - Startup probes delay liveness/readiness until initialization succeeds; readiness controls traffic eligibility; liveness is for unrecoverable application failure and should be configured carefully.
   - Saved evidence: `research/sources/ai-readiness-01-kubernetes-probes.md`
   - URL: https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/

2. **AWS Well-Architected graceful degradation — Tier 1, official cloud guidance**
   - Components should continue core functions when applicable dependencies are unavailable, using alternate/stale/default behavior where safe. AWS explicitly lists circuit breakers, retries, caching, and defaults as patterns, while distinguishing hard and soft dependencies.
   - Saved evidence: `research/sources/ai-readiness-02-aws-graceful-degradation.md`
   - URL: https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_mitigate_interaction_failure_graceful_degradation.html

3. **Microsoft Azure Architecture Center circuit breaker — Tier 1, official cloud architecture guidance**
   - Circuit breakers stop repeated calls after a threshold, fail fast to prevent cascading exhaustion, and use half-open probes to test recovery before closing.
   - Saved evidence: `research/sources/ai-readiness-04-microsoft-circuit-breaker.md`
   - URL: https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker

4. **OpenAI API error-code guidance — Tier 1, provider documentation**
   - Retry transient 500/503 failures with backoff; honor `Retry-After`; do not retry quota/billing failures as if they were transient. This supports isolating provider retries from service readiness.
   - Saved evidence: `research/sources/ai-readiness-05-openai-errors.md`
   - URL: https://platform.openai.com/docs/guides/error-codes

5. **Google SRE service-level-objectives chapter — Tier 1, Google technical guidance**
   - Service health promises should match user expectations; over-promising availability creates operational problems. Readiness semantics should therefore reflect the core service’s user-visible contract, not every optional enrichment dependency.
   - Saved evidence: `research/sources/ai-readiness-06-google-sre-slos.md`
   - URL: https://sre.google/sre-book/service-level-objectives/

6. Google Cloud dependency-SLO article was searched but rejected by the fetcher; its search snippet supported dependency-aware SLOs but was not used as decisive evidence. Saved-source requirements were met without it.

## Reproduction or Measurement Design

### A. Provider configuration matrix

Run an isolated, sanitized readiness matrix with no application payloads:

| Configuration | Expected current result | Desired semantic result |
|---|---:|---:|
| `GOOGLE_API_KEY` only | Current code likely 503 | 200 if direct Gemini is supported/usable, otherwise explicit configuration failure |
| `AI_INTEGRATIONS_GEMINI_API_KEY` + base URL | 200 by current check | 200 if provider is reachable when invoked |
| `OPENAI_API_KEY` only | Current code reports 200 | Should be 200 only if an OpenAI adapter is actually active; otherwise 503 or remove this check |
| No AI key | 503 | Policy decision: 200 degraded if AI is optional, 503 only if retained AI workflows are part of the service’s required contract |

Record only status, check names, sanitized error code, timestamp, revision, and correlation ID. Do not record keys or provider payloads.

### B. Core-vs-AI dependency exercise

With AI unavailable or deliberately denied, verify that authenticated core operations still work: health/liveness, sync read/write, SSE connection/recovery, run lifecycle, deterministic summaries, and inventory paths that do not invoke AI. Separately verify retained AI routes fail boundedly with an explicit unavailable/degraded contract. This distinguishes a soft dependency outage from a core service outage.

### C. Readiness transition exercise

Using the already-planned readiness evidence task, capture a sanitized 503-to-200 sequence for: startup incomplete, database unavailable, background-worker sustained failure, provider unconfigured, and recovery. Include environment, revision, timestamps, endpoint/status/check summary, and no body payloads. The current tests cover local state transitions but not deployed evidence.

### D. Provider failure behavior

For each retained AI route, use a test double or provider fault injection to measure timeout, 429, 500/503, malformed response, and quota failure. Verify bounded retry/backoff, deterministic fallback where available, no readiness flapping, no request-body logging, and no protected core mutation on AI failure.

## Claim Assessments

- **“Liveness is independent of optional AI and database.” — verified, high confidence.** Direct implementation and tests support this exact scope.
- **“Readiness currently fails when neither configured AI key exists.” — verified, high confidence.** Direct implementation and existing server research agree.
- **“AI is required for core floor/sync service availability.” — unsupported, medium-high confidence.** Repository architecture and AI audit show deterministic/core paths and separate AI routes; a full route-by-route outage exercise would raise confidence.
- **“The current readiness AI check accurately represents the configured provider.” — contradicted, high confidence.** `health.ts` checks `OPENAI_API_KEY` but the adapter reads `GOOGLE_API_KEY`/Replit Gemini credentials; direct-Gemini-only and OpenAI-only cases are mismatched.
- **“Optional AI should make readiness 503.” — needs-human, high confidence.** Technical evidence favors soft-dependency degradation for core operations, but product/operations owners must decide whether retained import workflows define service readiness.
- **“A provider outage should restart or remove the whole service.” — contradicted, high confidence.** Kubernetes guidance separates liveness from readiness, and AWS/Microsoft guidance favors graceful degradation/circuit breaking for soft dependencies.
- **“Current tests prove deployed readiness recovery.” — partially verified, high confidence.** They prove local state transitions and bounded responses; they do not prove deployed proxy/platform behavior or a real incident recovery.
- **“AI failures are already fully isolated from all application behavior.” — partially verified, medium confidence.** Route separation and fallbacks are strong, but the readiness mismatch and unverified retained-route timeout/failure matrix prevent a universal claim.

## Recommendations

1. **Correct the provider identity check before making readiness policy decisions.** Derive the readiness dependency check from the same provider configuration used by the adapter. At minimum, support `GOOGLE_API_KEY` and stop treating `OPENAI_API_KEY` as evidence unless an active OpenAI path exists.
2. **Separate `core readiness` from `AI capability health`.** Keep `/livez` independent. Make readiness reflect dependencies required to serve core authenticated operations; expose AI as a named degraded dependency/capability. If product policy requires AI-backed imports to block deployments, use a separate AI-specific readiness/diagnostic signal rather than making sync/floor availability appear down.
3. **Preserve explicit 503 for database, incomplete startup, and sustained background-worker failures.** These are currently demonstrated core dependencies and can justify removing a process from traffic.
4. **Add circuit-breaker/backoff behavior around retained provider calls, not around process liveness.** Provider 429/5xx/timeouts should fail boundedly and allow deterministic/manual workflows to continue.
5. **Use the existing Task #2391 for deployed 503-to-200 evidence.** Do not create duplicate readiness-proof work. Its evidence should include the provider-configuration matrix and revision/environment metadata.
6. **Document the policy boundary:** “AI unavailable” should mean “AI-assisted features unavailable/degraded,” while “service not ready” should mean core operational writes/reads cannot safely serve traffic—unless owners explicitly choose a stricter import-dependent release policy.

## Gaps

- No production route-failure traces, provider outage records, or live authenticated outage exercise were inspected; no production payloads were retained.
- Deployment metadata was not part of this focused assignment; the repository report should keep platform/deployment findings separate from this readiness policy report.
- The exact active provider in each published environment is not established from repository code alone.
- The AI route inventory contains both retained and disable-first capabilities; a current product owner must identify which AI workflows, if any, are contractual blockers for a shift.
- Existing health tests use `OPENAI_API_KEY` as a generic configured fixture; this masks the provider-name mismatch and should not be interpreted as proving provider compatibility.

## Sources

1. Kubernetes, “Liveness, Readiness, and Startup Probes,” official documentation, saved at `research/sources/ai-readiness-01-kubernetes-probes.md`, https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/ — Tier 1.
2. AWS Well-Architected Framework, “Implement graceful degradation to transform applicable hard dependencies into soft dependencies,” saved at `research/sources/ai-readiness-02-aws-graceful-degradation.md`, https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_mitigate_interaction_failure_graceful_degradation.html — Tier 1.
3. Microsoft Azure Architecture Center, “Circuit Breaker pattern,” saved at `research/sources/ai-readiness-04-microsoft-circuit-breaker.md`, https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker — Tier 1.
4. OpenAI Platform, “Error codes,” saved at `research/sources/ai-readiness-05-openai-errors.md`, https://platform.openai.com/docs/guides/error-codes — Tier 1.
5. Google SRE Book, “Service Level Objectives,” saved at `research/sources/ai-readiness-06-google-sre-slos.md`, https://sre.google/sre-book/service-level-objectives/ — Tier 1.
6. Google Cloud, “Defining SLOs for services with dependencies,” searched at https://cloud.google.com/blog/products/devops-sre/defining-slos-for-services-with-dependencies-cre-life-lessons but fetch rejected; treated as corroborating lead only, not decisive evidence.
