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
