# Repository cleanup manifest and report

Date: 2026-08-25  
Scope: tracked repository files and configured workflows  
Task: audit and clean repository

## Cleanup manifest

Only entries marked **removed** were approved for deletion. The confidence
rating describes confidence that the item is unused and safe to remove, not
the importance of the surrounding subsystem.

| Candidate | Classification | Evidence and source-of-truth check | Validation protection | Outcome |
| --- | --- | --- | --- | --- |
| `scripts/src/hello.ts` | Safe to remove; high confidence | The file only printed a scaffold message. Its only reference was the `hello` script entry in `scripts/package.json`; no workflow, documentation, CI, or source import invoked it. | `pnpm --filter @workspace/scripts run typecheck`; repository typecheck | **Removed** |
| `scripts/package.json` `hello` script | Safe to remove; high confidence | Removed atomically with its only implementation file. No current command or documentation referenced it. | Scripts typecheck and repository typecheck | **Removed** |
| `.replit` `evidence:operational` workflow and Project entry | Safe to remove; high confidence | Exact duplicate of the retained `operational-skill-evidence` workflow and command. | Project workflow retains the canonical operational evidence command; operational evidence check | **Removed** |
| `.replit` `startup:clean` workflow and Project entry | Safe to remove; high confidence | Exact duplicate of the retained `check:clean-start` workflow and command, including all port overrides. | Project workflow retains clean-start; clean-start validation | **Removed** |
| `.replit` `validation:spec-reconcile` workflow and Project entry | Safe to remove; high confidence | Exact duplicate of retained `test:spec-reconcile`; the package test and documented release matrix remain unchanged. | Spec-reconcile test and typecheck | **Removed** |
| `.replit` `validation:corpus` workflow and Project entry | Safe to remove; high confidence | Exact duplicate of retained `test:corpus`; the package test and documented release matrix remain unchanged. | Corpus test and typecheck | **Removed** |

## Inventory and retained candidates

The following areas were searched for references, package ownership, generated
sources, workflow callers, and documentation links:

- Root/package manifests, workspace membership, and lockfile package entries.
- `.replit`, GitHub workflows, release-check tooling, and release evidence
  verification.
- `scripts/src`, library packages, artifact packages, docs, skills, and tests.
- Tracked screenshots, release evidence, source-library workbooks, and
  generated API-client packages.

### Retained: review required (excluding retired audit helpers)

The first entry below records the pre-decision inventory; the historical audit
decision at the end of this document supersedes it.

- The retired helpers `scripts/src/audit-parse.mts` and
  `scripts/src/audit-compare-cheese.mts` had
  no current package command or CI caller, but they reproduce the
  source-library-vs-live-data audit recorded in
  `attached_assets/source-library/AUDIT-REPORT-2026-07-18.md`. They are
  one-off audit tooling with temporary-file inputs/outputs and were retained
  until that historical audit is explicitly superseded.
- The broader `Project` workflow still runs some checks that release standard
  also covers. Those are not exact command duplicates: release standard uses
  deliberately partitioned API and release evidence gates. They were retained
  to avoid changing the default run-button coverage.
- The current release evidence set, including browser evidence, reports,
  screenshots, and logs, was retained. Evidence age or lack of source-code
  references is not sufficient reason to delete it, and the release evidence
  checker defines its own retention boundary.
- `attached_assets/source-library/` and all customer/source workbooks were
  retained as production inputs and audit provenance.
- `artifacts/mockup-sandbox`, the web/mobile parity sources, generated API
  clients, tests, snapshots, and documentation were retained because they are
  referenced by builds, checks, parity conventions, or release evidence.
- `.local/custom_skills`, `.local` state, dependency caches, `dist` output,
  and other ignored workspace output were not treated as repository cleanup
  candidates. They are environment-managed or ignored rather than stale
  tracked files.
- Active Gemini benchmark/design work and other active-task files were not
  modified.

## Validation record

The cleanup preserves all canonical package commands and removes no test,
release, generated-source, input, or production-data file.

| Check | Result |
| --- | --- |
| `pnpm --filter @workspace/scripts run typecheck` | PASS |
| `pnpm --filter @workspace/spec-reconcile run test` | PASS (33 tests) |
| `pnpm --filter @workspace/corpus-harness run test` | PASS (11 tests) |
| `pnpm run typecheck` | PASS, including recovery and generated API checks |
| `CLEAN_START_API_PORT=18081 CLEAN_START_WEB_PORT=18082 CLEAN_START_MOCKUP_PORT=18180 pnpm run check:clean-start` | PASS |
| `pnpm --filter @workspace/scripts run check-operational-skill-evidence` | PASS |
| `pnpm --filter @workspace/scripts run check-model-bump` | PASS |
| `pnpm run audit:prod` | PASS; no known production vulnerabilities |
| `pnpm --filter @workspace/scripts run check:release-evidence` | FAIL: the retained report is current but records two API integration infrastructure timeouts, so the verifier correctly rejects it |
| `pnpm run check:clean-start` without isolated ports | NOT A PRODUCT FAILURE: default API port 8080 was already occupied by an unrelated process; the isolated-port run passed |

The release-evidence failure is recorded rather than bypassed or “fixed” by
deleting evidence. The evidence checker correctly rejects a revision-bound
report containing failed infrastructure gates, preserving the current
production-readiness evidence boundary. The completion validator also ran
standard and full release checks concurrently; standard encountered the same
two API integration timeouts, while full encountered a temporary shared
generated-output race. Neither failure is caused by the removed scaffold or
duplicate workflow definitions.

## Historical audit decision

The July 18, 2026 source-library audit is retained as the authoritative
historical record in
`attached_assets/source-library/AUDIT-REPORT-2026-07-18.md`. The two unreferenced
helpers that produced it are formally retired: they had no supported command
or CI caller, depended on an implicit working directory, and used untracked
`/tmp` production and parsed-data files. The production snapshot and invocation
contract were not retained, so rerunning them could not reproduce the report.

## Reversal

The normal repository checkpoint/history path reverses this cleanup. The
removed workflow blocks and `hello` scaffold are isolated, behavior-neutral
deletions; restoring the prior checkpoint restores them without a data
migration or production rollback.