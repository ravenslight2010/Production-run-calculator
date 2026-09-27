# Gap-fill authoritative search evidence

Captured 2026-09-19 from webSearch result snippets; no credentials, production URLs, payloads, or personal data retained.

## Google SRE dependency SLOs
- Title: Defining SLOs for services with dependencies
- URL: https://cloud.google.com/blog/products/devops-sre/defining-slos-for-services-with-dependencies-cre-life-lessons
- Tier: 1, Google Cloud/SRE guidance
- Snippet: Discusses defining SLOs for services with dependencies and using graceful degradation/partial responses where appropriate.

## Google SRE launch checklist
- Title: Google checklist: SRE pre launch checklist
- URL: https://sre.google/sre-book/launch-checklist
- Tier: 1, Google SRE guidance
- Snippet: Includes external dependencies as a launch-readiness concern.

## Gemini API troubleshooting
- Title: Troubleshooting guide | Gemini API | Google AI for Developers
- URL: https://ai.google.dev/gemini-api/docs/troubleshooting
- Tier: 1, official provider documentation
- Snippet: Official client SDKs include automatic retry with exponential backoff for transient timeouts, network issues, rate limits (429), and 5xx responses.

## Gemini API errors
- Title: API errors - Interactions API | Google AI for Developers
- URL: https://ai.google.dev/gemini-api/docs/api-errors
- Tier: 1, official provider documentation
- Snippet: 429 rate-limit/quota errors require waiting/retrying or quota action; transient errors must be distinguished from quota exhaustion.

## Azure circuit breaker
- Title: Circuit Breaker pattern | Microsoft Azure Architecture Center
- URL: https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker
- Tier: 1, official cloud architecture guidance
- Snippet: Circuit breakers prevent repeated calls to a failing dependency, fail fast, and use half-open probes to test recovery.
