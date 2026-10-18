---
name: Release-runner loopback probes
description: Why HTTPS-only Node guards must permit local browser readiness checks without permitting remote cleartext HTTP.
---

Playwright's local `webServer` readiness probes may use Undici sockets and must bypass the HTTPS-only proxy only for loopback addresses. The isolated browser runner should add `127.0.0.1`, `localhost`, and `::1` to `NO_PROXY` for its own children; the release wrapper intentionally keeps its general `NO_PROXY` empty.

**Why:** Blocking local readiness probes makes Playwright report a healthy test port as unavailable before browser tests begin. A `node:http`-only exception does not cover Undici's lower-level socket path.

**How to apply:** Keep loopback proxy bypass inside the isolated browser runner, and test it alongside the Node guard's loopback-only socket exception and external HTTP rejection path. Do not disable the guard or HTTPS proxy for browser runs.
