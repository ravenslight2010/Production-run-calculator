---
name: Voice output (read answers aloud) for Ask-the-day chat
description: How the "speak answers" toggle that narrates AI replies is implemented across web + mobile
---

The "speak answers" toggle on the "Ask about the day" chat reads the newest AI
reply aloud, completing the hands-free loop after a spoken question. It only
narrates text already on screen — nothing about grounding or answer text
changes.

Implementation: the browser **SpeechSynthesis API** (`window.speechSynthesis` /
`SpeechSynthesisUtterance`), wrapped in a `useSpeechOutput` hook duplicated per
platform (web `src/useSpeechOutput.ts`, mobile `hooks/useSpeechOutput.ts`,
verbatim mirror except mobile guards `Platform.OS === "web"`). Exposes
`supported / speaking / speak / cancel`. This mirrors the voice-INPUT pattern
(`useSpeechInput`); see `voice-ask-input.md`.

In AskChat the toggle is auto-speak, not a one-shot per-message button: an
effect narrates the latest assistant turn whenever `turns` changes and the
toggle is on; a `lastSpokenRef` index prevents re-speaking on re-render;
re-enabling resets it to -1 so it re-reads the current latest reply.

**Why SpeechSynthesis (not a native lib):** same constraint as voice input —
works in web + Expo web (Replit preview + UI tests). On a real native build
there is no JS-only TTS, so `supported` is false and the control is hidden —
graceful fallback to reading the text.

**How to apply:** keep web + mobile hooks/UI identical (replit.md parity).
