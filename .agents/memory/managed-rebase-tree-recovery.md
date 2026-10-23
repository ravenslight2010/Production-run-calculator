---
name: Managed rebase tree recovery
description: How to detect and repair silent tree corruption after a history-preserving managed rebase.
---

Treat a successful rebase as history completion, not proof that the resulting tree matches the validated pre-rebase integration. Replay can leave duplicated declarations, truncated handlers, weakened policy inventories, or stale evidence fingerprints without retaining conflict markers. Task-only added specs and evidence can also revert to earlier task versions; compare them with the validated tip even when they are not listed as conflicts.

**Why:** A managed rebase completed cleanly while replayed conflict resolutions silently changed the integrated tree. Typechecking, sharded tests, generated-contract checks, and revision-bound evidence checks found regressions that a conflict-marker scan could not detect.

**How to apply:** Preserve the pre-rebase integrated tip as a named baseline, compare the final tree against it by subsystem, restore known-good files instead of hand-reconstructing malformed merges, and separately retain intentional changes from the refreshed base. Re-run generators from the resolved source contracts before staging generated artifacts, and re-run evidence fingerprint checks whenever the lockfile changes.

After a conflict-heavy browser-test replay, also run the browser spec inventory/parse check. Package typecheck may exclude end-to-end specs, and a transpile-only check can miss syntax diagnostics; a malformed spec once survived both checks after a rebase.

This also applies to unit-test files excluded from package typechecking, and to
base updates performed during task completion.

**Why:** Completion validation passed while a refreshed base contained a unit
test with duplicated declarations, missing suite boundaries, and a truncated
test body. The earlier test result belonged to the pre-refresh tree.

**How to apply:** After completion refreshes a base, inspect the current test
sources and run their owning suite when they changed; a passing root typecheck
does not establish that excluded test files can parse or execute.

Treat persisted browser pass summaries as evidence for the tree that produced them, not automatically for the post-sync tree.

**Why:** A saved Playwright pass result remained present after a managed sync malformed the corresponding spec. The old result could not establish that the new source even parsed.

**How to apply:** After a sync changes a spec, inventory/parse that spec and rerun its required matrix before claiming the new tree passes. A saved result without matching source provenance is insufficient.

In managed rebases, an `INDEX_LOCKED` response can occur while the operation is advancing to another conflict. Inspect the managed operation and current conflict state before treating that response alone as a stuck rebase.

**Why:** A continuation reported `INDEX_LOCKED` despite having recorded progress and exposing the next conflict; a blind retry or manual index recovery could disrupt the managed operation.

**How to apply:** Re-check merge status and the current index, then continue only through the managed merge-resolution flow. Do not run manual `git rebase --continue`, reset, or checkout commands.

A task rebase also requires a clean worktree before it can start. Preserve intentional untracked workspace files; do not delete or locally ignore them just to satisfy the precondition. If they are not part of the task, ask before committing them or changing their visibility to Git. A GitHub backup operation is not a substitute for the managed rebase source.

After resuming a paused task, a clean shell worktree does not prove that a managed conflict-resolution session is finished.

**Why:** A resumed workspace showed a clean task branch while the managed continuation still held an unresolved generated-file conflict; continuing through the managed callback restored the active conflict state.

**How to apply:** Use the managed continuation to synchronize its state, inspect any returned conflicts again, and resolve those before finalizing. Do not force or manually restart the rebase based only on shell status.

**Why:** The managed rebase rejected a worktree containing workspace custom-skill files, and the repository intentionally leaves those files visible to Git.

**How to apply:** Inspect the exact untracked paths, confirm their contents and ignore rules, and resolve them with the owner before retrying the managed continuation callback.

The managed conflict-resolution callback does not own a rebase started directly in
the shell; it can return `no_active_reconcile` even while the shell rebase has
unresolved conflicts.

**Why:** Conflict continuation is bound to the platform-managed reconciliation
state, not merely to the repository's Git rebase state.

**How to apply:** Use the managed flow to start and continue managed rebases. If
a shell-started rebase conflicts and no managed reconciliation is active, preserve
a named baseline and restore that shell operation before choosing a narrower sync
or requesting a supported managed rebase.

If managed finalization fails during Git LFS fetch and the designated base remote prompts for SSH authentication, treat it as a remote-access setup failure, not a file conflict. Keep the task commit intact; do not attempt a manual rebase or provide an interactive credential.

**Why:** A task could not complete its managed rebase because the LFS fetch had no usable SSH authentication, even though the code validation passed and the worktree was clean.

**How to apply:** Confirm the branch and worktree remain intact, report the remote-access blocker, and retry managed finalization only after that access is restored.

Diagnose the exact configured task route, not a guessed `git@` login to the SSH
proxy. The main workspace and a task checkout need not expose the same managed
remote or authentication context. Distinguish host-key verification failures
from authentication failures before drawing conclusions about token permissions.

**Why:** A generic proxy login and a configured task route produced different
failure stages; neither established that the existing GitHub credential was bad.

**How to apply:** Use bounded, noninteractive read-only checks against existing
routes. Preserve host-key verification, never accept an unverified key to unblock
completion, and never send a GitHub token to an unrelated Replit SSH endpoint.

When a managed conflict affects a test file, inspect the full file and both
staged versions before editing. Conflict markers can split related test bodies
and leave duplicate fragments outside the test suite; broad hunks may fail to
match the conflict's exact text.

**Why:** Combining independently added tests can leave valid-looking fragments
outside their suites or accidentally couple fixtures that must stay independent.

**How to apply:** Use the exact conflict text from the file and compare both
staged versions. Resolve one boundary at a time, then scan the entire file for
markers and trailing fragments and rerun the owning tests before continuing.

For additive test changes, compare the resolved file against the refreshed base,
not only against the task's earlier file. Existing unrelated test bodies should
remain intact, and independently merged regressions must remain present.

**Why:** A marker-free resolution can still drop unrelated test coverage or
replace independent fixtures. Earlier passing results do not validate that
resolved tree.

**How to apply:** Preserve both baseline tips, restore only the damaged test
boundaries, and verify the final diff consists of the intended additions plus
explicitly justified fixture changes. Run the focused file and package typecheck
again on the resolved tree before resubmitting completion.
