---
name: SSE test-reader timeouts
description: Avoid false missed-event failures when a stream read times out before the next SSE frame arrives.
---

An SSE test reader that times out must retain its pending raw `reader.read()` result and parse it on the next call. Do not leave an abandoned asynchronous parser running after the caller's timeout: it can consume a later event that the next assertion is waiting for.

**Why:** A timed-out parse promise can still resolve after the timeout and remove the arriving frame from the stream before the next test read sees it. That produces misleading cross-process delivery failures even when the transport delivered the event.

**How to apply:** In SSE integration-test helpers, keep the pending raw chunk promise in reader state, race the caller's deadline against that promise, and only clear/parse the chunk when a caller actually receives it. Exercise timeout-then-event sequences in transport tests.
