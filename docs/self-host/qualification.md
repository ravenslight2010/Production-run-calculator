# Self-hosting qualification and owning failure ledger

## Agent-owned execution

**Objective:** integrate the current Replit application into a Windows-first LAN
self-hosting candidate for 20 mixed browser clients, fresh-data import testing,
local advisory AI, WAN-loss operation and eventual safe updates from tested main.
**Owner:** Notion AI for this implementation; maintainer approves product/host,
release and merge decisions. This remains one owning self-hosting objective;
missing updater/host work is not being labeled complete or silently excluded.

**Relevant files:** `docker-compose.self-host.yml`,
`docker/Caddyfile.self-host`, `scripts/self-host/{config.mjs,update-policy.mjs,
Start-SelfHost.ps1,self-host.test.mjs}`, `.github/workflows/self-host-foundation.yml`,
`docs/self-host/*`, and the duplicate validation-task repair in `.replit`. Existing foundations inspected: base Docker/Compose,
`local-ai-deployment.md`, local provider implementation/tests, run-template
repository/tests, pinned dependency/toolchain config, branch histories and
relevant `.agents/memory/docker-*`, task-execution and verification guidance.

**User decisions:** actual Windows edition/hardware, facility hostname/subnet,
IANA timezone, model/vision quality and capacity, Windows/Docker licensing,
backup destination/retention, approved update schedule and maintenance UX.
Examples/defaults are not approvals. No request for production credentials,
production data, merge to main, or deployment is implied.

## Applicable safeguards and verification

Follow AGENTS.md/task-execution-rules/verify-before-commit; preserve auth/sync,
identity and Undo fences, API contracts and current Replit behavior. No production
DB access, repair, reset, import or data copy. First-install launcher refuses an
existing fixed database volume. No unattended destructive schema push. No
internet-exposed DB/model ports; protect bootstrap credentials and LAN CA keys.
No weakening TLS, firewall, execution policy or platform security.

### Test matrix and recorded outcomes

Local environment: Linux x86_64, **Node 24.21.0**, **pnpm 12.8.1**.
No Docker daemon, PowerShell or physical target devices available locally.

| Check / material variant | Status | Evidence / next action |
| --- | --- | --- |
| Frozen dependency install | PASS | `CI=true pnpm install --frozen-lockfile`; lockfile unchanged |
| New setup/update safety contracts | PASS | 45 Node tests: generated local-only secrets, exclusive creation, invalid inputs, digest/repo/channel restrictions, absent/stale/future/cross-install receipts, timezone/DST, lock/activity/rollback prerequisites, window boundaries |
| Existing run-template behavior | PASS | Existing `runTemplatesRepository.test.ts`: 30 tests |
| Existing local AI adapter behavior | PASS | Existing `client.test.ts`: 11 tests; mocked unit behavior, not actual model quality/performance |
| Authoritative workspace typecheck | PASS | `CI=true pnpm run typecheck`, after installing missing ShellCheck 0.11.0; exited 0 |
| Changed Node module syntax | PASS | Executed through focused tests |
| Repository workflow policy + actionlint | PASS | `pnpm run check:workflows`; all 15 workflows valid after repairs below |
| PowerShell parser | PASS in Windows CI | Launcher parses on windows-latest; not executed against real host/ACLs |
| Native Windows ACL/runtime behavior | NOT RUN | Requires actual host rehearsal |
| Docker Compose config | PASS in Linux CI | `docker compose config --quiet`; services NOT started |
| Fresh install, import and empty-state safety | NOT RUN | Needs disposable intended-host DB, representative approved import files and first-manager flow |
| Normal restart with WAN disconnected | NOT RUN | Cache container images/models, disconnect WAN only, verify app/AI/login/imports/live sync with LAN intact |
| Midnight reset: local day / no clients / offline clients / DST | NOT RUN | Inspect actual reset ownership and emit authenticated completion receipt; setting TZ alone is not evidence |
| Desktop Chromium/Edge, phone, tablet portrait/landscape | NOT RUN | UI unchanged by new files but deployment/trust/session/offline acceptance required |
| WebKit / physical iOS Safari/PWA | BLOCKED | No device connection or LAN certificate trust rehearsal; browser emulation would not prove physical behavior |
| Physical Android Chrome / Windows host | BLOCKED | Requires target devices; not substituted by Linux unit tests |
| Twenty active mixed clients + local AI + other Windows work | NOT RUN | Measure sync latency, memory, contention, overload behavior and inference queue before hardware/model choice |
| Image provenance, publishing and signature verification | MISSING | Implement tested main-only immutable release channel; current policy accepts trusted inputs only |
| Automatic scheduling/staging/switch/rollback | MISSING | No scheduler/updater enabled; implement after actual receipts/backups and rehearsal |
| DB + config + CA backups, restore and off-host copy | MISSING | Implement and restore-test against disposable DB before real data |
| Main/Replit conflict reconciliation | BLOCKED | Two-file three-way conflict; final PR is draft, not merge-ready; no merge performed |
| Self-host foundation CI | PASS on code commit | Windows/Linux contracts, Windows parser, Linux Compose config; run 40817896685 |
| Full final PR CI / mergeability | BLOCKED | Draft has two-file merge conflicts; docs-only tip has no full CI run. CodeRabbit skipped, not a test pass |

