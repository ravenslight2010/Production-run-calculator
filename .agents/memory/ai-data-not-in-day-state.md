---
name: AI data is server-side, not in day-state
description: Why AI memory does NOT suffer the day-state refresh-loss bug, and what actually causes a perceived "AI reset on refresh".
---

All AI persistence lives in dedicated server DB tables, NOT in the synced
`daily_sync` blob, so the recurring day-state refresh/clobber bug does NOT touch
it:

- `ai_conversation_turns` — per-user rolling chat window (FK `user_id` →
  `users.id` ON DELETE CASCADE; NOT scope-isolated). Rehydrated on mount via
  `GET /ai-memory/conversation`; recorded by `recordConversationTurns` in BOTH
  the stream and non-stream `/ai/ask` paths (shared `finalize`). Record errors
  are swallowed (logged only).
- `facility_knowledge`, `ai_corrections` — factory-wide, `scope`-tagged.
- `incidents` — `reporter_id` is plain nullable text (NO FK), so it survives
  user churn.

**Verified:** the turns table accepts insert+select fine (dev round-trip).
Nothing in the daily-reset, session-boundary, or sync paths deletes AI memory.

**Why a user may report "the AI reset all its info on refresh":**
1. **Most likely — downstream of the day-state clobber (already fixed).** Every
   AI answer is GROUNDED in the client's day-state (today's runs / schedule /
   inventory via `buildInput`/`OptimizeInput`). When the day-state was being
   wiped on refresh, the AI had nothing to reference and looked amnesiac. Fixing
   the day-state loss restores the grounding.
2. **By-design sandbox re-copy.** `resetSandbox()` (lib/sandbox.ts) wipes the
   `sandbox`-scope rows of `facility_knowledge`/`ai_corrections`/aliases/etc. and
   re-copies them from `live`. The first sandbox (`test` account) login after the
   copy goes stale (`SANDBOX_STALE_MS` = 24h) triggers it. So AI memory built up
   while logged in as `test` resets to the live snapshot ~daily — intended demo
   behavior, but surprising. (Conversation turns are NOT scope-isolated, so they
   are NOT reset by this.)

**Why prod showed 0 conversation turns:** the mechanism is sound; 0 just means
the Ask chat hadn't been successfully exercised on the deployed build (not a loss
bug). Do not "fix" this by moving AI data into the sync blob.
