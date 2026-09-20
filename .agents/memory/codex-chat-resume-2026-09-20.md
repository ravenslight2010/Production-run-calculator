# Codex Session Resume — 2026-09-20

Chat-context recovery note for the 2026-09-20 session on this repo. Written because
cross-session chat memory was unavailable; future sessions should read this before
re-asking "what were we working on". See also `codex-branch-convention.md`.

## What happened this session

1. User asked to catch up on the Production Run Calculator after a loss of agent memory.
   No local chat history existed for this project (fresh environment).
2. Cloned `https://github.com/ravenslight2010/Production-run-calculator` to
   `/root/Documents/Codex/2026-09-20/hi/production-run-calculator`.
3. Read AGENTS.md, `.agents/memory/` (codex-fixes.md, claude-bugs.md, MEMORY.md),
   recent commits, open issues/PRs, and the research/backlog docs.
4. Analyzed the `Replit` branch: 5 behind / 121 ahead of `main`, merge-base
   `afa30029` (2026-09-16); PR #64 merged into `Replit` only (verified Replit-specific).
5. Compared planning corpus: `main` holds the 09-18 authority; `Replit` holds the newer
   09-19 reliability/inventory research and re-prioritized backlog.
6. User set the operating model: `main` = Render deploy only, `Replit` = primary app
   coder, Codex works on its own branch.
7. Created + pushed `codex/workspace` (based on `origin/Replit` @ `3840f5d3`).
8. Set up GitHub auth via device flow (`gh` logged in as `ravenslight2010`,
   `gh auth setup-git` done; push verified).
9. Wrote `codex-branch-convention.md` (branch roles/auth/divergence) and this file.

## Where we left off

- Next step was undecided: pick the first coding task.
- Options on the table:
  - Reconcile the planning corpus (bring `Replit`'s 09-19 docs/backlog to `main` via PR).
  - Review/promote `Replit`'s sync-contract + staged-supply work (large diff: 176 files,
    ~22.7k insertions — needs careful review; includes unverified `sea-salt-heal` evidence
    deletion).
  - Battery/perf follow-up: extract `useVisibilityAwareInterval` from `useClock`, apply to
    `CanonicalRunViewCard.tsx`, then `InventoryTab.tsx` countdowns
    (docs/battery-performance-research.md, `main`-side doc).
  - Dependabot bumps (#66–#78) — none urgent.

## Verified facts to avoid re-deriving

- Main history since 09-16: PR #62 (`860d99ea`), PR #63 (`f9e1cf85`), PR #65 (`8885c9a5`).
- Replit workstream additions: `lib/sync-contract`, `stagedSupply.ts`, manual-section
  edit/lock types, `syncPeerFrame`/`syncRecoveryPayload`/`syncUnchangedResponse`,
  `streamSyncEventsParams`, `backgroundOperations` schema field.
- `docs/superpowers/plans/` is identical across branches.
- Claude bug tracker: no open bugs (as of 2026-09-20).
- AGENTS.md rules: check memory files before changes, log fixes after, never push to
  `main` directly, use branches + PRs, CI must pass.

## Merge follow-up (same session)

- Integrated `origin/main` into `codex/workspace` (merge `8b9d9aed`); details and
  conflict resolutions in `codex-branch-convention.md` ("2026-09-20 update").
- Branch `codex/workspace` is now a superset: Replit workstream + main's route/heartbeat
  restore (PR #62) + both planning corpora.
