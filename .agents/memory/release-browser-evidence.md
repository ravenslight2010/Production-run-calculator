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
only against a disposable database accepted by the isolation guard; the API
process used by the browser runner must use that same database URL, not the
managed API workflow's environment.

The retained full-suite report must be generated from the complete Playwright
run, include per-file durations and case completion counts, and carry the git
revision that the release evidence verifier checks. Discovery and focused
commands must not overwrite that retained report.

**Why:** A zero-test discovery run or a focused diagnostic can otherwise make
stale or incomplete browser evidence look like the latest release result.

**How to apply:** Give release runs an explicit report path, require the 99-case
coverage contract for GO, and skip writes for `--list` or non-full local runs.