---
name: Release browser evidence
description: Constraints for running and retaining the full Playwright release suite in Replit environments.
---

The release browser suite must resolve the system Chromium executable when the
Playwright-managed browser cache is unavailable. Failure screenshots and traces
are sufficient diagnostics; video capture adds an ffmpeg dependency that is not
present in every verification environment.

**Why:** Replit's Nix environment can provide Chromium without Playwright's
bundled browser or ffmpeg assets, and destructive global setup must never run
against the shared development database.

**How to apply:** Keep the executable override optional with a system-browser
fallback, retain HTML/results directories, and run the full destructive suite
only against a disposable database accepted by the isolation guard.