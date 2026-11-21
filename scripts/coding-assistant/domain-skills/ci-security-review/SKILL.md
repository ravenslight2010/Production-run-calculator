---
name: ci-security-review
description: "Perform a read-only security review of CI/CD workflows, especially GitHub Actions, for unsafe permissions, untrusted input interpolation, secret exposure, dependency pinning, artifact/cache poisoning, privileged pull-request execution, and deployment boundary mistakes. Use when adding or changing workflows, release automation, repository bots, or CI credentials, and before trusting an external workflow."
---

# CI Security Review

Review CI as privileged production code. Default to read-only inspection; do not trigger
workflows, change repository settings, rotate credentials, or test exploit payloads unless
the user separately authorizes the action.

## Scope

Inventory:

- workflow files and reusable workflows;
- triggers and event types;
- job and workflow permissions;
- environments, approvals, secrets, OIDC, and deployment credentials;
- third-party actions and reusable workflow references;
- artifacts, caches, generated code, and scripts executed by runners.

Use the live repository files as source of truth. Do not infer safety from a badge or a
successful prior run.

## Review checks

### Untrusted execution

- Treat branch names, commit messages, issue/PR text, labels, matrix values, dispatch
  inputs, artifact contents, and fork-controlled files as untrusted.
- Do not interpolate untrusted expressions directly into `run:` shell scripts. Pass values
  through constrained environment variables and validate before use.
- Flag `pull_request_target` or privileged reusable workflows that check out or execute
  fork-controlled code.
- Keep validation of untrusted contributions separate from jobs that can access secrets,
  write tokens, environments, releases, or deployments.

### Permissions and credentials

- Set the smallest explicit `permissions` at workflow or job level.
- Flag write permissions where read is sufficient.
- Limit secrets to the jobs and environments that require them.
- Do not print, upload, cache, or pass secrets to untrusted processes.
- Prefer short-lived, audience- and repository-scoped OIDC credentials when the deployment
  platform supports them; do not assume OIDC is automatically safe.
- Require protected environments or human approval for high-impact production actions
  where the current release process expects them.

### Dependencies and provenance

- Pin third-party actions and reusable workflows to immutable commit SHAs when feasible.
  Record the human-readable release being pinned.
- Treat moving tags and branches as mutable.
- Use lockfiles and deterministic install modes.
- Review scripts downloaded or generated during CI before execution; avoid pipe-to-shell.
- Verify artifact source, producer workflow, revision, and integrity before privileged use.

### Cache and artifact boundaries

- Do not restore untrusted caches into privileged jobs.
- Include trust boundary, platform, dependency lock, and relevant inputs in cache keys.
- Prevent fork jobs from overwriting caches or artifacts later consumed by trusted jobs.
- Bound artifact contents and retention; exclude credentials, `.env` files, Git history,
  browser auth state, and unsanitized evidence.
- Apply `evidence-hygiene` to logs, screenshots, traces, HAR files, and reports.

### Release and deployment

- Bind release artifacts to the intended revision.
- Prevent concurrent stale deployments when ordering matters.
- Keep build and deploy authority separate when practical.
- Do not let a successful build bypass required release evidence or production approval.
- Route final readiness through `release-checklist` and `production-go`.

### GitHub repository publication

Distinguish repository publication from application deployment:

- **First-public review:** before changing a private repository to public, inspect the full
  reachable Git history, branches, tags, releases, issues, workflows, submodules, large
  files, generated artifacts, and documentation for secrets or internal-only material.
  Scanning only the current working tree is insufficient.
- **Version-release review:** identify the exact tag/commit, release object, notes, assets,
  provenance, and automation that will publish. Confirm the release does not expose debug
  bundles, browser auth state, `.env` files, source maps with sensitive content, or
  unrelated artifacts.
- Check default-branch protection, required checks, environment approvals, release/tag
  mutation authority, and whether automation can replace an existing release silently.
- Separate assessment from mutation. Read-only findings do not authorize changing
  visibility, protections, tags, releases, or repository settings.
- Before an approved mutation, present the intended change, repository/ref, consequences,
  rollback path, and post-change verification. If the state changes between assessment and
  mutation, stop and reassess.

Treat public exposure of a committed secret as credential exposure even if the file is later
deleted. Remove it from reachable history where appropriate and rotate/revoke the credential;
history cleanup alone does not invalidate it.

## Report format

For each finding state:

- severity: critical, high, medium, low, or informational;
- workflow/job and triggering event;
- trust boundary and capability at risk;
- evidence with secret values removed;
- plausible impact;
- smallest safe remediation;
- whether validation can be read-only or requires explicit mutation approval.

Lead with critical and high findings. Distinguish confirmed exposure from a risky pattern.
Do not include working exploit payloads, secret values, or instructions for abusing runners.

## Completion checklist

- [ ] All workflow triggers and reusable-workflow edges were inventoried.
- [ ] Effective permissions and secret access were evaluated per job.
- [ ] Fork/untrusted input cannot execute with privileged credentials.
- [ ] External actions and workflow references have reviewed provenance and pinning.
- [ ] Caches and artifacts do not cross trust boundaries unsafely.
- [ ] Release artifacts are revision-bound.
- [ ] Repository-publication scope and full-history exposure were checked when applicable.
- [ ] Evidence is sanitized.
- [ ] No workflow was triggered or repository setting changed during a read-only review.
