---
name: Voice commands (execute actions)
description: Spoken phrase → server classifies question vs command → structured actions run through existing handlers with Undo; parity-critical dispatch lib.
---

# Voice commands that execute actions

Staff speak on the assistant mic; the FINAL transcript is sent to `/ai/command`
(requireAuth, rate-limited). The server classifies the utterance as a QUESTION
(routed to the unchanged `/ai/ask` flow) or a COMMAND (one or more structured
actions from a fixed vocabulary) or `none`. Actions run **immediately** through
each app's EXISTING mutation handlers — there is NO confirm step and NO new
mutation endpoint. Undo is the only safety net.

## The parity contract lives in `@workspace/voice-commands`
- `VoiceCommandAction` union + `VOICE_COMMAND_KINDS` + `VOICE_COMMAND_ROLES`
  (kind→"operator"|"manager") + `dispatchVoiceCommand(actions, handlers, isManager)`.
- `dispatchVoiceCommand` is the single kind→handler+args mapping both clients call,
  so web and mobile can never drift. It role-gates per action (blocked = a *failed*
  result, not a silent skip), runs in order, and isolates failures (one throwing
  handler never aborts the rest; non-Error throw → "Couldn't apply that.").
- Vocabulary is operator-allowed **except `rollover`** (close out the day → fresh
  next day), which is manager-only and **irreversible (no Undo)** — consistent with
  the design's treatment of destructive ops. The manager-only inventory paths
  (create/delete item) are deliberately NOT exposed as voice commands. The role map
  is the one place to raise a kind to "manager".
- `rollover` reuses each app's existing midnight close-out (consume open runs,
  freeze them, archive the day to history, reset to a fresh day). Web grounds the
  fresh day via `freshDayState()` (date = today); mobile mirrors it with
  `todayStr()`/`resetAt = now`. It is the ONE action needing no grounding refs.

## Server resolves fuzzy refs against grounding (never trusts the model)
`sanitizeCommand` drops any action that references a hallucinated run id / unknown
inventory key, enforces numeric bounds (MAX_TARGET_CASES/MAX_QTY), caps at
MAX_COMMAND_ACTIONS, fills item category/name/unit from the resolved item, and
normalizes free-text stoppage category → fixed StoppageKind. A "command" with zero
surviving actions collapses to `none` so the client never claims a no-op success.

## Mobile Undo drift (documented in code, accepted at parity)
Mobile RunContext lacks reverse primitives for some ops, so `finish_run`,
partial `remove_run`, `start_stoppage`, `end_stoppage` execute (full parity) but
omit the Undo button on mobile; `remove_run` undo re-adds at the END (position
drift). Mobile has no MAX_RUNS check (web does). Mobile `Stoppage.type` IS
`StoppageKind`, so pass `stoppageType` straight to `ctxAddStoppage`.

## Multi-action commands need a live shadow, NOT the captured snapshot
`dispatchVoiceCommand` awaits each action but they all run in ONE task before
React re-renders, so `allRuns`/`run` (captured at handler-build) AND `appStateRef`
(refreshed on render) are ALL stale mid-loop. RunContext mutations compose fine
(every one is a functional `setAppState(prev=>…)`), but a handler's OWN decisions
(which run is current, a runId's index, whether to switch) must read a local
mutable shadow updated in lockstep. `buildVoiceHandlers` keeps `liveRuns`
(ids + start snapshots) + `liveIdx` and mirrors each context updater exactly
(switch/add/remove/move). **Why:** a `switch_run` then run-targeted action (e.g.
finish a *different* run) otherwise compared against a frozen `currentIdx` and
hit the wrong run. Run *content* (started/ended/stoppages) still reads the
start-of-command snapshot — degenerate same-run content sequences in one utterance
are unsupported by design.

## Testing
- Dispatch lib tested from the web artifact suite (`voiceCommandDispatch.test.ts`)
  — it can import `@workspace/voice-commands` directly.
- Server `sanitizeCommand`/`validateCommandBody` tested in
  `artifacts/api-server/src/routes/aiCommand.test.ts`; the dayState fixture must
  satisfy the full AiOptimizeBody run schema (copy `makeRun` from aiOptimize.test).
