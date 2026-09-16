---
name: GitHub Git push authentication
description: The distinction between the authorized GitHub API integration and authenticated Git protocol pushes from the workspace.
---

The installed GitHub API connection can read and modify GitHub REST resources, but it does not make the local shell's HTTPS `git push` authenticated and cannot update a ref to a commit whose Git objects have not been uploaded. Workspace Git pushes need a secure `GIT_URL` secret containing the authenticated repository URL.

**Why:** A REST ref update alone cannot transfer a local commit graph, and the shell's unauthenticated remote rejects password/token-less pushes.

**How to apply:** Use the secure secret flow for `GIT_URL`; never print or request its value in chat. Prefer `--force-with-lease` with an explicitly verified expected remote SHA when replacing a diverged branch.

Task-agent merge commits may be unsigned even after GitHub enables required signed
commits. Configuring signing only affects future commits; delivery must re-sign
or recreate the local-only history (or create one signed release snapshot) before
updating protected `main`.

**Why:** GitHub's required-signatures rule evaluates the commits being added to
the protected branch, while Replit task merges can already exist locally without
a cryptographic signature.

**How to apply:** Never weaken the GitHub policy to make a push work. Establish
the signing setup first, choose whether preserving individual local commits or a
single signed release snapshot is preferred, then push and verify the resulting
remote tip.

When administrators are exempt from branch protection, GitHub may accept a commit
while reporting that the required-signature violation was bypassed. A locally
valid signature is not enough; GitHub must report `verified: true` for the exact
commit before it becomes the protected branch tip.

**Why:** An SSH signature from a key GitHub does not yet recognize can pass local
`git verify-commit`, while an administrator push still advances `main` under the
branch-rule bypass.

**How to apply:** Push the exact signed candidate to a disposable branch first,
read GitHub's commit verification result, and fast-forward `main` only when the
result is valid. Delete the disposable branch afterward.

GitHub's branch-protection API represents `allow_force_pushes` and
`allow_deletions` as objects with an `enabled` boolean, while required status
checks use exact workflow job names and app IDs.

**Why:** A read-only verifier that compares the whole restriction object or
uses a renamed workflow label can report false drift or fail to match the live
rule.

**How to apply:** Extract `.enabled` for restriction fields and keep workflow
job names, policy prose, evidence, and verifier fixtures synchronized.

When a root pnpm command forwards user arguments to a package-level script, account for pnpm's separator forwarding; a direct root wrapper keeps the documented `pnpm run ... -- --message` form unambiguous.

**Why:** Nested `pnpm run` commands can pass the separator through as an extra literal argument, making an otherwise standard documented invocation fail before the script parses its options.

**How to apply:** Test the exact root command users will run, not only the underlying package script, whenever adding a forwarded Git workflow command.