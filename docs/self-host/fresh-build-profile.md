# Fresh self-host build profile — implementation checkpoint

Donald approved separation from Replit's historical production evidence in the
existing Windows/LAN self-hosting objective and draft PR #142. This document is
an implementation checkpoint, not a second task or an installation approval.

## Agent-owned execution

Owner: Notion AI. Outcome: a fresh Windows/LAN installation with an accurately
sealed identity, no authority to apply Replit's historical repairs, no bundled
private audit evidence, and no route through Replit production promotion.
Replit remains the production publisher. No main/Replit changes, production DB
access, deployment or publication are authorized here.

Evidence: repository build identity/preflight/repair code, synthetic fixtures,
read-only GitHub branch/CI metadata and feature-branch PR #142. No production
report or workbook bytes are available or needed for the new profile's unit
contracts. Do not synthesize those inputs to satisfy the old production gates.
No further product input is expected for profile separation. Facility timezone,
Windows hardware, Docker/WSL2/licensing and actual installation qualification
remain user/environment-controlled decisions for the overall objective.

Affected surfaces: source fingerprinting and identity/sealing first; then API
packaging and schemas, legacy repair execution/capture/status, Docker targets,
preflight/installer selection and runtime qualification. These remain one owning
objective. The first checkpoint must not activate a partially guarded runtime.

## Applicable safeguards and verification

AGENTS, task-execution-rules, verify-before-commit, production publication,
source-reconciliation evidence and immutable pool-approval memory guidance apply.
No repair registry, released manifest, migration, auth or existing gate is to be
weakened. No runtime environment flag may grant or impersonate production repair
authority. Production validators remain production-only; production build-record selection
also rejects unknown/fresh modes instead of silently defaulting to publish.

| Contract / variant | Required evidence |
| --- | --- |
| Existing production policy | Original fingerprint bytes on unchanged synthetic input; existing identity/promotion tests |
| Fresh source without historical assets | Dedicated policy, required build/deployment inputs, no operational evidence reads |
| Source integrity | Mutations, unknown policy, missing roots, symlinks, bounded bytes and Git binding |
| Separate preparation | Distinct candidate/expectation files; stale reuse rejection; production files unchanged |
| Sealing | Matching API+web record and output hashes; incomplete/mixed/tampered outputs rejected |
| Promotion | Fresh records rejected by production validators, preparation, finalization and live verifier |
| Runtime/package boundary | Not activated until repair/status/capture and API-schema/package tests pass |
| Windows/Linux | Dependency-free Node contracts on both; symlink unit privilege exception explicit |
| Existing private-workbook suite | Previously 23 missing-input failures retained; no fake fixtures or skipped gates |
| Actual Windows install/offline restart | Not run; no Docker/PowerShell host here |
| Desktop/phone/tablet portrait+landscape, Chromium/WebKit | Not run; runtime profile not activated |
| Physical Android Chrome/iOS Safari/PWA | Blocked: no device service; never inferred from Node tests |

## Checkpoint scope and remaining failure ledger

The first implementation adds isolated source-policy and identity primitives
only. They are not a working fresh app image. Existing API/web build entrypoints,
Docker targets, launcher and preflight still select the original production
contract and correctly refuse missing private inputs.

The fresh policy intentionally fingerprints all included application source,
including currently tracked historical repair code. It omits the separately
required historical audit/pool-approval assets from its inputs. **This is not a
packaging privacy guarantee:** the later runtime module-graph and image checks
must establish that no historical payload or approval material is shipped.

Do not manually copy a fresh identity onto a production build. A source/output
seal proves correspondence of bytes, not that repairs were disabled or that a
runtime is qualified. The unchanged production runtime validator rejects the
new identity until the explicit runtime profile is implemented.

Open items owned by the same objective/agent: fresh API schema/status contract,
compile-time legacy repair/capture restrictions, clean runtime/migration Docker
targets, verified package contents, fresh preflight selection, synthetic install
and import tests, and native Windows/LAN/device/offline/restore/update evidence.
The generated API payload publication route needs verification before schema
work: connected file writes are bounded, and generated aggregate files exceed
that request limit. Do not hand-edit or omit generated files to bypass it.

The earlier full-CI failures, missing reviewed production inputs and 23 private
workbook failures remain open in `integration-2026-10-31.md` and
`preflight-and-build-boundary.md`; this checkpoint does not close them. Hosted
log downloads previously returned HTTP 403. PR remains draft; deployment and
main merge remain NO-GO. Next validation milestone: isolated identity contracts,
production regression tests, workflow policy and authoritative root typecheck;
then implement and qualify the runtime/package boundary before activation.

## Local checkpoint verification and repaired findings

- Fresh identity contracts: **31 passed**, including policy isolation, required
  inputs, source mutations, strict records, Git binding, independent preparation,
  mixed/incomplete stages, compiled-output tampering and promotion refusal.
- Combined Linux Node run: **127 passed, 0 failed, 0 skipped** (61 previous
  self-host/preflight checks, 31 fresh checks, 35 existing production identity,
  promotion and release-source checks). No DB/provider/network credentials used.
- Actual checkout: fresh policy reads 2,244 source inputs without the separately
  required historical assets; default production fingerprint still refuses.
  This input inventory is not a compiled image or private-payload scan.
- Workflow policy/actionlint: **PASS**, all 15 workflows. Added native
  Windows/Linux fresh contracts plus Linux production regression tests to the
  existing read-only lane. Hosted results must be checked after publication.
- Initial fresh tests exposed a real new bug: the inherited required-input type
  heuristic treated extensionless `Dockerfile` as a directory (26/30 failed).
  Added explicit fresh top-level-file typing; all 30 then passed. The invalid
  directory-in-place-of-Dockerfile case remains covered.
- Local verification-tool invocation initially lacked the pinned wrapper on
  PATH (exit 127); assigning that wrapper itself to ACTIONLINT_BIN then caused
  wrapper recursion and memory pressure. Stopped the identified local wrapper
  processes, unset that variable and used the pinned wrapper via PATH. No
  repository linter policy or test was weakened. Workflow lint passed.
- The first concurrent root typecheck was killed (137/SIGKILL) during that local
  resource incident. It is not a pass. The complete authoritative command was
  rerun after cleanup: **`CI=true pnpm run typecheck` PASS, exit 0**,
  including the calculator, server, routes and scripts checks. The initial killed
  run remains recorded as a failed attempt, not relabeled as a pass.

The Windows symlink-privilege unit exception remains explicit; Linux covers the
escape cases. No physical device, browser, Docker/WSL2 or deployment qualification
is inferred from these unit checks. Existing full-CI/private-input failures stay
open with the same owner and next actions recorded above.

Code checkpoint: `6d0356f0a5542d27677aedc68d077f7e6d85d91a` on the existing
feature branch. No main/Replit mutation or runtime activation. Native hosted
foundation results are recorded in PR #142 when available.
