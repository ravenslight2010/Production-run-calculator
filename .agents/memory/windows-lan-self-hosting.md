---
name: Windows LAN self-hosting qualification
description: Isolated Windows LAN stack and guarded updater foundation; not production qualified.
---

## Windows LAN self-hosting foundation (Notion AI)

Added an isolated qualification-candidate Compose stack, private first-install
configuration/Windows launcher, internal-CA Caddy configuration, and pure update
safety-policy tests under `scripts/self-host/`. Normal restart does not migrate
or pull models; core API has no local-AI startup dependency. Existing Replit
identity/Undo run-template safeguards are retained, not replaced with main's
older scope-only implementation. See `docs/self-host/README.md`, `branch-audit.md`
and `qualification.md` for exact scope, all-head review and unresolved blockers.
This is not a production-ready Windows installer or automatic updater.
The existing workflow guard also found a duplicate Project test:client launch
in `.replit`; removed that redundant task, preserving the standalone command.
Added required concurrency/action-version comments on the new read-only CI lane.
Root typecheck, 45 new Node checks, 30 existing run-template tests, 11 local-AI
adapter tests and all-workflow policy/actionlint passed locally with pinned tools.
Native Windows/Docker/device/automatic-update qualification remains blocked.


## Approved refreshed upstream integration

Donald approved feature-branch-only Replit/main integration. Captured Replit
024a87633d7c23006dba9a109c0720712d039e9c (51 commits past original baseline)
and main 486d53b43189c920a3025b3cb90aaf9543e826a2 are now ancestors of the
feature branch. Main resolution preserves exact current Replit run-template
files and has zero content change. PR #142 source conflicts resolved; remains
draft. No main/Replit mutation or deployment. See
`docs/self-host/integration-2026-10-31.md` for current evidence and full ledger.

Pinned root typecheck, 45 self-host tests, 30 templates, 28 provider tests,
185 DB-free server tests and 15-workflow validation passed. Full calculator
suite: 3,776 passed, 23 failed due to absent workbook paths, 1 skipped. Reviewed
build inputs are absent; do not fetch/recommit historical private material or
weaken source policy. Full CI/build/browser and Windows/device qualification
remain unresolved. Earlier first-pass counts/blockers above are historical.
