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


## Read-only first-install preflight

Added `scripts/self-host/preflight.mjs`, canonical reviewed-input pin re-export
and focused tests. Windows fresh initialization now checks Node/configuration,
reviewed report digest and real source prerequisites BEFORE ACL/credential/image/DB
effects; CheckOnly is read-only. Cached normal restart does not require build inputs.
No production source/promotion checks or private workbook tests weakened.
61 combined Node tests passed locally; see
`docs/self-host/preflight-and-build-boundary.md` for the current blocked input
result and proposed separate fresh-install build-identity contract. A fresh DB
is not approval to fabricate existing production review evidence.
Native Windows/Linux foundation runs 41203690930 and 41203685073 passed on
cb10c806 after explicit native-exit handling repair. Windows executes the blocked
initializer and verifies Docker is not reached and no state directory exists.
Initial Windows failure is retained in the preflight report ledger; actual
installation and full/private-input CI remain unqualified.


## Approved fresh-profile identity checkpoint (not runtime activation)

Donald approved separating fresh self-host builds from Replit's historical audit
material. Added `self-host-fresh-source-v1` to the shared source fingerprint
engine with an explicit, separate policy; default production required inputs,
source selection and synthetic fingerprint bytes are unchanged. Fresh includes
Docker/deployment/installer source inputs, retains source/Git/symlink/budget
checks, and does not require retained historical audit/pool-approval assets.

`scripts/self-host/build-identity.mjs` has separate strict fresh validators,
preparation/expectation paths, domain-separated record digest and two-stage
output sealing. Reuses only bounded record IO and output fingerprinting from
existing identity code; production validators remain production-only. Fresh
records and mixed stages fail production validators, preparation/finalization,
release assessment and live source-handoff verification. No environment flag
converts profiles or grants legacy repair authority.

31 new contracts / 127 combined Linux tests passed, plus 15-workflow policy and
lint. The full authoritative root typecheck rerun passed, exit 0. Initial new Dockerfile typing failure repaired without weakening checks.
A local lint wrapper invocation mistake caused recursion/memory pressure and
killed one root typecheck; cleaned up processes and reran the full command.
See `docs/self-host/fresh-build-profile.md` for final root/hosted evidence and the
complete owning-task ledger. Keep initial failures visible, not relabeled pass.

IMPORTANT: this is identity infrastructure only. Existing API/web build commands,
Docker targets and launcher/preflight still choose the production contract and
refuse missing inputs. Do not enable fresh runtime before compile-time legacy
repair/capture restrictions, honest health/status/schema, runtime/migration
packaging/privacy tests and installer qualification. Fingerprinting tracked
legacy source is NOT proof that its private payloads are absent from a build.
No API generated files changed yet; large generated aggregates exceed connected
write-request bounds, so establish an authorized publication route before schema
changes. Full CI/private workbook/Windows/device/import/offline/update evidence
is still open in the same objective; PR #142 remains draft and deployment NO-GO.
