---
name: Scheduled-day response validation
description: Prevent scheduled-sync error envelopes from corrupting the calculator's scheduled-day state.
---

Scheduled-day refreshes must validate that a successful response has the expected array and row/run shape before storing it in React state. Do not use a TypeScript cast as runtime validation.

**Why:** An expired or cleaned-up browser session can receive an error envelope such as `{ "error": "Unauthorized" }`. Storing that object as the schedule makes the next render call array methods such as `.flatMap()` on an object and sends the calculator to its error boundary during reload.

**How to apply:** Keep the response normalizer at every scheduled-day fetch boundary. Treat malformed or non-array responses as an empty schedule (or retain existing state where the UI needs that behavior), and test an error envelope explicitly.