### Failure ledger (including repaired findings)

1. **Missing ShellCheck** caused the first root typecheck to stop with exit 127.
   Installed official ShellCheck 0.11.0 locally; reran the exact root typecheck
   successfully. No repository check weakened. Status: **RESOLVED**.
2. **No authenticated Git push** in local shell. Used the connected GitHub file
   API for feature-branch commits instead; no credentials extracted or logged.
   Status: **RESOLVED for text file publishing**, not a two-parent merge facility.
3. **Main/Replit conflict** in two run-template files. Preserve current Replit
   code and 30 tests; do not regress identity/Undo fences. Auxiliary PR #141 was
   closed without merging and temporary alignment reverted. Status: **BLOCKED**;
   maintainer approval needed before feature-branch-only ancestry merge/resolution.
4. **Base Compose tied normal startup to force schema push; local-AI overlay
   tied startup to online pulls.** New isolated stack removes those dependencies,
   separates explicit fresh-only initialization and model preparation. Unit/static
   contract checks pass; Docker runtime is still **NOT RUN**.
5. **Initial environment mismatch** (sandbox Node 24.22.1 vs pinned 24.21.0).
   Downloaded official pinned x64 build, verified against official SHA256 sums,
   installed frozen dependencies, ran checks with pinned executable. **RESOLVED**.
6. **No local Docker/PowerShell/physical client environment.** Do not call this
   deployable/qualified. New CI adds parser/config tests, but target-host and
   physical-client drills remain **BLOCKED / NOT RUN**, owner maintainer + agent
   with authorized host access.
7. **Updater prerequisite implementations absent.** Safety policy is useful
   executable groundwork, not a substitute for real receipts/signatures/backup.
   Status: **MISSING**, owner this self-hosting objective, next milestone is tested
   artifact + backup/reset/maintenance evidence contracts, then staged switching.
8. **Private LAN trust and external-service inventory unqualified.** New Caddy
   requires managed root trust; removed external CSP exceptions may disable a
   feature still depending on QR/image/font services. Status: **NOT RUN**;
   audit and replace WAN-dependent features, verify browser network traffic and
   local vision capabilities before production acceptance.
9. **Interrupted initialization has no resumable recovery protocol.** Exclusive
   credentials/volume guards intentionally refuse a retry instead of guessing
   whether data is disposable. Status: **MISSING** for production, preserve
   evidence and implement an explicit reviewed recovery state machine.

10. **Workflow policy caught new lane omissions**: required top-level concurrency
    and human-readable action version comments. Added both, kept immutable SHA
    pins and read-only permissions; reran all-workflow actionlint successfully.
    Status: **RESOLVED**. No publishing authority added.
11. **Existing Replit Project workflow launched both release:standard and
    test:client**, violating its existing single-owner workflow topology guard.
    Removed only the redundant Project test:client task; standalone test:client
    remains available. This repair is confined to the feature branch, with no
    live Replit config change. Workflow guard now passes. **RESOLVED**.
12. **Current GitHub publication policy prohibits registry pushes/signing-token
    write capability** (`scripts/src/check-workflows.sh`). Future self-hosted
    artifact publishing needs an explicitly scoped policy change and approved
    trust/release design, without changing the Replit production publishing
    authority. Guard was not weakened here. **BLOCKED** for release publishing.

13. **Connected write request exceeded the 65,536-byte confirmation limit**
    when including the existing large codex-fixes log. No write executed. Moved
    the new entry into the topic-specific `.agents/memory/windows-lan-self-hosting.md`
    instead of rewriting the large unrelated log. **RESOLVED** via smaller payload.

14. **Replit advanced during the task** to
    `1bac34a4acf7f916d858e6e072540e9df361e26b`: four commits / 142 paths
    since the initial source snapshot. Recorded changed scopes, not imported
    unreviewed into the tested candidate. Status: **BLOCKED before merge**;
    owner maintainer + agent, next action approved feature-branch-only integration
    of latest Replit and main, resolve conflicts, rerun checks.
15. **Initial remote-verification fetch lacked a tracking refspec** for the new
    feature branch; verification failed before index alignment. Re-fetched with
    explicit refs, verified all 12 published files byte-for-byte, aligned only the
    agent-owned local branch/index without discarding working files. **RESOLVED**.

CI evidence: [Self-host foundation run 40817896685](https://github.com/ravenslight2010/Production-run-calculator/actions/runs/40817896685).
Both Windows/Linux jobs succeeded on code commit
`1f110f4b2e2af839a8d2f39f3b7d6d75df54b51c`; no Docker services started.

**Decision: NO-GO for production, NO-GO for automatic updates, draft PR only.**
Passing unit/type checks is not permission to merge, publish or operate real data.
