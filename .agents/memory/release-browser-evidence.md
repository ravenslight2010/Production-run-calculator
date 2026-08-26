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

Default standard and full release checks use sibling evidence roots rather than
nesting one mode under the other; an explicit `RELEASE_EVIDENCE_DIR` remains an
exact single-run override.

**Why:** Evidence validation recursively scans its selected root and rejects
unexpected files. Nesting full evidence under the standard root would make a
valid concurrent full run fail the standard allowlist check.

**How to apply:** Keep the existing standard root stable for retained evidence
and place default full-mode artifacts in a separate sibling root. Verify each
default mode against its matching mode flag.

Retained full-browser summaries must be checked for semantic freshness against
the assessed revision and run date; an allowlisted evidence verifier can pass
while a nested prior-day summary still says PASS.

**Why:** A current full run can fail while an older passing
`browser-full/FINAL-REPORT.md` remains present, creating a misleading release
record unless the stale artifact is called out explicitly.

**How to apply:** Treat a stale retained summary as an evidence blocker, keep
the current full-suite log and Playwright artifacts, and do not infer current
coverage from file presence alone.

When a failed serial full run does not write its normal reporter output, rebuild
diagnostic counts from the individual test statuses and the reporter contract,
not just the terminal summary wording: completed = passed + skipped + failed,
and not-run = enumerated − completed.

**Why:** Playwright's terminal “did not run” summary can group skipped and
unexecuted cases differently from the retained reporter's `notRun` field. Mixing
the two interpretations makes a truthful diagnostic report fail mechanical
evidence validation.

**How to apply:** Reconcile per-file rows to the verifier invariants before
running `check:release-evidence`; preserve the terminal summary separately when
its wording differs.