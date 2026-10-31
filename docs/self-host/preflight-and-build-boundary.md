# First-install preflight and remaining build-input boundary

## Agent-owned execution

Owner: Notion AI, continuing the existing self-hosting objective and draft PR
#142. Objective for this change: explain real build blockers and stop Windows
first initialization **before** private state creation or host mutation when
those blockers are already known. Cached offline restart must not acquire a new
build-time dependency. Main/Replit/live publication remain untouched.

Affected files: `scripts/self-host/preflight.mjs`,
`reviewed-input-contract.mjs`, `preflight.test.mjs`, `Start-SelfHost.ps1` and the
read-only foundation workflow. No production source-policy/approval/release
checks or private fixture tests are modified.

## Applicable safeguards and verification

Read AGENTS/task execution/verification rules and current publish,
source-reconciliation evidence and pool-exception memory guidance. The source
library review is evidence for a specific existing production repair; it cannot
be fabricated or treated as the baseline data for a fresh installation.

The new preflight:

- Performs read-only local checks; does not invoke Docker, network, a database,
  model downloads, ACL changes, credential generation or repair/migration code.
- Requires exact project Node pin and optionally validates the selected LAN
  hostname, IANA timezone and first-manager username before setup effects.
- Reuses the **existing canonical reviewed-report SHA256 pin**, rejecting missing,
  mismatched, oversized or symlinked report inputs. There is no CLI/environment
  option for changing that pin. Test-only dependency injection is limited to
  programmatic synthetic fixtures; it is not used by the installer.
- Calls the real existing source-fingerprint prerequisite check. It does not
  fake a report, generate an approval manifest or seal/publish an identity.
- Emits bounded check IDs/status/error codes, never raw errors, source contents,
  argument values, environment variables, bootstrap credentials or full paths.
- Exits 2 when blocked. Even a ready result means **prerequisites only**;
  subsequent build/approval/runtime/release gates still apply.

Windows `InitializeFresh` invokes it before creating state, changing ACLs,
generating credentials, downloading images or touching the DB. `CheckOnly`
returns after source checks, without Docker. A routine restart skips preflight:
it still uses previously cached images/models and existing data offline.

### Run without setup effects

Any supported local checkout with pinned Node:

```text
node scripts/self-host/preflight.mjs --root .
```

Windows/PowerShell 7 source check:

```powershell
./scripts/self-host/Start-SelfHost.ps1 `
  -StateDirectory 'C:\ProgramData\RunCalculator-Test' -CheckOnly
```

This is not a test of Windows Docker/WSL2 startup, DNS, TLS trust, devices, imports
or deployment readiness. Do not interpret it as approval to install real data.

### Current checkout result

Read-only preflight returned **BLOCKED**, exit 2:

- Node version: exact project pin, PASS.
- Reviewed report: `approved-private-report-missing`.
- Build source: `source-prerequisites-missing-or-unsafe`.

No credentials or state directory were created by this check. Existing build
fingerprinting and report validation were not loosened to turn the result green.

### Validation / failure ledger

- Linux Node contracts: **61 tests passed**, including the original 45, on
  Node 24.21.0. Synthetic prerequisites exercise positive/negative checks without
  copying any operational report or workbook contents.
- Tests cover invalid setup/arguments, no CLI pin override, malformed/oversized/
  missing/symlinked files, wrong Node, privacy, no-mutation and restart gating.
- Workflow adds native Windows execution of a deliberately blocked initialization:
  a fake Docker function throws if reached, and a unique state path must remain
  absent. This proves the refusal path only, not ACLs or a working installation.
- Windows symlink-creation unit check is explicitly skipped when privilege would
  be required; Linux covers it. No Windows permission requirement is weakened.
- Workspace `CI=true pnpm run typecheck`: **PASS**, exit 0. Repository
  workflow policy/actionlint: **PASS**, all 15 workflows. Hosted foundation
  status is recorded in PR #142 after execution. Earlier full-suite missing-
  workbook failures remain unresolved; this does not replace those tests.
- Hosted log download returned HTTP 403 through the unauthenticated public API;
  connected GitHub tools do not expose a workflow-log reader. Check annotations
  are available but show only failed steps/exit codes. Owner/agent need an
  authorized log route before claiming every hosted root cause is understood.

Desktop/phone/tablet, portrait/landscape, Chromium/WebKit and physical Android/
iOS Safari/PWA behavior: **not run**, unchanged runtime/deployment qualification.

### Hosted Windows/Linux outcome and repaired CI finding

The first new native Windows refusal-path check failed while Linux passed
([initial run](https://github.com/ravenslight2010/Production-run-calculator/actions/runs/41203316741)).
Repaired explicit handling of the deliberately failing native command:
`Invoke-Checked` normalizes native error-action preference locally but still
throws every nonzero exit; the test resets the expected, handled exit code only
AFTER asserting the correct refusal and absent state directory. Unexpected
exceptions still fail and produce a bounded diagnostic category. No failure
check, privacy guard or state assertion was removed.

Code commit `cb10c8065e1df38bc147cebfd882a88bb45bf965` then passed both native
Windows and Linux jobs in [run 41203690930](https://github.com/ravenslight2010/Production-run-calculator/actions/runs/41203690930)
and [run 41203685073](https://github.com/ravenslight2010/Production-run-calculator/actions/runs/41203685073).
The Windows launcher refusal path executed successfully without Docker or state
creation. The deliberate symlink-privilege unit exception remains explicit on
Windows; Linux covers the symlink case. Workflow checks, 61 Linux Node tests and
the authoritative root typecheck were rerun successfully before the repair push.

This closes the newly introduced foundation CI failure; it does **not** close
the existing private-input/full-CI or actual installation/runtime blockers.

## Build architecture proposal (approved; implementation in progress)

Donald subsequently approved the fresh-profile separation. See
[`fresh-build-profile.md`](fresh-build-profile.md) for implementation, evidence
and remaining runtime/package blockers. The proposal below is retained as the
decision context; it is not a second approval request. The original installer
still refuses until the complete fresh runtime boundary is implemented.

There are two different absent input classes:

1. **Required by the current build:** reviewed production reconciliation report
   and its approval evidence. These are bound to Replit's existing production
   source-library repair. Both fingerprinting and API packaging intentionally
   require them; bypassing one check would not create a correct fresh build.
2. **Required by existing private-workbook tests:** approved source workbook
   bytes referenced by 23 currently failing calculator cases. They are not
   interchangeable with generated workbooks and should not be put in public Git.

Recommended next implementation: an explicitly separate **fresh self-host build
profile** with its own source identity and a genuinely empty installation
contract, while retaining all existing Replit production evidence requirements.
It must disable inapplicable legacy repair authority rather than fabricate its
successful completion, label its build scope accurately, and be rejected by
existing Replit production promotion checks. This affects identity validators,
API packaging, legacy repair endpoints, Docker build selection and regression
contracts; it is not a `SKIP_CHECK` or a renamed development build.

Alternative: provide the existing reviewed build inputs through the established
private restoration channel, plus an approved private workbook-fixture delivery
path for tests. That preserves the existing build contract but carries historical
Replit repair material into the package, which may be undesirable for a fresh
self-host installation.

**A fresh database choice does not itself supply or authorize fabricating those
production review records.** Approval alone does not establish a tested runtime boundary. Until that boundary
is implemented and verified, the installer correctly refuses,
PR #142 stays draft, and main merge/deployment/automatic updates remain NO-GO.
