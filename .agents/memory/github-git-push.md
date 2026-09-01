---
name: GitHub Git push authentication
description: The distinction between the authorized GitHub API integration and authenticated Git protocol pushes from the workspace.
---

The installed GitHub API connection can read and modify GitHub REST resources, but it does not make the local shell's HTTPS `git push` authenticated and cannot update a ref to a commit whose Git objects have not been uploaded. Workspace Git pushes need a secure `GIT_URL` secret containing the authenticated repository URL.

**Why:** A REST ref update alone cannot transfer a local commit graph, and the shell's unauthenticated remote rejects password/token-less pushes.

**How to apply:** Use the secure secret flow for `GIT_URL`; never print or request its value in chat. Prefer `--force-with-lease` with an explicitly verified expected remote SHA when replacing a diverged branch.

When a root pnpm command forwards user arguments to a package-level script, account for pnpm's separator forwarding; a direct root wrapper keeps the documented `pnpm run ... -- --message` form unambiguous.

**Why:** Nested `pnpm run` commands can pass the separator through as an extra literal argument, making an otherwise standard documented invocation fail before the script parses its options.

**How to apply:** Test the exact root command users will run, not only the underlying package script, whenever adding a forwarded Git workflow command.