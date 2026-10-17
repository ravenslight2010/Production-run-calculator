---
name: Local browser test origins
description: Origin alignment required when focused Playwright runs start local API and web servers.
---

# Local browser test origins

When a focused Playwright run uses its local release servers, set `PLAYWRIGHT_BASE_URL` to the local web-server URL as well as enabling local servers.

**Why:** Browser fixtures derive their API base and authentication-cookie URL from `PLAYWRIGHT_BASE_URL`. If it falls back to the Replit development domain while the page runs on `127.0.0.1`, the fixture account is created successfully but the browser remains signed out.

**How to apply:** Use the same local web port for `PLAYWRIGHT_BASE_URL` and `RELEASE_BROWSER_WEB_PORT`; keep the API proxy on the matching local API port.