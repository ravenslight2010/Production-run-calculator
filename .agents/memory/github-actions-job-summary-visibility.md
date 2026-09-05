---
name: GitHub Actions cancelled-job summaries
description: Cancelled Actions runs may execute summary steps and upload artifacts without exposing job-summary Markdown through public pages or the check-run API.
---

Job summary text written through `GITHUB_STEP_SUMMARY` is not reliably available to an unauthenticated browser or REST check-run output when the job conclusion is cancelled, even when the summary step succeeds and the artifact exists.

**Why:** GitHub separates step status, artifact metadata, and rendered summary visibility; a cancelled run can preserve the first two while hiding the rendered Markdown from public/API views.

**How to apply:** Treat successful summary-step status plus artifact metadata as operational evidence. If exact Markdown must be audited, use an authenticated GitHub review or a temporary, explicitly scoped capture of the summary file.