---
name: Retained AI cache boundary
description: Why deterministic matches must stay outside model-result caches.
---

Retained matching caches store only model-owned suggestions for unresolved
candidates. Deterministic matches are recomputed and merged for every request.

**Why:** The reduced model prompt and cache fingerprint need not include candidates
already resolved deterministically. Caching those request-local matches under that
fingerprint can replay a different request's deterministic choices.

**How to apply:** When adding a deterministic-first resolver, reduce before the
model call, cache only sanitized unresolved suggestions, then merge the freshly
computed deterministic result after the cache lookup.