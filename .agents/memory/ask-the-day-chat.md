---
name: Ask-the-day AI chat
description: Plain-language Q&A chat box grounded only in the day's real data; per-user follow-up memory; available to all authenticated staff.
---

# Ask the AI about the day

A free-form chat box where any signed-in staffer asks a plain-language question
("can we finish by 2pm?") and gets an answer grounded ONLY in the day's real
data. Distinct from the manager-only **optimize** assistant on the same screen.

## Access boundary (the key decision)
- `/ai/ask` uses the **global `requireAuth` only — NOT `requireRole`**. All
  authenticated staff can ask. The optimize endpoint stays manager-only.
- **Why:** task required the chat be available to ALL authenticated users, while
  optimize recommendations remain a manager tool.
- **How to apply:** on both screens the `<AskChat>` renders for everyone
  (outside the `isManager` gate); only the optimize section is wrapped in
  `{!isManager ? null : (<>…</>)}`. Don't accidentally re-gate the chat.

## Shape & reuse
- Body = `{question, dayState}` where `dayState` is the existing `OptimizeInput`
  (built by the shared `buildInput()` both the chat and optimize button call, so
  the model sees identical day facts). `validateAskBody` reuses
  `validateOptimizeBody` for the day-state run-count cap — one source of truth.
- Grounding + memory: route calls `groundPromptWithMemory(...)` BEFORE
  `recordConversationTurns(userId, [user, assistant])`. Per-user follow-up
  windowing lives in `@workspace/ai-memory` (`DEFAULT_CONVERSATION_WINDOW`,
  `trimConversationWindow`, `normalizeConversationTurns`, `buildConversationBlock`).
  Recording is best-effort/fail-safe.
- Rate-limited like other AI endpoints (own `askRateStore`, 60s/max10).
- `sanitizeAnswer` parses lenient `{answer, note}` JSON; on parse failure falls
  back to raw content so a formatting slip never drops a real reply. `note` is
  the model's honest "can't answer / what's missing" channel, surfaced as an
  amber advisory in the UI.

## Parity
- Web glue `artifacts/run-calculator/src/aiAsk.ts` (cookie session, relative
  `/api`) mirrors mobile `artifacts/run-calculator-mobile/context/aiAsk.ts`
  (bearer token + clientId, `getApiBaseUrl()`); both reuse `photoErrorMessage`
  for friendly 429/413 text. `<AskChat buildInput=...>` is verbatim-mirrored in
  `AssistantTab.tsx` (web) and `app/(tabs)/assistant.tsx` (mobile).
