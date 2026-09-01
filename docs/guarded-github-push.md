# Guarded direct-to-main GitHub push

`pnpm run push:main -- --message "Describe the change"` is the repository's
test-gated command for committing explicitly staged changes and pushing them
directly to `origin/main`.

This command intentionally bypasses pull-request review by design. Use it only
when direct-to-main delivery is appropriate for the change and repository
policy. It does not create a branch, stage files, rewrite `origin`, or manage
credentials.

## Prerequisites

1. Check out the local `main` branch.
2. Configure `origin` to the GitHub repository that should receive the push.
3. Stage only the files intended for this commit:

   ```sh
   git add path/to/file another/file
   ```

4. Ensure the worktree has no other tracked, deleted, renamed, or untracked
   changes. The command refuses to mix staged work with unstaged work.
5. Ensure the shell's normal Git authentication can push to `origin/main`.
6. If signing enforcement is enabled, configure Git to sign and verify commits
   before running the command.

In Replit, an authenticated remote URL may be supplied through the workspace's
secure `GIT_URL` secret without printing or committing it:

```sh
git remote set-url origin "$GIT_URL"
```

Do not put the URL, access token, SSH key, or password in the repository.

## What the command does

Before changing Git history, it checks that:

- `--message` (or `-m`) contains non-whitespace text.
- the repository is on the `main` branch, not detached HEAD.
- `origin` exists and has a URL.
- at least one change is staged.
- there are no unstaged worktree changes or untracked files.
- the refreshed `origin/main` is an ancestor of local `main` (or does not yet
  exist for an initial push).

It then runs the supported repository validation, `pnpm run typecheck`. A
validation failure stops before commit and push. If validation succeeds, the
command creates one commit with the supplied message. When
`push.main.requireSigned` is `true`, it verifies that commit with
`git verify-commit` and refuses to push if the commit is unsigned or cannot be
verified. Otherwise, it runs the exact push target `git push origin HEAD:main`.

## Commit-signing policy

Signing enforcement is opt-in per Git configuration. To require a verifiable
signature for this command:

```sh
git config --local push.main.requireSigned true
```

The setting is deliberately separate from `commit.gpgsign`: the latter tells
Git how to create a signature, while the guarded command verifies the resulting
commit before it can reach `origin/main`. With enforcement enabled, configure
one of Git's normal signing modes before running the command. For example,
SSH signing requires:

```sh
git config --local commit.gpgsign true
git config --local gpg.format ssh
git config --local user.signingkey "$HOME/.ssh/id_ed25519"
git config --local gpg.ssh.allowedSignersFile "$HOME/.config/git/allowed_signers"
```

OpenPGP signing is also supported by Git's normal configuration:

```sh
git config --local commit.gpgsign true
git config --local gpg.format openpgp
git config --local user.signingkey "YOUR_KEY_ID"
```

Use a public allowed-signers file for SSH verification and a public keyring for
OpenPGP verification as appropriate for the signing mode. Keep private keys,
access tokens, passwords, and authenticated remote URLs outside the repository.
The setting accepts only the boolean values `true` and `false`; it is unset by
default for compatibility with existing local Git setups.

## Recovery

- **Validation failed:** fix the reported issue, restage the intended files,
  and rerun the command. No commit or push was made.
- **Signing verification failed:** configure `commit.gpgsign`, the signing
  format/key, and the verifier's public key configuration. The commit remains
  local and no push was made, so inspect it with `git verify-commit HEAD` before
  retrying.
- **Unstaged changes or no staged changes:** inspect `git status`, then stage
  exactly the intended set with `git add`. The command never stages the whole
  worktree for you.
- **`origin/main` diverged or the push was rejected:** stop and reconcile with
  the remote before retrying. A commit may already exist locally after a
  server-side rejection; inspect `git log` and do not create a duplicate
  commit blindly.
- **Authentication failure:** repair the Git credential or remote setup
  without pasting credentials into chat or committing them, then retry the
  existing local commit only after confirming the intended history.

The workflow leaves failed commits in place rather than rewriting history or
force-pushing. It never uses `--force` or `--force-with-lease`.