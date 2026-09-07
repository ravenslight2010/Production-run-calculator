---
name: Live performance trace execution
description: How to run browser traces whose real-time observation window exceeds the foreground shell timeout.
---

Real-time browser traces longer than the foreground shell limit must run as a
background shell task, with metrics written to a temporary file and read only
after completion. Keep the observation windows real rather than shortening them
to fit the command timeout.

**Why:** The master-data idle threshold is three minutes, so a complete
active → idle → hidden → resumed trace can exceed the five-minute foreground
execution limit even when the app and browser are healthy.

**How to apply:** Start the disposable Playwright harness in the background,
redirect output, wait for its report file, then remove the temporary harness and
retain only sanitized aggregate evidence.