---
name: Gemini fallback cache identity
description: Cache and parse-version rules when a secondary Gemini model serves a request
---

# Gemini fallback cache identity

Rule: keep the configured primary model and its cache identity stable when adding availability fallbacks. Do not store a fallback-served result under a key that identifies the primary model; avoid invalidating saved parse snapshots for a fallback-only ladder change.

**Why:** fallback models can produce different content, but they are used only when the primary is unavailable or returns no usable output. Reusing the primary cache identity can preserve a fallback result as if it came from the primary, while changing the parse version invalidates unrelated saved imports.

**How to apply:** report the model that actually served each request where needed, skip primary-keyed result caching for fallback responses, and make version guards distinguish changes to primary selection from fallback availability policy.
