---
name: Voice-command e2e test seam
description: How to e2e-test the web voice-command flow when the test browser has no Web Speech API.
---

The test browser used by `runTest` has no `SpeechRecognition`, so the mic button only renders
when speech is supported and there is no native way to feed a transcript. Test the REAL wiring
(mic → `/ai/command` → handler) by injecting a fake `SpeechRecognition`/`webkitSpeechRecognition`
BEFORE opening the assistant view, then firing a synthetic FINAL result from `rec.onresult`.

**Why:** this exercises the production path from `rec.onresult` onward without touching product code.
A typed input goes only to the ask flow — the mic is the ONLY path to `/ai/command`, so the speech
seam is required to test commands.

**How to apply (web Production Run Calculator):**
- Inject globals before clicking the header-menu "AI Assistant" item (Radix remounts content on switch;
  `speechSupported()` is read at AskChat mount). FakeRec must capture `const self=this` in its
  constructor and store `self` on `start()` (NOT an arrow `this`), so a global helper can reach the instance.
- Fire a final result shaped like `{resultIndex:0, results:{length:1, 0:{isFinal:true, 0:{transcript}}}}`.
- The Undo window is short (`UNDO_WINDOW_MS=6000`). Drive fire+undo inside ONE `page.evaluate`: wait for
  `[data-testid="voice-command-result"]`, capture its text, then click `[data-testid="button-undo-voice-command"]`
  immediately — do not split across separate harness steps or the window expires.
- Selectors: mic `button-ask-mic`, result row `voice-command-result`, undo `button-undo-voice-command`,
  ask assistant turn `ask-turn-assistant`. Target finish time is an `input[type=time]` on the Dough tab
  (`tab-dough`), bound to `runToTime` (default `19:15`). `set_target_time` undo is pure React state
  (`setRunToTime`), so the time input reflects apply/undo synchronously.
- Make the baseline deterministic: `DELETE FROM daily_sync WHERE date IN (today, ±1 day)` so the time starts at 19:15.
- Phrases: a command e.g. "set the finish time to 2 pm" → `set_target_time` 14:00; a question e.g.
  "can we finish all our runs by 2 pm" classifies as a question (ask flow, zero command-result rows).
