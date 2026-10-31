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

## Hosted regression investigation (same owning task)

The first code checkpoint's Linux foundation job passed, but Windows failed the
new synthetic contract step in runs 41206388189 / 41206380089. A generic exit-1
annotation was insufficient; no operational input or production failure is
inferred from it. Added a bounded, escaped failure reporter alongside the normal
spec output. Three diagnostic contracts cover escaping, event filtering and
preserving the real failing Node exit. A nested-test-context inheritance issue
in the reporter test was fixed by an explicitly minimal child environment.

Annotated runs 41206723702 / 41206718140 then identified two Windows failures:
(1) fresh synthetic Git binding returned unavailable instead of the fixture
commit; (2) the nested reporter CLI returned 7 instead of 1. The reporter test
now supplies a portable file URL (rather than a Windows drive-letter module
specifier) and bounded stderr on unexpected exit. The Git fixture adds boolean-
only diagnostics for root spelling/canonical identity, source-set count, modes,
blob equality and batch header line endings. Neither a Git-binding assertion nor
any failure gate is skipped. Both failures remain open until native reruns pass.

Local suite including diagnostics: 130 tests passed (95 self-host/diagnostic,
35 production identity/promotion/release-source). The diagnostic checkpoint's
full root typecheck also passed. Hosted results remain distinct from local tests.
The actual committed source at 8cdb4443c43e0871eaccc927f72e21cb061bd699 produced
an honestly verified fresh Git binding without historical input restoration.
A local remote-tracking check initially used a stale feature reference because
this checkout's fetch mapping tracks main only. An explicit feature refspec
resolved it; all 12 published file contents were compared exactly before local
HEAD/index reconciliation, with working files preserved. No remote ref mismatch
or another contributor's change was overwritten.

### Confirmed Windows root cause and bounded repair

Annotated native run 41207058991 isolated the remaining binding failure:
root spelling differed while native canonical roots, source counts, modes and
individual blob contents all matched; the batch header did not have CRLF.
The original literal path comparison rejected Windows' alternate (including 8.3)
filesystem spelling. This was a provenance-availability bug, not a source mismatch.

The shared Git probe now permits a differing Windows spelling **only when both
native realpaths are exactly equal**. Linux retains its original strict spelling
comparison. No case-folding guess, directory-prefix acceptance, optional proof
flag or fallback revision was added. All captured path/mode/SHA-256 byte checks
against the immutable Git commit remain. A repository-subdirectory negative
assertion verifies that the source-root boundary is still enforced. Local combined
130-test and 15-workflow runs passed after this repair; native rerun and final
root typecheck are recorded when complete. Reporter Windows file-URL portability
is included; the earlier annotated failure history is preserved above.

### Final identity checkpoint result

