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


## Native fresh-identity checkpoint validation and publication boundary

Added a bounded escaped CI reporter plus three synthetic diagnostic contracts
because connected tools exposed job annotations but not logs. Windows revealed
an existing literal-root comparison problem: Git/Node spelled the same temporary
root differently, while canonical roots, modes, blobs and source sets matched.
The Git probe now accepts differing Windows spellings only for exactly equal
native realpaths; Linux remains strict. No prefix/case-folding guess, forged SHA
or skipped provenance assertion. Added repository-subdirectory negative coverage.
The nested reporter test uses a file URL and minimal child environment (no parent
NODE_TEST_CONTEXT/credentials) so failures retain their real nonzero exit.

Final code 59ab3711b288f468723e1d3893c1ffacfc07b6bc: Windows+Linux foundation
jobs PASS in run 41207331604. Local 130 combined contracts, all 15 workflow checks
and authoritative root typecheck PASS. Initial Windows/reporting failures and
local lint/OOM incident remain in `docs/self-host/fresh-build-profile.md`.
The two explicit Windows symlink-privilege exceptions are covered on Linux.
These passes validate identity/refusal paths only, not a working fresh runtime.

Next owner-controlled authorization: normal GitHub device-code sign-in for git
push. No authenticated CLI route exists locally; API generated aggregates are
671,550/317,535 bytes, larger than the connected writer's 65,536-byte request
boundary. Do not hand-edit generated outputs or add write-enabled workflow tricks.
Runtime/schema/legacy repair/capture/package/installer work is still incomplete,
not a deferred separate task; request authorization without asking for tokens in
chat. PR #142 remains draft; full-app/private-input/device qualification and
main merge/deployment remain NO-GO. No main/Replit writes or deployment occurred.

## Authorized fresh runtime continuation

Git credential access was recovered through the existing approved memory; normal
feature-only git publication is available. Earlier device-code requirement is
historical, not a current blocker. Never copy the credential here or into logs.

Fresh runtime is now implemented with compile-time exact aliases, rejecting
esbuild graph guard, honest audit not-applicable contract/UI, official generated
OpenAPI/Zod output, strict fresh runtime build-info, dedicated Dockerfile/ignore
and migrate/api/web targets. Production legacy definitions/fingerprints and
publication validators retain their authority/behavior. Windows fresh preflight
explicitly selects the new profile; default production checks remain strict.
Found/fixed missing generated AUTH_TOKEN_SECRET; four independently generated
secrets are now tested. Existing initialized candidates are not auto-rewritten.

Local: frozen install/codegen, root and explicit library TypeScript checks,
151 combined Node contracts, 22 focused API tests, 3 focused UI tests, nine Zod
contract tests, actual matching fresh API/web build and 15 workflow lint checks
PASS. Chromium isolated panel layout PASS desktop/phone/tablet portrait/landscape;
WebKit binary missing. Static panel evidence is not a manager auth journey.
Hosted Docker qualification is added but result pending at initial publication.
Full failure ledger/current gate matrix: docs/self-host/fresh-build-profile.md.
No Docker/psql/pwsh locally. Imports/20-client load/real Windows host/device trust,
model qualification/backup restore/updater remain same-objective open evidence.
No merge/main/Replit/live deploy authorized by these implementation passes.

## Fresh runtime qualified checkpoint (c0108045)

Hosted foundation run 41211885502 PASS: Windows/Linux safety contracts plus real
fresh Docker migrate/api/web build and isolated core readiness without WAN/AI,
manager signup/workspace, explicit unavailable audit/capture, final-package
privacy, zero legacy markers and cached API restart with unchanged identity.
Two initial probe defects (stronger cache directives and global OPTIONS CORS 204)
were corrected without changing production cache/CORS policy; DB-free mounted
regressions now included. Focused API count is 23 PASS, root typecheck PASS.
Committed-source local fresh build has matching sealed API/web identities and
verified source binding; this does not authorize a release or automatic update.

Also repaired inherited synthetic undeclared external-import fixtures and narrow
trap-only ShellCheck annotations. Hosted routines now pass dependency/shell and
31 operational-skill checks, then block on the real missing retained Malted Barley
workbook. Original full web suite still has 23 missing-workbook failures. Default
production build/Docker/rollback/release/browser preparation remain blocked by
production source prerequisites. Local chmod(000) files remain readable in this
sandbox; no unreadable-checker test was skipped/weakened. WebKit installed but
cannot launch with missing Amazon Linux native dependencies. Chromium panel
fixtures corrected for UTF-8 and pass five desktop/phone/tablet viewport checks;
not an authenticated journey or physical-device result.

Same-objective open work: actual Windows host/WSL2/reboot/ACL and LAN CA trust,
representative imports, chosen-hardware ~20-client/model measurements, verified
restore, signed safe updater implementation. Updater policy remains planning
only. PR #142 stays draft, main/Replit/live deployment NO-GO. Do not ask for a new
GitHub login: approved transient git publication route works. Full retained
failure ledger: docs/self-host/fresh-build-profile.md.

## PR #142 restricted CI input channel

Donald approved the narrowly scoped PR-only channel. New environment
pr-142-reviewed-test-inputs: exact PR merge ref, required owner review, admin
bypass disabled, new authorization capability, reviewed-head variable. No
protected-main secret/policy changed. Exact fixed historical Git blob manifest
(51 workbooks + canonical report), bounded hashes/private files/cleanup, no raw
payload commits/artifacts/cache exports. Production source policy unchanged.
Rollback copies the exact report pair into both disposable worktrees.
Typecheck PASS, 23 input + 7 route contracts PASS, workflow/dependency/frozen
install/rollback unit PASS; hosted CI pending. Registration CI also found
cleanup-cases GET missing from the existing manage-staff read inventory; fixed
the declaration/test only, no permission/Gold enablement change. Main's legacy
input provisioning remains unresolved by the PR-only grant. Do not merge while
required gates or this known post-merge issue remain unresolved.
