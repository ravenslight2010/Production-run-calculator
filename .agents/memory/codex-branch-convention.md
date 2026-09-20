# Codex Branch Convention & Workspace Auth (est. 2026-09-20)

Source of truth for how this repo is worked by multiple agents. Read before pushing
anything or picking a base branch.

## Branch roles

- **`main`** — Render deploy only. Protected; never commit/push directly. This is NOT
  the coding base. PRs #62/#63/#65 were merged here from other branches.
- **`Replit`** — primary app coding branch (Replit agent's workstream). Carries the
  unmerged sync-contract / staged-supply / peer-lock work and the 2026-09-19 planning
  corpus. Replit agent opens PRs against `main` from it or sibling branches.
- **`codex/workspace`** — Codex working branch (this session, 2026-09-20). Created from
  `origin/Replit` head `3840f5d3` (PR #64 merge). All Codex code changes land here
  first; promote to `main` only via a PR when the user asks.

## GitHub access (this machine)

- `gh` authenticated as **`ravenslight2010`** via device flow (2026-09-20).
- `gh auth setup-git` installed the git credential helper so plain `git push` works.
- Credential helper: `credential.https://github.com.helper !/usr/bin/gh auth git-credential`.
- Local clone: `/root/Documents/Codex/2026-09-20/hi/production-run-calculator`.

## Divergence snapshot (2026-09-20, verified)

- Merge-base of `main` and `Replit`: `afa30029` (2026-09-16, "Replit round-2 CI reconciliation").
- `Replit` is ~5 commits behind `main` and ~121 commits ahead.
- `main`-only: PR #62 (`860d99ea` route mounts/heartbeats), PR #63 (`f9e1cf85` research
  docs), PR #65 (`8885c9a` battery docs) + 2 battery-audit doc commits.
- `Replit`-only includes: PR #64 (`3840f5d3` TS-boundary + flaky SSE test fixes — verified
  Replit-specific, NOT lost fixes for `main`), new `lib/sync-contract`, `lib/live-calc/src/stagedSupply.ts`,
  manual-section-edit/lock API types, syncPeerFrame/syncRecoveryPayload/syncUnchangedResponse,
  `backgroundOperations` schema field, live-station/live-tab extraction, peer edit locks,
  sauce/frontline staged-supply automation, 2026-09-19 research corpus.
- Planning docs diverged: `main` = 09-18 baseline authority
  (`docs/improvement-research-2026-09-18.md`); `Replit` = 09-19 authority
  (`docs/sync-reliability-unified-plan-2026-09-19.md` +
  `research/additional-domain-research-synthesis-2026-09-19.md`).
- **Watch item:** `Replit` deletes `release-evidence/sea-salt-heal-production-verification.md`;
  confirm intent before promoting any `Replit` work to `main`.
- Open GitHub items are all Dependabot bumps (#66–#78), none functional.

## Workflow rules

1. Before any change: read `.agents/memory/codex-fixes.md`, `.agents/memory/claude-bugs.md`,
   AGENTS.md, and relevant memory files.
2. Code on `codex/workspace`, commit locally, push to `origin/codex/workspace`.
3. Promote to `main` only via PR (main is protected; CI must pass).
4. Log every fix in `.agents/memory/codex-fixes.md` per AGENTS.md.

## 2026-09-20 update — main integrated into codex/workspace

- Merge `8b9d9aed` brought PR #62/#63/#65 from `main` into `codex/workspace`
  (merge-base was `afa30029`).
- Auto-merged clean: `sync.ts`, `sync.integration.test.ts`, `importer-redesign-plan.md`,
  `.agents/memory/idea-backlog.md`.
- Resolved conflicts: kept Replit's updated versions of the parallel 09-18 planning docs
  (`improvement-research`, `further-research`, `capability-research-pack`,
  `sync-system-improvements-plan`) since they reflect the 09-19 implemented state;
  kept both MEMORY.md registry blocks; `ci-pinned-evidence.md` = ours (superset).
- Grafted main's unique idea-backlog sections into ours as §18 Auto-Track, §19 Incident
  Notifications, §20 Merge-Suggest (Replit's own §17 is Residual Observability).
- Restored main-only docs Replit had deleted: `ai-system-research.md`,
  `autotrack-coordination-research.md`, `battery-performance-research.md`,
  `incident-notifications-research.md`, `merge-suggest-research.md`.
- Verification on this machine: full lib typecheck + TS v6 boundary + recovery audit +
  api-spec checks + api-server typecheck all green. Web `pretypecheck` cannot run here
  (arm64 sandbox; lockfile pins `lightningcss-linux-x64-gnu` — do NOT regenerate the
  lockfile on this box, it feeds CI pinned-evidence hashes). DB-backed suites need
  `DATABASE_URL`/CI per `post-merge-setup.md` and `integration-test-db-binding.md`.
