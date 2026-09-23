---
name: Local release browser fixture base URL
description: Focused release-browser runs must point fixture API requests at the local API when local servers are enabled.
---

When `RELEASE_BROWSER_LOCAL_SERVERS=1`, also set `PLAYWRIGHT_BASE_URL` to the local
API port for browser specs whose fixture helpers derive `API_BASE` from that
variable. The release config uses its own local web port for the browser, while
fixture writes otherwise fall back to the external dev domain and can return a
misleading 502.

**Why:** The browser web server and fixture API base are configured independently;
starting local servers alone does not redirect fixture setup requests.

**How to apply:** Use the local API URL for focused release-debug runs, then
investigate any remaining UI failure separately from fixture startup.