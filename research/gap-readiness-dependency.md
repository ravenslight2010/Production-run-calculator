## Key Facts

- Kubernetes readiness is a traffic-eligibility mechanism: a failed readiness probe keeps the container running but removes its endpoint from Service traffic. Liveness is separate and is intended to restart a stuck/unrecoverable process, not to represent an optional dependency outage. Source: Kubernetes official documentation, saved at `research/sources/gapfill-kubernetes-readiness-01.md`.
- Kubernetes explicitly permits readiness checks to include required backend services, but the documentation does not say that every external dependency belongs in readiness. The dependency must be required for the pod to fulfill the requests it is expected to serve.
- AWS Well-Architected distinguishes dependencies by business impact: hard dependencies are required for the workload’s function; soft dependencies can be unavailable for some period or can be compensated for. AWS recommends graceful degradation so core business value continues when a dependency is unhealthy. Source: AWS official guidance, saved at `research/sources/gapfill-aws-graceful-degradation-02.md`.
- Therefore, an unavailable external AI provider should remove the whole service from traffic only when the service’s contracted/core requests cannot be fulfilled safely without AI. If AI supports optional extraction, enrichment, recommendations, or other bounded capabilities while sync and core operations remain safe, readiness should expose AI as degraded rather than making the whole service unavailable.
- Google SRE guidance supports dependency-aware SLOs and graceful/partial responses; the captured official search evidence is saved at `research/sources/gapfill-authoritative-snippets.md`.
- Google’s Gemini documentation treats 429/5xx/timeouts as provider-call failure modes requiring bounded retry/backoff or quota action, not as a reason to restart the host process or automatically remove unrelated application traffic. Captured official provider evidence is saved at `research/sources/gapfill-authoritative-snippets.md`.
- Microsoft’s official circuit-breaker guidance says repeated calls to a failing dependency should fail fast after a threshold and later use half-open probes. A circuit breaker belongs around provider calls, not in liveness; it can support a degraded AI capability while core service traffic remains available. Captured evidence is saved at `research/sources/gapfill-authoritative-snippets.md`.

## Conflicts

- Kubernetes says readiness may check required backends, while AWS emphasizes converting applicable hard dependencies into soft dependencies. These are not contradictory: readiness should reflect the request contract and business-critical dependency set, not every integration configured in the process.
- A stricter policy may be justified for an AI-dependent import endpoint, but that does not establish that sync, floor execution, or health traffic should be removed from service globally.
- Provider retry behavior is not uniform across all SDKs and failure classes. Transient 429/5xx/timeouts can be retried with limits; quota, billing, authentication, or invalid-request failures should not be treated as transient readiness failures.

## Claim Impact

- **High-confidence correction:** The current application’s readiness check should not treat “any AI key exists” as equivalent to “the whole service is ready.” It should use the actual active provider configuration and distinguish core readiness from AI capability health.
- **High-confidence design rule:** Keep liveness independent of AI. Keep readiness failing for dependencies required to serve core operational traffic, such as database/startup invariants. Represent optional AI outage as a named degraded capability unless product owners explicitly define AI-backed workflows as a release-critical contract.
- **High-confidence resilience rule:** Add bounded provider timeouts/retries and a circuit breaker around retained AI routes. Do not restart the process or flap global readiness for each provider 429/5xx.
- **Needs-human policy decision:** Decide whether AI-assisted import/extraction is mandatory for a shift or merely an optional capability. That decision determines whether AI belongs in global readiness or a separate AI-specific readiness/diagnostic endpoint.

## Sources

1. Kubernetes, “Liveness, Readiness, and Startup Probes,” official Kubernetes documentation, accessed 2026-09-19, Tier 1. URL: https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/ — saved at `research/sources/gapfill-kubernetes-readiness-01.md`.
2. AWS Well-Architected, “Implement graceful degradation to transform applicable hard dependencies into soft dependencies,” official AWS guidance, accessed 2026-09-19, Tier 1. URL: https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_mitigate_interaction_failure_graceful_degradation.html — saved at `research/sources/gapfill-aws-graceful-degradation-02.md`.
3. Google Cloud, “Defining SLOs for services with dependencies,” official Google SRE guidance, publication date not established, accessed 2026-09-19, Tier 1. URL: https://cloud.google.com/blog/products/devops-sre/defining-slos-for-services-with-dependencies-cre-life-lessons — search evidence saved at `research/sources/gapfill-authoritative-snippets.md`.
4. Google AI for Developers, “Troubleshooting guide | Gemini API,” official provider documentation, accessed 2026-09-19, Tier 1. URL: https://ai.google.dev/gemini-api/docs/troubleshooting — search evidence saved at `research/sources/gapfill-authoritative-snippets.md`.
5. Google AI for Developers, “API errors,” official provider documentation, accessed 2026-09-19, Tier 1. URL: https://ai.google.dev/gemini-api/docs/api-errors — search evidence saved at `research/sources/gapfill-authoritative-snippets.md`.
6. Microsoft Azure Architecture Center, “Circuit Breaker pattern,” official Microsoft guidance, accessed 2026-09-19, Tier 1. URL: https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker — search evidence saved at `research/sources/gapfill-authoritative-snippets.md`.

No code or documentation files were edited.