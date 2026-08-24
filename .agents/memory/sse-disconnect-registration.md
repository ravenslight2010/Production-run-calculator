---
name: SSE disconnect registration
description: Long-lived sync streams must register disconnect cleanup before awaited initial snapshot work.
---

Register the request close handler before the initial database lookup and check
the closed flag before adding the client or starting the heartbeat.

**Why:** A wake/reload can abort a stream while its first snapshot is still
being read. Registering cleanup afterward can retain a disconnected response
and timer, preventing server/test shutdown.

**How to apply:** Use this ordering for sync SSE handlers and explicitly cancel
stream readers in integration-test collectors.