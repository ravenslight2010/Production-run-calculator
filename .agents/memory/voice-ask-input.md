---
name: Voice input for Ask-the-day chat
description: How the mic button on the AI "Ask about the day" chat is implemented across web + mobile
---

The mic button on the "Ask about the day" chat transcribes speech into the
existing question box, then sends through the normal /ai/ask flow — no new
endpoint, no change to grounding/answer logic.

Implementation: the browser **Web Speech API** (`SpeechRecognition` /
`webkitSpeechRecognition`), wrapped in a `useSpeechInput` hook duplicated per
platform (web `src/useSpeechInput.ts`, mobile `hooks/useSpeechInput.ts`,
verbatim mirror except mobile guards `Platform.OS === "web"`).

**Why not a native speech library:** the expo skill forbids non-Expo-Go native
libs, and the Replit mobile preview + UI tests run as Expo web. The Web Speech
API works in both web app and Expo web. On a real native build there is no
JS-only STT, so `supported` is false and the mic button is simply hidden —
this is the task's intended "graceful fallback to typing."

**How to apply:** if asked to make voice work on real native iOS/Android,
that requires a native module (e.g. expo-speech-recognition) + custom dev
build, which conflicts with the Expo Go constraint — flag the tradeoff first.
Keep web and mobile hooks identical (replit.md parity). Transcription fills the
input for review; it does NOT auto-send.
