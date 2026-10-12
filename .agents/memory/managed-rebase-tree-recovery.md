---
name: Managed rebase tree recovery
description: How to detect and repair silent tree corruption after a history-preserving managed rebase.
---

Treat a successful rebase as history completion, not proof that the resulting tree matches the validated pre-rebase integration. Replay can leave duplicated declarations, truncated handlers, weakened policy inventories, or stale evidence fingerprints without retaining conflict markers.

**Why:** A managed rebase completed cleanly while replayed conflict resolutions silently changed the integrated tree. Typechecking, sharded tests, generated-contract checks, and revision-bound evidence checks found regressions that a conflict-marker scan could not detect.

**How to apply:** Preserve the pre-rebase integrated tip as a named baseline, compare the final tree against it by subsystem, restore known-good files instead of hand-reconstructing malformed merges, and separately retain intentional changes from the refreshed base. Re-run generators from the resolved source contracts before staging generated artifacts, and re-run evidence fingerprint checks whenever the lockfile changes.

After a conflict-heavy browser-test replay, also run the browser spec inventory/parse check. Package typecheck may exclude end-to-end specs, and a transpile-only check can miss syntax diagnostics; a malformed spec once survived both checks after a rebase.

In managed rebases, an `INDEX_LOCKED` response can occur while the operation is advancing to another conflict. Inspect the managed operation and current conflict state before treating that response alone as a stuck rebase.

**Why:** A continuation reported `INDEX_LOCKED` despite having recorded progress and exposing the next conflict; a blind retry or manual index recovery could disrupt the managed operation.

**How to apply:** Re-check merge status and the current index, then continue only through the managed merge-resolution flow. Do not run manual `git rebase --continue`, reset, or checkout commands.

A task rebase also requires a clean worktree before it can start. Preserve intentional untracked workspace files; do not delete or locally ignore them just to satisfy the precondition. If they are not part of the task, ask before committing them or changing their visibility to Git. A GitHub backup operation is not a substitute for the managed rebase source.

**Why:** The managed rebase rejected a worktree containing workspace custom-skill files, and the repository intentionally leaves those files visible to Git.

**How to apply:** Inspect the exact untracked paths, confirm their contents and ignore rules, and resolve them with the owner before retrying the managed continuation callback.

If managed finalization fails during Git LFS fetch and the designated base remote prompts for SSH authentication, treat it as a remote-access setup failure, not a file conflict. Keep the task commit intact; do not attempt a manual rebase or provide an interactive credential.

**Why:** A task could not complete its managed rebase because the LFS fetch had no usable SSH authentication, even though the code validation passed and the worktree was clean.

**How to apply:** Confirm the branch and worktree remain intact, report the remote-access blocker, and retry managed finalization only after that access is restored.