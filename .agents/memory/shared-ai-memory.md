---
name: Shared AI memory layer
description: Facility-wide knowledge store + per-user conversation history that grounds every AI prompt; the foundation downstream AI features build on.
---

# Shared AI memory layer

Two server-backed stores plus one shared context builder that every AI feature
leans on. Built as the foundation for downstream AI work (alerts, chat UI,
photo, forecasting, recipe assistant, smarter incidents).

## The two stores (keep them distinct)
- **Facility knowledge** — durable, factory-wide operational FACTS, shape
  `{domain, key, fact}`, deduped by `(domain, key)` case-insensitively. Shared
  across ALL signed-in users. This is NOT the existing name-corrections pool
  (`ai-corrections` / `merge-suggest`): corrections rewrite `from=>to` strings;
  knowledge records standalone operational observations. Do not conflate them.
- **Conversation turns** — per-user rolling history, shape `{role, text}` where
  role coerces to `user`/`assistant`. Scoped to the caller only. Order is
  PRESERVED (never deduped); window keeps the most-recent N.

**Why distinct stores:** corrections answer "what does this name really mean";
facility knowledge answers "what do we know about how this plant runs". Mixing
them pollutes both dedupe keys and the prompt blocks.

## Where the pieces live
- Pure helpers: `@workspace/ai-memory` (lib/ai-memory) — `normalizeKnowledge`,
  `filterKnowledgeByDomain`, `buildKnowledgeBlock`, `knowledgeKey`,
  `normalizeConversationTurns`, `trimConversationWindow`,
  `buildConversationBlock`. Dependency-free, mirrors the corrections helpers.
- Server: `artifacts/api-server/src/routes/aiMemoryContext.ts` holds loaders +
  `groundPromptWithMemory` (the single grounding entry point) + writers
  `recordFacilityKnowledge` / `recordConversationTurns`. Route file
  `aiMemory.ts`. Both reads and writes are FAIL-SAFE — exactly like
  `aiCorrectionsContext`; on any failure the prompt just sees empty memory.
- The facility block is now threaded into nearly ALL generative endpoints:
  every `/ai/*` in ai.ts EXCEPT `/ai/command` (intent classifier) and the
  `aiReviewer` 2nd-pass reviewer (both intentionally un-grounded), plus
  inventory quality + waste insight and incident diagnosis. Per-user
  CONVERSATION memory (userId passed) is only `/ai/ask` — every other feature is
  single-shot by design (mix-assistant, recipe-assistant, etc.).
  **Any new AI endpoint must call the shared grounding path**, not re-load memory
  ad hoc. (incident diagnosis loads facility knowledge directly rather than via
  groundPromptWithMemory, but still grounds.)

## Gotchas
- `normalizeConversationTurns` input type is loose (`{role?: unknown; text?:
  unknown}`) on purpose so raw DB rows / wire payloads pass without casts; it
  coerces role internally. Don't tighten it back to `Partial<ConversationTurn>`.
- Conversation API wire shape is `{role, text}` ONLY (no timestamp) — added to
  avoid a bigint round-trip through codegen. Server stamps createdAt.
- Facility rows are capped server-side (MAX_FACILITY_ROWS=500); conversation is
  window-trimmed on write. Don't rely on clients to bound size.
- Auth: conversation routes are per-user (`req.userId`). Facility GET requires
  `use-ai-tools` (bulk pool disclosure is gated — no client reads it directly,
  prompts are grounded server-side). Facility POST stays open to any
  signed-in user for the couple of everyday features that legitimately write
  back (dismissing a nudge; confirming a quality check), but every entry must
  match its domain's exact key shape AND fact shape via CLOSED-VOCABULARY
  regexes with zero free-text capture groups (enum values / slugs / numbers
  only) — no bounded-length free text either. Two weaker versions were
  rejected in review before landing here: a domain-only allow-list still left
  `fact` fully free-text, and even a "fixed sentence with a short bounded
  quoted substring" template was rejected as still attacker-controlled prose.
  The lesson: for a value that gets folded into an AI prompt as trusted
  background, "bounded free text" is not a safe stopping point if a
  meaningfully-privileged surface consumes that prompt — only closed
  vocabulary (or full capability-gating / removing public write access) is.
  One domain also requires a real capability server-side, mirroring the
  capability its own UI already gates it behind, so the raw endpoint can't
  bypass that. `normalizeKnowledge` additionally strips control
  characters/newlines from every field (domain/key/fact) unconditionally, for
  every caller — otherwise a fact containing newlines could forge fake extra
  "- [domain] ..." lines under an unrelated, more-trusted domain in the
  rendered prompt block, defeating any per-domain rule regardless of how
  strict it is. Any new client-writable domain needs the same treatment: full
  key regex + full fact regex with no free-text captures, and a capability
  check if the underlying feature isn't meant for every signed-in user.
  Server-side writers (incidents, forecast, waste, proactive-alert triggers)
  are unaffected since they call the write function directly, never through
  this route.
- Parity: web glue `artifacts/run-calculator/src/aiMemory.ts` (relative `/api`,
  `inventoryClientId()`), mobile glue
  `artifacts/run-calculator-mobile/context/aiMemory.ts` (`getApiBaseUrl()` +
  `getOrCreateClientId()` + Bearer via `getAuthToken()`). Mirror the
  importAliases glue pattern; keep both in lockstep.
