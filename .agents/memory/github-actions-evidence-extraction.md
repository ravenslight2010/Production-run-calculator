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