---
name: GitHub Git push authentication
description: The distinction between the authorized GitHub API integration and authenticated Git protocol pushes from the workspace.
---

The installed GitHub API connection can read and modify GitHub REST resources, but it does not make the local shell's HTTPS `git push` authenticated and cannot update a ref to a commit whose Git objects have not been uploaded. Workspace Git pushes need a secure `GIT_URL` secret containing the authenticated repository URL.

**Why:** A REST ref update alone cannot transfer a local commit graph, and the shell's unauthenticated remote rejects password/token-less pushes.

**How to apply:** Use the secure secret flow for `GIT_URL`; never print or request its value in chat. Prefer `--force-with-lease` with an explicitly verified expected remote SHA when replacing a diverged branch.