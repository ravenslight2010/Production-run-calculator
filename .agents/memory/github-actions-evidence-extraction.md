---
name: GitHub Actions evidence extraction
description: How to retain exact CI reports when the GitHub connector can inspect artifacts but cannot download their ZIP payloads.
---

Use a narrowly scoped, temporary GitHub Actions workflow to download or generate the
report inside GitHub, validate its schema and revision binding, and commit it to an
evidence branch. Retain a review manifest with the successful run, evidence commit,
report path, and SHA-256 digest.

**Why:** The GitHub connector may list Actions artifacts and their digests while returning
403 for ZIP downloads. GitHub-hosted `gh run download` remains authorized. A dedicated
capture job also separates successful resource measurement from unrelated release-lane
failures.

**How to apply:** Use fixed run/artifact identifiers or branch-bound source revisions,
least-privilege `contents: write`, strict report validation, and evidence-only commit paths
that do not change the measured source revision. Do not merge the temporary workflow.

Evidence-generating task handoffs must retain the exact report in the shared, merged
evidence location; task completion text or stale project-level reports cannot substitute.

**Why:** Downstream verification can only inspect the shared workspace, and omitted
isolated-run logs make timings and failures impossible to attribute.

**How to apply:** Record the full source revision, mode, run identity/time, environment,
and report path beside the sanitized report. Verify referenced artifacts are present after
merge. For failed captures, preserve the failure status and state the evidence gap rather
than silently inheriting a stale report.