Code repair `59ab3711b288f468723e1d3893c1ffacfc07b6bc` passed **both native
Windows and Linux foundation jobs** in
[run 41207331604](https://github.com/ravenslight2010/Production-run-calculator/actions/runs/41207331604).
This closes the introduced Windows Git-root and reporter portability failures;
all earlier failed runs and causes remain above. No assertion was removed or
converted to a skip. The two Windows symlink-privilege exceptions (existing
preflight and new source-escape test) remain explicit; Linux exercises both.
The Windows job also executes the original blocked-initialization refusal path.

Final local code: **130 Node contracts PASS**, all **15 workflow policy/actionlint
checks PASS**, and authoritative **`CI=true pnpm run typecheck` PASS, exit 0**
after the Windows repair. No new API/web runtime, DB, image, deployment, physical
device or updater readiness is implied. Existing full-app/private-input failures
remain open. The installer still deliberately refuses the original missing
production prerequisites. PR #142 remains draft and main/deployment NO-GO.

### Remaining publication capability / next owner-controlled action

The upcoming honest fresh-profile API/status contract needs official codegen,
not a hand-edit or a bypass of the generated validation schemas. Current generated
aggregates are 671,550 bytes (`lib/api-zod/src/generated/api.ts`) and 317,535 bytes
(`lib/api-client-react/src/generated/api.schemas.ts`). Each exceeds the connected
GitHub writer's 65,536-byte request boundary already encountered in this task.
File-backed MCP calls do not bypass that connection boundary. No patch/append or
Actions-log capability was discovered in the enabled GitHub tools; normal
public reads and bounded feature writes are working.

The local checkout has no authenticated normal git push route or GitHub CLI.
An owner-approved GitHub device-code sign-in would supply that route without
putting passwords/tokens in chat. This is the next user-controlled authorization,
not a request for the owner to retrieve logs, reports or build fingerprints.
Do not fabricate/omit generated output, publish private historical evidence or
add a write-enabled codegen workflow merely to work around the connector.
Until the route is approved, schema publication and the rest of the runtime/
packaging activation stay incomplete under the same owning objective.

## Authorized runtime implementation (continuation)

Donald pointed to the existing GitHub credential, and approved continuing the
implementation through completion. Authentication and a no-change feature push
check succeeded without printing or persisting the credential in git settings.
The earlier request-size limitation is no longer a publication blocker: normal
feature-branch git pushes can publish official generated files. No new device-
code login is needed. The source copy was clean and fast-forwarded to the exact
committed 51ee82eb checkpoint before continuing; no unreviewed checkout was pushed.

### Agent-owned execution

Same owning objective, owner Notion AI, draft PR #142. Implement a **compile-time**
fresh runtime: exclude historical repair/capture modules from the module graph,
keep only live input normalization, report the historical audit as explicitly
not applicable without invented report/marker/counters, use strict fresh identity
at runtime, regenerate API schemas, and select dedicated fresh Docker/migration
images and read-only preflight explicitly. Production entrypoints/validators,
legacy definitions/fingerprints and Replit publication remain unchanged. Normal
restart must still require cached images only, with no build/migration/model pull.

### Applicable safeguards and verification

Apply the existing safety matrix plus: inspect esbuild input graphs and final
package contents; reject any historical repair or capture module in a fresh graph;
reject unsealed authored build inputs; test all fresh capture methods without DB
or report reads; compare live normalization behavior with the existing production
helpers; validate actual generated response schemas; test matching/mismatched
fresh runtime identity and ignored ambient Replit/build-mode variables. Default
production schema/promotion/identity tests must continue to pass.

Use official codegen, full root and leaf typechecks, focused server/client tests,
Node preflight/identity tests, and native Windows/Linux CI. Test the new status
panel at desktop/phone/tablet portrait/landscape with Chromium and WebKit where
available; record physical Android/iOS as blocked, never implied by emulation.
Synthetic local/CI DB/image tests may create only isolated test data; no production
DB or private historical source inputs are authorized. Actual Windows Docker/WSL2,
trusted LAN CA/device, hardware capacity, restore and unattended-update release
qualification remain separate evidence requirements within this same objective.

### Runtime implementation results and retained failure ledger

Implemented explicit fresh API/web builds and `Dockerfile.self-host` targets.
The fresh build uses exact module aliases and a rejecting esbuild graph guard;
historical repair/capture implementations cannot enter the graph. Live Natural
pepperoni normalization has parity tests without granting legacy repair authority.
The historical audit returns `not-applicable` with a closed profile/reason shape;
all capture/diagnostics methods refuse with 409/no-store. Official OpenAPI codegen
produced the client/Zod union; production status fields remain unchanged. The UI
renders the distinction without an invented SHA/report/marker/count. Runtime
build identity ignores ambient Replit labels and loads only a valid sealed fresh
record. Independent session-signing credentials are generated for fresh installs.

Verification at this continuation's local implementation checkpoint:

- Frozen install and official API generation: PASS.
- Authoritative `CI=true pnpm run typecheck`: PASS, exit 0 (rerun after changes).
  This includes official regeneration drift and nine generated-contract tests.
- Explicit leaf `tsc --build --force lib/api-client-react/tsconfig.json
  lib/api-zod/tsconfig.json`: PASS, exit 0.
- Combined fresh/default-production identity, promotion, preflight, reporter and
  update-policy Node contracts: **151 PASS**, zero failures/skips on Linux.
- Focused fresh API/legacy build-info tests: **22 PASS**; focused status-panel and
  existing workspace self-check UI regressions: **3 PASS**.
- Explicit actual fresh API/web source build: PASS, matched/sealed outputs,
  graph guard passed, no source maps or capture/approval helper packaged in dist.
  A dirty checkout correctly reports Git binding unavailable, not a release SHA.
- Workflow policy/actionlint: PASS, all 15 workflows.
- Isolated real-component browser layout (built application CSS), Chromium:
  PASS at desktop 1440x900, phone 390x844/844x390, tablet 768x1024/1024x768.
  Each had visible honest status, no horizontal overflow and zero page errors.
  This static component fixture is **not** a login/navigation/persistence journey.
- Added hosted Linux Docker qualification: dedicated images, isolated internal
  network, disposable fresh schema, core readiness without WAN/AI, initial manager
  signup/workspace, capture refusal, package privacy, empty historical markers and
  cached API restart. Hosted result must be recorded after execution; local
  Docker/psql/PowerShell are unavailable. No claim that this lane has passed yet.

Concrete failures found and resolved in this continuation:

1. The new BuildInfo test expected a date string after Zod parsing; official
   schemas coerce dates. Fixed the test to assert Date and wire round-trip equality,
   without hand-editing generated schemas. Nine contract tests then passed.
2. The new synthetic fresh preflight fixture initially omitted `.dockerignore`;
   the real prerequisite correctly blocked it. Completed the fixture; did not
   relax the required input set. Combined 151 contracts then passed.
3. Fresh API graph qualification initially resolved esbuild's artifact-relative
   input `src/lib/appShellCache.ts` against repository root and rejected it as
   unsealed. Added an explicit fresh-only esbuild working-directory anchor; the
   real build then passed with the guard intact. Bounded input diagnostics retained.
4. Inspection found host configuration lacked AUTH_TOKEN_SECRET, required to
   sign login sessions. Added an independent 256-bit secret and expanded the
   uniqueness assertion to all four secrets. Existing credentials are never
   silently rewritten; prior initialized candidates need explicit recovery review.
5. An initial browser probe assumed `/usr/bin/chromium`; actual bundled executable
   is discovered at `/usr/local/bin/chromium`. Repeated real layout checks passed.
6. Attempting package `run typecheck` for the two generated libraries failed
   because those packages expose no such script. Ran their actual TypeScript
   project configurations explicitly and passed; root typecheck also passed.

Still blocked/not reached, retained under this same objective (owner Notion AI):
WebKit browser binary unavailable locally; physical Android/iOS unavailable;
actual Windows Docker/WSL2/ACL/unattended reboot, trusted LAN DNS/CA/device matrix,
fresh representative imports, 20-client load, local-model quality/capacity,
backup/restore and safe signed automatic updater remain unqualified. The new
Docker lane does not test imports, Caddy trust or full-stack restart and must not
be described as doing so. Existing full production/private-workbook failures
are unchanged and are not skipped/replaced by fresh-profile passes. PR #142
remains draft; main merge, Replit publication and live deployment remain NO-GO.

### First hosted runtime qualification and corrective verification

On implementation `de768644`, native Windows and Linux safety jobs passed.
Windows ran 114 tests plus two explicit symlink-privilege skips, parsed the
launcher, and proved both invalid-setup refusal and fresh check-only perform no
setup mutations. The three new fresh Docker images built successfully and the
isolated schema/core readiness completed without WAN/AI. The runtime probe then
**FAILED**: it expected an exact `Cache-Control: no-store`, while the real global
middleware correctly strengthened it to `no-store, no-cache, must-revalidate`.
This is a test expectation bug, not permission to weaken caching. Changed the
probe to require the no-store directive, assert the exact refusal body as well,
and exercise the real cache middleware in both focused router tests. Re-run
results must be recorded, not inferred from the earlier partial pass.

Further fixture/environment findings: visual review found the **isolated HTML
fixture**, not the application, lacked a UTF-8 declaration. Added it, repeated
all five Chromium viewports with an explicit `Replit’s historical audit` text
assertion, and inspected the corrected phone screenshot. No product text/encoding
change was needed. WebKit was downloaded through the official test runtime;
launch is still BLOCKED by unsupported Amazon Linux / missing GTK4, GStreamer,
ICU74 and other native libraries. No host security/package-manager changes were
made to force a pass; actual Safari/device evidence remains open.

Authenticated hosted logs also now confirm the separate original production
build fails at the source-identity prerequisite; production Docker and rollback
image rehearsal fail in `prepare:publish` with unreadable/missing required source
inputs. Those gates remain strict and are not replaced with a fresh-profile pass.
Current run: 41210805413; job IDs 124565180482, 124565180354, 124565180331.

Hosted Typecheck's later scripts-routine step exposed an inherited synthetic
fixture problem (not a TypeScript compile error): literal `third-party-package`
imports in two Home boundary fixtures were counted as an undeclared dependency.
Changed those fixture imports to the already-declared external package `react`;
the tests still exercise ignored third-party imports and nested workspace export
boundaries. No dependency was added and the strict inventory/checker was not
weakened. This safely actionable finding is repaired in the same objective.

The extra local scripts-routine run initially stopped on missing `.config/bashrc`.
Inspection proved the file is tracked at HEAD but deliberately absent from this
sandbox's sparse checkout (`S` / skip-worktree), not a missing upstream fixture.
Expanded only the local sparse checkout to include the real tracked `.config`
folder; no shell content was invented or product check relaxed. Repeat the
routine suite using that restored exact source.

With the exact sparse-omitted file restored, local scripts-routine progressed
through the dependency and shell signal tests, then ShellCheck 0.11 emitted
SC2329 for four existing trap-only callbacks. Each already had a narrowly scoped
SC2317 annotation; extended those same function annotations to SC2329 with an
explicit trap/callback explanation. No shell logic, global warning configuration
or test gate changed. Existing fallback interruption/cleanup regression checks
passed before this lint point; the complete suite is repeated after annotation.

Corrective local gates: 22 focused API tests PASS including real cache middleware;
root typecheck PASS; 102 Home boundary tests PASS; strict dependency inventory PASS;
complete maintained shell inventory lint PASS. Scripts-routine then reached and
failed its existing `reports an unreadable document` test: sandbox chmod(000)
files remain readable by Node (isolated synthetic probe: uid 1000, mode 0,
readable true). This is a local filesystem capability limitation, not evidence
that the checker mishandles an actual EACCES. Do not change the checker, fake an
error, or skip this required test. Hosted Ubuntu verification remains required;
later routine commands were not reached in this local full-suite attempt.

Second hosted runtime attempt (41211566547, `f8282f65`) passed both native safety
jobs and again built/started the isolated fresh schema/runtime. The next probe
failure exposed another overly broad expectation: the existing **global CORS**
middleware answers protocol-only OPTIONS with empty 204 before any operational
router. This does not create a capture/receipt or grant repair authority. Preserve
that normal global behavior; require empty 204 for OPTIONS and 409/no-store/exact
unavailable body for every tested operational method. The direct disabled router
still rejects all methods when reached. Added a DB-free CORS-mounted regression
that proves the empty preflight is followed by a refused POST for both endpoints.
This clarifies the earlier "all methods refuse" statement: operational capture
requests are unavailable; protocol preflight is not an operation. No production
CORS/auth/order/security policy was changed to satisfy a test.

After the protocol correction: focused fresh API + legacy build-info regressions
**23 PASS** (includes the added CORS-mounted test), authoritative root typecheck
**PASS, exit 0**. Hosted runtime re-run is required to finish the remaining probes;
no workspace/signup/restart result is inferred from unit tests.

### Qualified fresh-runtime checkpoint — c0108045

**Self-host foundation PASS** on Windows, Linux and disposable Docker runtime:
https://github.com/ravenslight2010/Production-run-calculator/actions/runs/41211885502

The fresh-runtime job's real assertions now completed: all three dedicated images
build; new schema migration succeeds; core /readyz returns 200 on an internal
network with no model server or WAN; build-info labels the fresh profile; manager
signup returns 201 and authenticated data-health workspace returns 200 with the
exact not-applicable historical status; capture/diagnostics operations refuse
with 409/no-store (protocol-only CORS OPTIONS is empty 204); final API image has
no uploaded assets, source checkout, report/approval helper or source maps;
`data_heals` count stays zero before and after cached API restart; build identity
is unchanged across that restart. All test containers/network/images are cleaned
up. Native Windows/Linux safety jobs also passed. This is **not** proof of Caddy
trust, full-stack reboot or actual Windows Docker execution.

Repeated local source build from committed implementation PASS; API/web sealed
identities match, Git binding is verified to the committed source, and no legacy
approval/report/map outputs exist in API dist. This provenance is not a signed
release/update authorization. Local root typecheck and 23 focused API regressions
passed; 151 combined Node, nine generated-contract, three focused UI and 102 Home
boundary contracts, strict dependency inventory and maintained shell/workflow
lint results remain recorded above.

The inherited scripts-routine issues repaired here were confirmed by hosted
execution: dependency inventory passed, shell checks progressed, and all 31
operational-skill evidence tests (including the chmod unreadable case blocked in
this sandbox) passed. The hosted routine then hit the genuine missing retained
Malted Barley workbook in compare-source-audit. It was not skipped or synthesized.
Original web unit run retained 3777 PASS / 23 FAIL / 1 SKIP, with all 23 failures
from the six previously identified real-workbook suites. Original production
build/Docker/rollback, department browser preparation and standard release build
still stop on production source prerequisites. Release's post-failure diagnostic
commands also report missing pnpm because prerequisite failure prevented their
tooling setup; retained fallback is NO-GO, not successful evidence. Full release
lane was skipped after standard failed. None of these are green fresh-runtime
gates, and later unreached tests are not counted as passed. Latest broad CI was
still running at this checkpoint; it is already not a release GO.

**Overall decision: draft PR / main and live deployment NO-GO.** Fresh runtime
implementation and its isolated Docker qualification are complete at this
checkpoint; the broader self-hosting goal is not. Remaining owner-controlled
qualification: actual Windows/WSL2/unattended startup and ACLs, facility DNS/IANA
zone and trusted HTTPS on actual clients, representative fresh imports, load and
local model evaluation on chosen hardware, restore rehearsal, and signed safe
GitHub update implementation/rehearsal. The update policy is still a planning
contract, not an installed automatic updater. No main/Replit/registry publishing
or production-data changes were made.

### Approved restricted CI input delivery — PR #142

Donald explicitly approved a separate CI-only input channel after the main-only
secret boundary blocked the required PR gates. This supersedes the earlier
no-PR-access restriction only for the reviewed same-repository PR #142 head.
Agent-owned execution remains in this task: recover exact historical Git blobs
through a guarded, read-only CI transport; pin every path/revision/SHA-256; deny
forks, other PRs, other branches and unreviewed head revisions. The existing
protected-main secret and its branch policy must not change. A separate
environment capability and approved-head variable gate this PR; main retains its
existing main-only environment and receives no new capability or private inputs.
This channel is PR-only; post-merge legacy-input provisioning remains unresolved. No raw inputs enter tracked source, uploaded
artifacts, external build caches or fresh self-host images. Cleanup runs even
after failures. No live database or Replit publishing is authorized.

Applicable safeguards: source-evidence boundary, build integration isolation,
verify-before-commit and existing release gates. Verify synthetic authorization
negatives, hashes, missing/corrupt data, filesystem links/overwrite/cleanup, workflow
contracts, root typecheck and actual required hosted checks. Rollback worktrees
must receive the same verified report pair. Desktop/phone/tablet and
Chromium/WebKit retain existing hosted browser gates; physical devices remain
unverified. Current status: implementation in progress, CI remains FAIL/NO-GO.

Failure ledger addition: local PyNaCl was unavailable (environment capability);
installed privately for GitHub secret encryption. An initial rollback-file glob
was incorrect; resolved to rehearse-schema-safe-rollback.mts, no source effect.

The first restricted-input contract run caught a comma in one retained workbook
filename; the safe basename grammar now permits that literal character while
retaining traversal/symlink/hardlink rejection. The existing workflow assertion
was updated to prove the **original secret** remains main-only alongside the
new separately authorized PR lane; the protected Docker/Caddy lane is unchanged.
Focused private-input contracts: 23 PASS. Frozen install, workflow syntax,
workflow isolation regressions and rollback unit contract PASS locally.

The completed preceding hosted API run (41212300418) also revealed one real
non-input failure: GET /import-gold/cleanup-cases already requires manage-staff
but was omitted from the read-authorization inventory. Added the route to that
existing scoped/all/manage-staff inventory and pinned its policy in the assembly
regression; no route permission or enablement was changed. Two other API suite
failures were missing the exact canonical report; hosted revalidation is required.

No protected-main environment/secret mutation was made. A proposed broader
capability addition was rejected before execution and narrowed to the new
PR-only environment. Main's legacy workbook CI problem remains outside this
new PR-only grant and must not be silently represented as repaired.

The new PR-only environment additionally requires explicit deployment review,
with admin bypass disabled. The agent will approve only runs whose exact PR
head was reviewed and recorded in REVIEWED_PR_HEAD_SHA; a script-level head
check alone is not an environment trust boundary. This prevents arbitrary later
PR code from automatically receiving the environment capability. Forks and other
refs remain excluded by deployment policy. Protected main remains untouched.

Pre-push checkpoint: authoritative root typecheck PASS (exit 0); focused route
registration 7 PASS with a nonconnecting placeholder DB URL (the first local
attempt lacked required DATABASE_URL and collected no tests, then was corrected);
23 restricted/existing input contracts PASS; dependency inventory, workflow
syntax/isolation, rollback contract and frozen install PASS. Local checks do not
claim successful historical CI data retrieval or passing hosted suites.

Push preparation initially failed because the restored sandbox had no Git
author identity. No new source commit or main change occurred; the premature
PR checkpoint was corrected immediately. Retry uses an explicit Notion AI
commit identity and fail-fast shell execution.

### First restricted hosted run — ac14df3e

Private CI restore and cleanup succeeded. Build (web+API), original schema-safe
rollback, department desktop/phone journey, reduced-motion/HTTPS browser checks,
workflow syntax and all fresh-runtime foundation checks PASS. API and standard
release checks were still running during this repair checkpoint.

The broad web suite progressed to 3796 PASS / 4 FAIL / 1 SKIP: all remaining
failures requested an older exact Aldo workbook outside source-library. Scripts
routine progressed past workbook parsing and then lacked the retained comparison
report. Added those two exact historical path/revision/hash entries to the same
restricted PR-only manifest; do not replace fixtures with synthetic data or
change assertions to get green. No raw payload was committed or logged.

Original Docker images built, but runtime security comparison rejected Docker's
CAP_NET_BIND_SERVICE spelling for the exact NET_BIND_SERVICE capability. Added a
JSON-aware comparator that normalizes only added-capability CAP_ prefixes and
retains exact UID, drop-ALL and no-extra-capability checks. Regression cases cover
CHOWN/NET_BIND_SERVICE aliases, empty/null no-add, wrong UID/drop, extra/wrong/
duplicate/malformed capabilities. No container permission was broadened.

A later status command omitted its repository directory (read-only git status
error); subsequent commands explicitly use the repo working directory. All
failures remain owned here; no main merge or production publish occurred.

Second repair pre-push verification: root typecheck PASS (exit 0), 23 input
contracts PASS, four Docker-security regression groups PASS, maintained Docker
shell lint PASS, workflow syntax PASS, frozen install and strict dependency
inventory PASS. The web suite also reported 162.5 seconds against its existing
150-second budget while failing inputs; leave that timing gate unchanged and
verify the complete passing suite rather than assuming the budget is met.

A proactive audit of the immediately following real-source tests found two
more required defaults: the retained source-library manifest and its historical
production recipe snapshot. Added exact historical pins to the same PR-only
channel (56 payloads total). Metadata review confirms the snapshot is recipe/
profile/ingredient tables only, not an auth/user export; no live production
query, new capture, model evaluation, Gold enablement or production heal occurs.
The canonical manifest's 49 import workbooks all match delivered paths and exact
hashes; the two additional shipping/schedule workbooks are outside its five
import kinds. No source-policy/fixture expectation was changed. The channel
remains fail-closed, review-gated, ephemeral and excluded from Git/artifacts.

Hosted 7b7f8375 checkpoint: Unit tests (web+libs) PASS; calculator 3800 PASS /
1 pre-existing SKIP, 116.8 seconds within unchanged 150-second budget. Docker
image/runtime PASS after capability spelling correction; rollback, build,
department, reduced-motion/HTTPS, workflow lint and fresh foundation PASS.
Typecheck's routine tests failed on the predicted missing retained snapshot
(default CLI path), not a TS error. The 56-input manifest includes both remaining
defaults; focused input contracts and authoritative root typecheck PASS locally
(exit 0) before this third push. API was still running at this checkpoint; its
preceding ac14df3e run completed PASS. Full release remains pending behind the
superseded release job's cancellation/always-evidence cleanup; neither a
cancelled nor an unexecuted release is a pass. Main remains unchanged.

### Third hosted run and bounded corrections — 21e7395f

Original production build/Docker/rollback, department/reduced-motion browser and
fresh foundation remain PASS. Web assertions all passed (3800 +1 existing skip)
but the suite took 157.4s and correctly FAILED its unchanged 150s gate. The prior
full pass was 116.8s; neither result is hidden. Thirteen pure-library or static
source/CSS contract files unnecessarily created jsdom environments. Marked those
files as Node-only; no case/assertion, UI DOM suite, isolation, worker count or
budget changed. Focused and full hosted revalidation remain required.

The source-comparison CLI now reached its strict snapshot-member count and
refused partial inputs: the immutable snapshot lists two historical Markdown
audit members as well as the 51 workbooks. Their current-at-4629 bytes do NOT
match the snapshot; did not substitute those. Located exact older matching
revisions, pinned both paths/SHA-256s (58 payloads total), and kept the guard
unchanged. This closes the inventory of every immutable snapshot member and
every directly referenced default audit file; no production access or payload
publication is authorized. The repeatedly missing-input condition has now
recurred three hosted iterations and is explicitly BLOCKED until the complete
58-input hosted run proves it; not reported as resolved from local contracts.

Main-only CI input delivery remains awaiting the owner's specific approval,
asked in chat; the existing PR grant must not be silently broadened.

Fourth repair pre-push: all 105 tests in the thirteen Node-only pure/static
suites PASS, 23 private-input/boundary contracts PASS, authoritative root
typecheck PASS (exit0). No assertion was dropped and no DOM-driven suite was
converted. Exact missing Markdown hashes were verified against the immutable
snapshot before pinning. API at21e7395f completed PASS. All new/current hosted
gates still require execution; no main-only authorization has been inferred.

### Fourth hosted run — a7cdc3c4: complete inputs verified

The complete 58-file channel successfully passed source-comparison, source
manifest, reconciliation and source-heal tests: the repeated missing-input
blocker is now CLOSED by hosted evidence. The scripts routine reached a new
real native metadata race: a nonblocking flock contender can close stdin before
Node finishes writing, yielding spawnSync EPIPE. Preserve refusal and all locks;
classify that specific closed-input refusal as busy/unavailable rather than
pretending the lock operation succeeded. Added a native held-gate/large-request
regression that requires decision/recovery/update-lock bytes remain unchanged.
Other launch errors keep their original fail-closed diagnostics. Native macOS
and Windows checks remain required and their supported paths are preserved.

All 3800 web assertions again passed, but 155.7s still FAILED the unchanged150s
budget. Thirteen suites removed too little setup overhead. Runtime syntax/import
graph inspection found 41 additional DOM-independent pure/static suites; move
only those to Node and require all their assertions plus complete hosted suites.
No browser-driven suite, assertion, worker limit, isolation or budget changed.
Earlier timing failures remain in this ledger; neither retries nor green test
assertions alone close the timing gate. Docker/build/rollback/browser/fresh
checks PASS; current API/release results still need final verification.

Fifth pre-push checkpoint: added41 pure/static suites all284 tests PASS (with
the earlier105, total389 focused unchanged assertions). Complete metadata
backfill/export/dataset regression suite PASS; three further native Linux
recovery/race reruns PASS, including large busy-gate input refusal without writes.
Root typecheck PASS, exit0. Latest broad/native-host/timing/release checks must
run from the pushed head. Main-only data access has not been approved or changed.

### Fifth hosted run — 30669aae

Web+library timing gate PASS after pure-environment correction; Docker/build/
rollback/browser/fresh checks PASS. Native macOS and Windows metadata checks
PASS after the fail-closed EPIPE repair. The scripts routine progressed through
all metadata/distillation checks and reached its final real ZIP inventory suite,
which exposed nine removed opaque archive fixtures (six normal Git blobs and
three Git LFS objects, 286,430,528 bytes total). Existing checkout LFS cannot
restore paths no longer in HEAD. No inventory assertion is skipped or synthesized.

Extended the same reviewed-head PR-only channel with a separate nine-archive
manifest and --with-archives flag ONLY for routine/release consumers. All source
input limits remain4MiB/file and12MiB/total. Archive limits are a separate
140MiB/file,290MiB/total ceiling with exact per-file byte lengths and SHA-256s;
LFS pointers must exactly match version/OID/length before read-only smudge.
No archive member is opened/extracted/executed; the existing inventory reads
central-directory metadata only. ZIPs remain mode600, ignored, contents
never logged, excluded from build context/artifacts/caches and allowlist-cleaned.
No main-only permission is inferred; its pending approval remains blocking merge.

Local verification discipline: two root typechecks accidentally overlapped; one
was terminated with137/SIGKILL during API/calculator checks (no TS diagnostic),
while the later check completed. This is not counted as a pass for the killed
run. Stop overlapping workspace-wide checks and repeat root typecheck alone
before commit; no runner memory limit or gate is changed.

Sixth pre-push: serialized authoritative root typecheck PASS (exit0); all26
source/archive authorization, pointer, budget and cleanup contracts PASS;
workflow syntax PASS. Duplicate archive pairs' exact hashes match. The prior
web full-suite timing PASS was94.4s (unchanged150s limit); all3800 assertions
and shared libraries PASS. Latest API PASS; native macOS/Windows metadata PASS.
Real LFS fixture retrieval and final ZIP inventory still require hosted proof.
No archive member was extracted/executed locally or added to Git.


### Approved separate main-only CI delivery and release failure closure

## Agent-owned execution

Owner: Notion AI, same Windows LAN fresh-install objective. Donald explicitly
approved a separate main-only CI input path after PR-only verification. Created
`main-reviewed-test-inputs`, restricted to the exact main branch with owner
review required and admin bypass disabled, holding a new independent encrypted
`CI_MAIN_INPUT_AUTHORIZATION` capability. The original
`docker-caddy-reviewed-inputs` environment, branch policy and report secret
metadata were read before/after and are unchanged. Its protected Docker/Caddy
workflow is unchanged. No new repository-wide secret or fork/PR access exists.

The three ordinary CI/browser/release workflows select the separate environment
on main; its fixed-pin transport supplies the same canonical report plus
supplemental sources/opaque archives instead of exposing the original report
secret in this second environment. PR142 keeps its independent reviewed-head
capability and cannot use --main. Main requires push or manual dispatch,
exact repository/ref, a valid run SHA, matching push after/ref and checked-out
HEAD, and the separate capability. Other events/refs, fork identities, deleted
refs and mismatched checkouts fail closed. No raw input/hash policy, file budget,
private mode, no-extraction policy or exact allowlist cleanup was relaxed.

## Applicable safeguards and verification

Main post-merge delivery is NOT YET RUN; no main push or deployment is claimed.
Local authorization and workflow isolation contracts cover main push/manual
positive cases and wrong event/ref/repository/SHA/capability negatives. The
original main-only report restoration and protected browser cases stay tested.
Root typecheck, workflow policy/actionlint and hosted required/release checks
must pass from the next pushed revision before any merge. Live branch protection
also requires one independent approving review; PR142 currently has none and
cannot be self-approved by its author. No admin bypass or policy relaxation is
authorized. Obtain a genuine review rather than exploiting unenforced-admin
settings. Replit remains the only current publisher; a GitHub merge is not a
production GO or installed update.

Latest prior head `7fec8d26`: required CI run41221117247 PASS, actual58source and
9archive delivery PASS, all22ZIP inventory tests PASS, desktop/phone navigation,
Windows/macOS metadata, self-host foundation and Node advisory PASS. Standard
release run41221117195 FAIL (all12API shards and WebKit smoke passed). Earlier
cancelled-run evidence retrieval returned a signed-blob404; the completed current
run supplied usable logs, so no failure is inferred solely from cancellation.

Failure ledger additions (all remain subject to hosted closure):

- Isolated real legacy API/web producer FAIL: fresh-only helpers were imported
  unconditionally but intentionally absent from the legacy sealed-copy source
  set. Load fresh helpers only for explicit self-host-fresh mode; retain fresh
  graph assertions and production fingerprint/validators unchanged. Integration
  now explicitly asserts absence of the fresh-only tree before building.
- WebKit compatibility identity contract FAIL: approved-config discovery found
  16 cases while the retained inventory had8. Reviewed the additional synthetic
  cleanup/QC-retention/reminder and issue-review cases, added all8 exact identities;
  no case removed/skipped and additions/removals/substitutions still fail closed.
- Accessibility supervisor test FAIL: its purportedly authorized disposable
  supervisor lacked manage-factory-settings. Grant that capability only to this
  explicit fixture, keep ordinary supervisor defaults and product permissions
  unchanged, and add a denied-supervisor browser case at every a11y viewport.
- Accessibility reload/summary diagnostics FAIL: five observed read-only paths
  were cancelled at deliberate navigation boundaries. Classify only exact GETs,
  known origins, cancellation codes and navigation phases; require a successful
  fresh authenticated read of each exact cancelled URL afterward. HTTP errors,
  writes, other origins/paths and normal-operation failures remain failures.
  The already-retained unmounted diagnostics404 stays separately identified,
  never represented as successful route availability.
- Release evidence allowlist FAIL was downstream of failed Playwright error
  contexts. Do not expand the artifact allowlist or upload raw contexts; require
  the corrected uninterrupted release run and unchanged evidence privacy guard.

Compatibility applicability: rerun all four automated Chromium a11y viewports
(desktop, phone, tablet portrait/landscape), existing department journeys and
WebKit smoke on the new revision. Inventory discovery is not runtime evidence
for optional/full WebKit compatibility lanes. Physical Android/iOS and actual
Windows installation remain NOT RUN/BLOCKED as previously documented; none is
relabeled PASS. All remaining original qualification exclusions are retained.

Pre-push focused results: 27 input/isolation contracts PASS;79 production/fresh
identity, graph and validator contracts PASS; WebKit authoritative identity
inventory checks PASS;5 navigation-cancellation classification tests PASS.

Authoritative root typecheck PASS (exit0) and all15 workflow policy/actionlint
checks PASS before push. An obsolete workflow-contract expectation initially
failed after the deliberately separate environment change; updated it to require
the new exact main guard/capability and continued original protected-lane test,
then all27 input contracts passed. Git diff whitespace check PASS after removing
a trailing blank line. No private input or secret was staged.


### Same-head timing regression and further setup-only repair

Hosted head `a459d7c8`: Typecheck/routine, all API tests, security audit, Docker,
build, rollback, browser previews/navigation and native metadata checks PASS.
Web assertions all3802 PASS with1 existing skip, but full-suite elapsed153.5s
FAILS the unchanged150s gate. Do not rerun until lucky or call passing assertions
an overall pass. Standard release remains running on this older revision.

A conservative TypeScript AST/symbol/import-graph review found29 additional
DOM-independent pure/static suites. Resolve local names such as history/screen
instead of treating them as browser globals; inspect every reachable runtime
module, propagating any DOM/JSX/unknown external dependency through cycles. Keep
all UI/DOM suites and an existing explicit jsdom declaration untouched. Only
add the Node-environment annotation; no assertions/cases, isolation, workers,
real-clock scheduling proof or150s gate changed. All29 suites/315 unchanged
assertions PASS locally. A first annotation guard stopped at an explicit jsdom
suite and left it unchanged; the remaining allowlist was completed deliberately.

A first local verification repeat FAILed with127 because this command omitted
the already-installed ShellCheck directory from PATH. No TypeScript/product
failure was found; rerun with the pinned Node24.21.0 and ShellCheck tool path.
The earlier successful full typecheck remains historical, not a pass for that
failed command. Latest complete hosted timing and release evidence is required.
Local computer exposes2CPU workers, so full150s validation is intentionally left
to the supported hosted4-worker lane rather than overriding the capacity guard.

Corrected pinned-toolpath root typecheck PASS (exit0), workflow policy/actionlint
PASS, diff whitespace/privacy checks PASS. Confirmed programmatically that every
one of the29 test diffs is exactly one added Node-environment annotation. No
assertion or UI/browser project was changed by this timing follow-up.


### Uninterrupted release841090be — stale404 test expectation

Required CI41238214719 PASS, including full web timing132.8s <150s,3802 assertions
PASS/1 existing skip, shared libraries/API/Docker/build/typecheck/security, native
metadata, self-host and browser/rollback lanes. Standard release41238214690
closed the real isolated legacy producer and WebKit inventory failures. All12API
shards, authorized and denied supervisor cases, calendar/smoke and WebKit smoke
PASS. Accessibility had44 passing cases and4 failures (one per Chromium viewport),
all at our newly added recovery assertion requiring404 for manager diagnostics.

That expectation was wrong: the current registered manage-staff diagnostics route
returns200 JSON (confirmed in registration, handler, existing focused API test
and actual hosted response). Historical unmounted-route comments were stale and
must not govern current evidence. Remove the stale404 console/response exemption
entirely. Every fresh cancelled-URL read must now succeed; diagnostics specifically
requires200, JSON content type and its bounded warnings/window/backoff shape.
Any404 or other HTTP error now fails, a stricter gate than the old exemption.
No app route, capability, exception allowlist or production behavior changed.
The previous release remains FAIL; downstream privacy allowlist failure is not
waived. Full new-head standard release must pass with no raw error contexts.

Main environment policy/read-review/disabled-bypass/sole independent-secret
configuration was re-read and verified. The original main report environment,
policy and secret metadata remain unchanged. PR was marked ready for independent
review, not merged: live rules require one independent approval; collaborator
inventory found no other eligible reviewer. User must designate a trusted
reviewer with appropriate access; no self-approval/admin bypass is permitted.
Physical/full-production qualification and installed updater exclusions remain.

Pre-push diagnostics correction: focused existing API contract1/1 PASS (disposable
nonconnecting placeholder URL; handler dependencies mocked, no DB connection),
5navigation classifier tests PASS, authoritative root typecheck PASS (exit0),
workflow policy/actionlint PASS. No auth route or production data was modified.

### Deterministic break-planning clock after cb271880 release failure

Required CI41241133763 PASS at cb271880, including full Postgres API tests.
Standard release41241133881 remains FAIL:44 accessibility cases PASS and4 failed
at the saved-draft fixture's missing day-finish preview, before recovery checks.
The fixture froze the actual CI hour while selecting a23:00 break. After21:00,
two45-minute pending runs plus the first30-minute break can put23:00 inside an
unfinished run. The production planner correctly marks that break pending and
withholds a dependable finish; changing the planner would hide valid behavior.

Pin only this fixture's browser clock to06:00 on its current local date. Keep
signup, disposable DB seed, date/reset fences, save/reload, all four viewports,
and strict HTTP/diagnostics assertions unchanged. Add a pure timeline regression
for both the complete morning projection and the correctly incomplete21:15
projection. No production source, credentials, timing budget or failure exemptions
change. The previous failed release and downstream privacy failure are not waived.
Full new-head CI and uninterrupted standard release must close this failure.

Compatibility plan remains the existing isolated manager/live-scope journey:
Schedule → break placement/run/time pickers → Save Schedule → reload/reopen;
seed two unique complete-input runs in disposable DB, authenticate the existing
unique manager, verify draft values/projected finish and fresh authenticated reads.
Chromium desktop1280×900, phone390×844, tablet768×1024 and landscape1024×768
are required; WebKit smoke/inventory remain separate standard-release gates.
Physical iOS/Android/Windows hardware remains not run (no device service), not a
pass. Owner: agent for fixture/CI closure; user for an independent eligible reviewer.
Main remains unmodified; original report environment and protections unchanged.

Pre-push clock repair: all18timeline tests PASS, full authoritative root typecheck
PASS with pinned Node24.21.0/pnpm12.8.1 and ShellCheck toolchain. Real browser,
required hosted CI and standard release remain pending for this replacement head.
