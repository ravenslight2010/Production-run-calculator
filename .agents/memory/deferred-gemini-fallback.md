---
name: Deferred direct Gemini fallback
description: The direct GOOGLE_API_KEY fallback is intentionally deferred until AI feature work.
---

The direct Gemini provider-key fallback is deferred until the AI features are being worked on. Do not bundle it into unrelated Render static-serving or recipe-guide typecheck fixes.

**Why:** The user explicitly asked to keep the AI-provider change separate from the current non-AI reliability fixes.

**How to apply:** Revisit this alongside AI provider routing, deployment configuration, credential handling, and AI release verification.