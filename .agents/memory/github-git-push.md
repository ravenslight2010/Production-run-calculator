---
name: GitHub Git push authentication
description: GitHub is a project backup, not the publishing source; API authorization and Git push authentication remain separate.
---

## GitHub's project role

GitHub is a backup location for this project, not the source of the live publish.
A local Git commit can identify a source version without being pushed to GitHub.

The owner explicitly requires test/readiness approval to stop depending on
Git/GitHub identifiers. Application-owned build identity and independently
verified source fingerprints are the intended primary identity; Git is optional
metadata, not a prerequisite.

**Why:** The owner reiterated that GitHub is only a backup after a mock readiness
check still blocked on a full Git revision despite an exact published-source
match.

**How to apply:** Update evidence producers and consumers together rather than
removing source-binding guards. Preserve historical Git-bound proof separately,
and retain health, security, expiry, reconciliation, and matching-test gates.

**Why:** The owner explicitly clarified, “Its a backup location for you,” after
release identity discovery incorrectly emphasized GitHub branch revisions.

**How to apply:** Read accessible local version identifiers automatically and
verify their relationship to the intended published build separately. Do not
require a backup push or treat a stale GitHub branch as a release blocker. Use
remote verification for requested backup pushes or explicitly applicable GitHub
CI evidence, not as a substitute for published identity. This distinction does
not waive existing source-version or deployment-binding release checks.

## Git push authentication

The installed GitHub API connection can read and modify GitHub REST resources, but it does not make the local shell's HTTPS `git push` authenticated and cannot update a ref to a commit whose Git objects have not been uploaded. Workspace Git pushes need a secure push credential, supplied as an authenticated repository URL or assembled from a token only within the pushing process.

**Why:** A REST ref update alone cannot transfer a local commit graph, and the shell's unauthenticated remote rejects password/token-less pushes.

**How to apply:** Use the secure secret flow for `GIT_URL`; never print or request its value in chat. Prefer `--force-with-lease` with an explicitly verified expected remote SHA when replacing a diverged branch.

An existing configured push URL can take precedence over a process-local push URL for the same remote, even when the latter appears in Git's config. Verify the effective push URL structurally without printing it; use a separate temporary remote if necessary, and remove it afterward. An API response that reports the account has push permission does not prove that a fine-grained token has repository Contents write permission for Git pushes.

**Why:** A stale push URL masked a newly supplied valid token; once Git used that token, the server denied the push with 403 even though authenticated REST reads succeeded and the account reported push permission.

**How to apply:** Distinguish credential selection errors from token-scope failures before asking for another secret. Check the effective remote and verify the exact remote tip after any successful push; do not infer success from an API permission field.

For review-only CodeRabbit scans of a long-lived branch, split an oversized diff into stacked PRs at existing ancestor commits rather than merging into the default branch. The default CodeRabbit auto-review setting may skip PRs whose base is not the default branch; a manual `@coderabbitai full review` comment can request those reviews without changing repository-wide settings.

**Why:** Staying below the per-PR file limit solved the size rejection, but the non-default-base pieces were then skipped automatically. CodeRabbit acknowledged manual full-review requests for those pieces.

**How to apply:** Verify each PR's GitHub changed-file count is below the review limit, keep every part marked review-only, and verify the bot accepted manual requests. Do not mistake an acknowledgment for a completed review.

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

A workspace Git credential may be a token-only value rather than an authenticated URL. Do not treat a URL-format mismatch as proof that the credential is invalid.

**Why:** A valid token-only credential was skipped while an expired authenticated URL was retried.

**How to apply:** Detect the format only inside the credential-consuming process, never print it, and build any temporary authenticated URL for the independently verified destination repository. Keep credentials in process-local configuration rather than persistent remotes.

## Linked worktrees with optional LFS assets

For bounded CI comparisons, set `GIT_LFS_SKIP_SMUDGE=1` on linked-worktree creation only after confirming that every selected test/build input is available as a normal Git blob and LFS payloads are outside the measured check closure.

**Why:** A hosted worktree can fail during LFS smudge before any comparison runs, even when the primary checkout is valid and Git push authentication works.

**How to apply:** Inspect the LFS inventory and the exact inputs used by the selected checks. Do not skip LFS downloads globally when a measured test or build depends on those assets.