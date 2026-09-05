---
name: Release evidence verifier mode
description: Standard and full release evidence are separate directories; verify the full report with explicit full mode.
---

When the release being assessed is the full run, the authoritative retained evidence is in the full evidence directory and must be checked with the verifier's full-mode option. The default verifier checks the standard directory, which may be stale even when the current full report is valid.

**Why:** A passing full release can appear blocked by a failed default evidence workflow that inspected an older standard report instead of the newly generated full report.

**How to apply:** Confirm the full report and browser report match `HEAD`, say `GO`, and run the explicit full evidence verifier before making the publish decision. Treat a default standard-directory failure as a separate evidence-directory issue, not as a full-run result.