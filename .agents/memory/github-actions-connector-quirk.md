---
name: GitHub Actions connector limitation
description: The Replit GitHub connector can read and write ordinary repository files, but Cloudflare blocks workflow-path operations and Actions secrets are not exposed.
---

The GitHub connector may return 403 Cloudflare pages for `.github/workflows/*` contents operations and 404 for Git Data tree creation, even when ordinary file writes and Actions metadata reads work. It also cannot reveal or provision repository secrets.

**Why:** CI verification requires the workflow to exist on the remote and its credentials to be configured in GitHub; claiming a run from the local checkout is not equivalent.

**How to apply:** Check the remote Actions workflow list and secret metadata before dispatching. If the workflow is absent or required secrets are missing, ask the repository owner to publish/configure them through GitHub, then dispatch and inspect the run.