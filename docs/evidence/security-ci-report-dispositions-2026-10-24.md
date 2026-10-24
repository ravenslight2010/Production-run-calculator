# Security and CI report reconciliation

## Scope, identity, and status

Assessment date: 2026-10-24. Baseline checkout:
`2a6ff7524be8d0e6944d68d80dee58f414cbce3d`.
This report concerns that checkout plus the explicitly described working-tree
repairs, not an already published build.

Verified production-source identity after the initial application repairs:
`production-source-v4`,
`23aa086da7f3689e4c3af899092046ba7243ae78343e74c0a19037a4c77c8c7d`.
This includes the ignored local runtime inputs and is **not** proof that a clean
tracked checkout can reproduce it. The independently measured changed release
workflow SHA-256 at that stage was
`ff2f97aa4d46f66f6e17daa0b74b1a4fb40471285b8b254597d5bf733a7da507`.

The owner subsequently approved restricted CI/build input delivery, not Git
tracking. The implementation reuses the existing encrypted, main-only
environment, wires affected trusted CI consumers, and supports verified
offline-directory delivery. Its production-source fingerprint is
`075cc2a085a11f2b8b7bf34f90db5f79f3be9f7cded34bd0e6542e6e23ee5922`.
A fresh export restored through that private-directory path produced the same
fingerprint, with honestly unavailable Git binding.

**Remediation is bounded to the safe repairs and approved restricted
delivery.** Untrusted PR builds requiring protected data remain BLOCKED, not
waived or claimed passing. Remote CI execution, publication, production GO,
comprehensive security clearance, and full-browser certification are not
asserted.

Inputs:

| Document | Claimed historical source | SHA-256 of supplied file |
|---|---|---|
| `security-bug-check-replit-2026-10-24_1792819698397.md` | `2a6ff752` | `7994d60530f4183eea017c552006d12e4c0085f08821bca3fb9b9ac6cb57e476` |
| `Replit-branch-security-and-CI-findings-2026-10-23_1792819715749.docx` | Replit `51f2e804c1b48c23e52604b191c42a6483d345ac`; PR 129 head `eb5905542b703992562a5992b77f36835953d249` | `39dcbdb349bfc5cbbc0100b0386801f4599bdbf20d99f93f6b9b690e7d449029` |

The DOCX was read as ZIP/XML, not executed. Historical objects and authorized
GitHub job logs/artifact metadata were inspected read-only. No remote workflow,
repository-protection change, publication, customer import, Gold enablement,
retention deletion, secret change, or production database operation was performed.
Only synthetic inputs were used for behavioral unit/integration checks.
The separately labeled fresh-export delivery check used the existing approved
runtime pair locally, without logging its contents or changing secrets.

The existing branch-claims investigation is recorded in
`docs/branch-claims-validation-2026-10-23.md`. Its retained conclusions are
secondary evidence here; its private raw captures are not present in this fork.
The full task records for the browser release owner and the proposed local-only
and interruption-persistence tooling were rechecked. This task changes neither
their lifecycle nor their browser inventory, time budgets, release runner, or
reporter implementation. The release workflow change below is specifically an
artifact-download/provenance repair, not browser certification.

## Findings: newer report

“Retain” below means intentional current behavior, not a claim that the residual
risk is zero. Unless a separate owner is named, this task owns its repairs and
focused verification; publication and release certification remain owner actions.

| Finding | Disposition and current evidence | Risk, owner, and next action |
|---|---|---|
| S1 / B3: public health diagnostics | **CONFIRMED / REPAIRED.** Public `/api`, `/api/`, `/api/healthz`, and `/api/readyz` return only `status` and six coarse gate statuses. `/api/livez` remains independent liveness. Rich diagnostics moved to `/api/health/diagnostics`, locally guarded by authentication, live scope, and `manage-staff`, before the ordinary startup gate. Responses are non-cacheable. OpenAPI and generated clients/validators changed together. | Public callers no longer receive worker history, timing, capacity, capability details, startup details, or diagnostic identifiers. Core readiness remains startup + database + audit protection; optional AI/worker degradation never becomes a core outage. Authentication itself still depends on its normal backing services; the new endpoint is not an authentication bypass during a database outage. |
| S2 / B4: Gold approval, export, retention, broad manager capability | **INTENTIONAL / DOCUMENTATION STRENGTHENED.** Existing source-use, retention, approval-reference, privacy-review, capability, and scope gates remain. Environment attestations do not prove the underlying approval record. The runbook now explicitly covers operator capability review, restricted export destinations, and the fact that recipe/business structures are not anonymized by removing sensitive keys. | `manage-staff` remains the existing administration boundary, not a newly granted capability. Product/data owner must verify the restricted approval record before enablement. No approvals were invented or customer cases collected. Cases/scores survive ordinary reset/factory purge; exclusion and export do not delete them. Exported copies cannot be recalled by deleting a case. Existing lab UI already states purge retention; the runbook repeats it. No automatic expiration was promised or added. |
| S3: authenticated SSE connection capacity | **CONFIRMED PATTERN / NO EXHAUSTION REPRODUCED / RETAIN.** The events route is authenticated, connections are scope-bound, heartbeat/close cleanup exists, and response-close cleanup is installed before asynchronous setup. There is no per-user stream cap. | A cap is an operating-policy decision for legitimate tabs, stations, devices, and overlapping reconnects. No production stress test or arbitrary cap/idle disconnect was introduced. Recommendation to owner: measure active connections and reconnect overlap before selecting a limit and a rejection/retry policy. Existing per-process topology is not multi-instance SSE support. |
| S4: JSON and form parser limits/order | **PARTLY CONFIRMED / BOUNDED REPAIR.** General JSON and URL-encoded parsing precede router authentication and retain the accepted 10 MiB ceiling for workbook/day-state transport. The special source-evidence capture path had an 8 KiB JSON parser but could reach the general form parser. Added the same 8 KiB URL-encoded limit before the global parsers. | No blanket payload reduction or speculative per-route matrix was applied. Negative parser tests assert JSON 413 behavior and no-store for both formats; 1 MiB synthetic day-state requests still reach authentication rather than 413. The existing 10 MiB oversized regression remains. Owner retains the supported transport policy; further reductions need representative payload measurements. |
| S5: local scoring duration/concurrency | **CONFIRMED / RETAIN BOUNDED SYNCHRONOUS DESIGN.** Existing maximum three cases, sequential processing, per-case 175-second abort, manager gate, fixed-window policy, and score-only writes remain. Worst-case request lifetime is approximately three per-case budgets plus overhead. Async fetch does not synchronously block the JavaScript event loop, but it does retain an HTTP request and resources. | Lower latency/concurrency limits require actual model/runner budgets. No new job service, silent timeout reduction, or fabricated provider-availability check was added. The request helper preserves abort signals; cancellation is covered deterministically. Client disconnect is not claimed to cancel an already accepted scoring batch. An owner can approve a measured operating-policy change separately; it is not required to retain the existing lab. |
| S6 / B1 / B2: test provider, retries, provider status and errors | **MIXED; SEE BELOW.** The test setter was an exported in-process seam, not an HTTP endpoint. It now also rejects calls outside test mode, and invocation is test-mode guarded. HTTP request bodies cannot activate it or choose a URL. Existing bounded, safe score error codes remain visible in the lab. Invalid local URL configuration now reports `localConfigured: false` and fails before scoring. | Configuration validity is not service liveness or model readiness. A valid but stopped local service still produces a bounded score error, not an Apply failure. No actual external provider was called to claim availability. Synthetic provider successes, errors, retry/scoping, and score-only persistence are covered by the integration suite. |
| B1: duplicate capture “silently skipped” | **INTENTIONAL IDEMPOTENCY / COVERAGE AND WORDING STRENGTHENED.** Capture is in the successful Apply transaction. The operation ID + scope and existing request hash protect duplicate/concurrent retries; an existing receipt is returned before another capture. Tests cover concurrent duplicate receipts and one retained case, plus no retroactive capture for an initially opted-out Apply. | A new `goldCaptured` field inferred on retry could falsely assert a capture that was opted out, later deleted, or retained under an earlier operation. It was not added merely to satisfy the recommendation. The runbook states that valid retries return the original receipt subject to current approval/capability checks, and that the scoped case list is the retained-case record. Existing successful Apply semantics are unchanged. |
| B2: “enabled” versus provider availability | **PARTLY CONFIRMED / REPAIRED CONFIG VALIDATION; MESSAGING CLARIFIED.** Feature approval, syntactically usable local configuration, and current service availability are distinct. `localConfigured` is no longer true for rejected URLs. Runbook distinguishes both providers’ configuration from listening/model/quota availability. | No eager network probe, remote dependency in core readiness, or unsafe raw provider exception was added. A score attempt records a safe error outcome per case. Actual local/Gemini uptime is NOT RUN evidence, not inferred from flags or mocked outcomes. |
| S7: authenticated AI cost abuse | **BOUNDED EXISTING CONTROLS / RETAIN.** Inspected AI routes use capability gates, per-user fixed windows and weighted database-backed cost controls. Existing focused cost-limit/rate tests were run. | Permitted users can still consume their allowed budget. No blanket lower budget, new billing policy, or claim of a complete AI-cost audit is made. Product owner owns budget changes; repeated denied/unavailable-provider outcomes should be reviewed using existing bounded telemetry. |
| B3: readiness “ok” under worker degradation | **INTENTIONAL POLICY / REGRESSION FIX.** Coarse worker/dependency warnings coexist with HTTP 200 when core gates are healthy. A rejected optional shared diagnostic read previously escaped to a 500; it now becomes a safe warning without exposing its raw error. Strict local-model probe failures remain optional. | Restoring strict optional-worker readiness would violate accepted core availability policy. Detailed authorized diagnostics retain their warning information. Database/startup/audit failure still returns 503. |
| B4: purge survival | **INTENTIONAL / CLARIFIED**, not permission to delete. Lab UI and runbook separate permanent manager deletion, exclusion, export, reset and factory purge. | Data owner must choose retention terms compatible with explicit deletion; do not enable when terms require unavailable automatic expiration. No purge or retention behavior was changed. |
| B5: tip/status messages as feature inventory | **CONTRADICTED AS A FEATURE TEST.** A tip string is not a feature registry or proof of absence. Named Gold, Windows, station activity, QC Brix, and query-token paths were checked separately below. | No product UI was changed to mimic historical tip text. Release/source-bound implementation and actual tests outrank prose or a historical PASS. |

### Local-provider SSRF contradiction

The older report's environment-trust assertion is insufficient. At the baseline,
host allowlisting rejected arbitrary configured remote hosts, but fetch still
followed redirects; `localhost` resolution was not pinned; and the IPv6
comparison used `::1` rather than URL's bracketed hostname form. The safe repair:

- Parses with `URL`, permits only HTTP and exact canonical `127.0.0.1`,
  `localhost`, or `[::1]`, and rejects user info, query, fragment, other addresses,
  mapped IPv6, and deceptive hostnames.
- Converts `localhost` to numeric IPv4 loopback before fetch, so DNS or hosts-file
  changes cannot select a non-loopback destination. IPv6-only listeners can use
  `[::1]` explicitly. Canonical numeric IPv4 spellings that parse to exactly
  `127.0.0.1` still select loopback.
- Uses `redirect: "error"` for every scoring request, including same-host
  redirects. The configured URL never comes from the HTTP caller.
- Has parser/configuration regressions, real isolated HTTP redirect tests for
  301/302/303/307/308, and abort propagation coverage. IPv6 URL parsing is tested;
  this is not a claim that this workspace can open an IPv6 listener.

No configuration secret or actual provider address was changed. This does not
review the separate private evaluator's entire server implementation.

### Other recommendations in the newer report

- P1 public separation and Gold runbook changes: implemented above.
- P2 capture-result response: deliberately not invented from duplicate retries;
  preserved receipt semantics and explicit retention/case-list documentation.
- P2 SSE caps: policy-sensitive, no demonstrated safe numeric threshold; retain
  and measure rather than disconnect healthy clients.
- P3 route limits / async scoring: repaired the demonstrated parser inconsistency;
  retained supported global sizes and bounded synchronous scoring.
- P3 dependency/CVE CI scan: already present. The exact historical security-audit
  job below passed. No dependency upgrade or fresh comprehensive CVE clearance
  is claimed by this task.

## Historical CI and older report

All runs below are attempt **1**, PR head
`eb5905542b703992562a5992b77f36835953d249`, read through authorized GitHub APIs.
A cancelled workflow does not turn every constituent job into a cancellation,
and a successful aggregate summary is not proof that its constituent tests passed.

| Claim / evidence | Disposition |
|---|---|
| F1: CI run `39886470259`, build job `120195694545` failed with “Web build identity is incomplete or stale.” Department run `39886470329`, job `120195694598`, failed with “Required build-source inputs are missing.” | **HISTORICALLY CONFIRMED; CURRENT RESULTS SEPARATED.** Current CI build job explicitly uses `BUILD_IDENTITY_MODE: development`, addressing the historical compilation-versus-Publish identity issue. No staged publish record was refreshed merely to pass a diagnostic build. The independent source-input issue still reproduces below; it is not assumed to be another identity cascade. No new remote run was authorized. |
| F1: missing source audit inputs | **CONFIRMED / REPAIRED FOR APPROVED TRUSTED DELIVERY; PR ACCESS INTENTIONALLY BLOCKED.** The owner selected restricted delivery. The exact JSON/checksum pair remains ignored, never newly tracked. The provisioned `docker-caddy-reviewed-inputs` environment has a verified main-only branch policy and the expected input-secret name; no secret value was read. Trusted CI typecheck, reduced-motion, API/Postgres, build, department, and standard/full release jobs restore via that environment and clean up afterward. Non-main jobs retain their checks, select an unprivileged environment, and skip the secret-bearing restore step. An offline private-directory path reproduces the source fingerprint in a fresh export. PR builds requiring those data still fail rather than receive protected data or bypass a gate. Changing that boundary needs a separate owner policy decision; no green-PR or executed-remote-CI claim is made. |
| F1: “commit the whole audit directory” | **REJECT LITERAL RECOMMENDATION.** The fingerprint allowlist/build actually need the named runtime reconciliation JSON and its SHA-256 sidecar, not a blanket copy of private snapshots/manifests or every audit. The generated, pinned repair-plan subset does not reconstruct the full approved report and cannot silently replace it. **Owner:** repository/data owner. **Next action:** explicitly approve the two exact existing runtime files for this repository, or approve a restricted, digest-verified CI input delivery mechanism. No files were added to Git, and no external service was mutated. This repair remains in this task, not a new follow-up. |
| F2: release-concurrency job `120195694571` failed because station-activity group belonged to zero shards | **HISTORICALLY CONFIRMED / ALREADY FIXED IN CURRENT SOURCE.** Current `test:release:sync:1` includes the exact station-activity group. Current shard-inventory/concurrency fixtures pass, including exactly-once and deliberate missing/duplicate regressions. No shard was deleted, timeout increased, or extra browser certification substituted. |
| F3: aggregate release job `120196045615` in release run `39886470290` was “digest mismatch” and only a cascade | **CONTRADICTED / INDEPENDENT DEFECT REPAIRED.** `digest-mismatch: error` was an action input, not the failure. The job reports successful download and matching SHA-256, then rejects mismatched artifact provenance. The pinned download action explicitly extracts a single matching artifact directly to the requested path, even for a pattern download. The merger requires a producer-named directory. Standard and full producers now download by explicit name into their explicit run/attempt-bound directories; digest rejection and the merger's independent provenance checks remain intact. |

Independent artifact check for F3:

- Artifact `12472687865`, name
  `automated-test-results-release-standard-39886470290-1`, 2,043 ZIP bytes.
- GitHub-recorded **and independently computed** archive SHA-256:
  `a1d73c36b37ca8b609f91549b0a13cf6f191d5291afffd94be0119a0b9849186`.
- ZIP contains `test-results.json`; bounded inspection of run identity and
  artifact references agrees with the producer name/run/attempt.
- Failure was the extraction layout, not corrupt ZIP bytes. Workflow fixtures
  assert explicit standard/full directory naming and retained digest errors.
  Existing merger tests cover single and multiple producer reports, wrong
  run/revision/provenance, and missing lane outcomes. A remote rerun is NOT RUN.

Additional historical statuses: workflow lint run `39886470308` succeeded;
native Windows metadata run `39886470255` succeeded; production-dependency
security-audit job `120195694469` succeeded; declaration bridge job
`120195694159` succeeded. Node-advisory run `39886470385` and Docker/Caddy run
`39886470314` were cancelled. These are historical outcomes, not certification
of the repaired tree.

### Bounded review of the older PASS and architectural claims

| Named boundary | Current assessment / retained policy |
|---|---|
| Gold PASS | Approval/scoping/capability/input limits/safe errors exist and focused synthetic tests exercise them. Export content and retention still require human authorization. PASS was not proof of anonymization or provider uptime. New redirect/DNS and configuration repairs narrow the older claim. |
| Windows maintenance PASS | Inspected fail-closed native path/locking/timeout/atomic replacement design and the SHA-pinned, read-only, no-persisted-credentials, `pull_request` workflow. Exact historical Windows run succeeded. No local Windows execution or universal filesystem-platform certification is claimed. No workflow trigger, credential, dependency, or trust-boundary change was needed. |
| Station activity PASS | Current epoch/run/idempotency fences and scoped invalidation remain. Focused station-activity tests supplement the earlier integrated investigation. Cache is per process, bounded and short-lived; that is not a guarantee of multi-instance SSE or a cross-process consistency service. No cache or sync math was changed. |
| QC Brix PASS | Existing bounds, non-finite handling and inclusive/ULP-aware tolerances retained; focused math tests apply only to that named path, not all QC authorization/workflows. |
| Query-token removal PASS | Existing HTTP security and authentication regressions cover the removed query-token promotion boundary. No query-token bypass was restored or browser identity used as a credential. |
| Serial / identity recommendation | **REJECT BLANKET CONVERSION.** Current serial-preserving legacy generator and Publish policy is intentional. New Gold identity tables do not authorize converting populated legacy tables. Prior isolated sequence/push experiments and their limits are retained; no old conversion script, DDL, push-chain change, or blanket main merge was introduced. |
| Run-template seam/drain “missing” | **ALREADY INTEGRATED.** Consumed the prior branch investigation/current timeout seam and flush-drain repair; did not overwrite it or repeat historical flake-causation claims as current proof. |
| Per-process activity cache | **INTENTIONAL TOPOLOGY LIMIT**, not an accepted multi-instance guarantee; no architecture replacement is justified by this report. |
| Local-provider environment-trust assertion | **INSUFFICIENT / REPAIRED ON ACTUAL REQUEST PATH**, as detailed above. |
| “First ever CI”, all other failures inherited, and perpetually green/main assertions | Historical run existence and selected exact job outcomes are available, but they do not establish a complete all-time CI history or attribute every failure to ancestry. Such universal claims are **NOT ESTABLISHED**, and are not needed to repair F1–F3. |

## Probe consumer and compatibility inventory

Repository searches covered application scripts, tests, workflows, container
probes and the web client. No application UI directly consumes the old rich
public health envelope. External monitors outside this repository are not
discoverable from source; their coarse aliases remain available.

- Startup/development gates: `verify-startup-failures.mts`,
  `verify-clean-start.mts`, `check-department-playwright-projects.mts`,
  `verify-large-spec-import.mts`, large-spec harness and department/nightly
  workflows use HTTP/status or coarse `checks` values. Those values and aliases
  remain intact, including pending checks during startup.
- Container/rollback checks: `run-docker-caddy-browser-smoke.mjs`,
  `check-docker-runtime.sh`, `verify-render-image.mts`,
  `rehearse-schema-safe-rollback.mts` retain their probe URLs and status meanings.
  Historical Render/container references are not publication authorization.
- Published evidence: `prepare-published-evidence.mts` and
  `capture-readiness-recovery.mts` continue to consume coarse `/api/readyz`.
  The sanitizer already represents absent detailed workers as **unknown**,
  never as healthy workers. Public samples now prove core probe behavior only;
  they cannot prove a specific worker incident/recovery. An authorized
  `/api/health/diagnostics` response or existing operational telemetry is needed
  for worker-specific evidence. No release gate was waived to compensate.
- Local evaluator startup/smoke scripts use HTTP status or the public coarse
  checks for the app; their separate private evaluator `/healthz` contract is
  unchanged. App readiness does not certify an evaluator is loaded.
- Authorized operational diagnostics retain the detailed, safe enum/count
  read model. `/api/build-info` retains its intentionally public immutable build
  identity; it is not part of the removed runtime diagnostics.

Desktop, phone, tablet portrait/landscape, Chromium and WebKit UI dimensions:
**NOT APPLICABLE to changed rendering** because there is no UI component,
dialog, style, or user-flow change. Contract changes are API/generated-client
changes covered by focused checks. Physical Android/iOS/PWA verification:
**NOT RUN**, no authorized device access. No native-mobile requirement.

## Verification and failure ledger

All commands use the pinned wrapper
`bash scripts/src/run-release-node.sh ...` unless explicitly identified as a
read-only Git/metadata check. Isolated PostgreSQL 16 fixtures bind numeric
loopback on a random port and use private temporary data/socket directories.
Integration tests create/drop their disposable database; shell traps stop and
remove the cluster on both success and failure. No shared database was used for
regression fixtures or load. The normal development workflow was restarted once;
its existing development-schema preparation and routine startup hooks ran.

| Check / failure | Outcome and handling |
|---|---|
| API OpenAPI generation and library typecheck | PASS initially; final generated-drift verification recorded below. No hand-edited generated declarations. |
| Initial focused health, URL/redirect, HTTP security, rate and cost tests | PASS: 5 files, 64 tests. Later changed helper/health cases were checked again rather than treating this initial run as final evidence for new cases. |
| Import operations, parsers, health, helper, route inventory in a disposable database | First run: 98 PASS / 1 FAIL. Failure was an inherited missing freezer-surplus correction-history classification in the read inventory, not a bypass in the route (already `manage-inventory`). Added the existing requirement to the inventory. |
| Follow-up route inventory | Found two further inherited `manage-qc` intelligence read/export classifications missing. Added both existing policies, without broadening roles or changing handlers. Final route-inventory result recorded below. |
| Typecheck during development | Initial new test response bodies were `unknown`; fixed explicit fixture typings. API route, direct web and scripts typechecks then passed. |
| Initial full web `typecheck` entrypoint | FAIL before its compiler stage: pretypecheck Vite loading said “Invalid prepared build-source record.” Initially retained as an evidence blocker; the later completion attempt traced it to an obsolete ignored stage intermediate, repaired as recorded below. The three config-import unit tests and direct compiler had separately passed. No prepared Publish record was replaced. |
| First script-test invocation from repository root | FAIL: count reporter correctly could not attribute the synthetic summary to `@workspace/scripts` from the wrong working directory. Corrected to package-scoped execution; 39 Node tests passed. No reporter guard weakened. |
| Readiness test first run under Node's test harness | FAIL: a Vitest suite was invoked as a Node suite. Corrected harness; this was an invocation error, not a readiness defect. Final result recorded below. |
| Shard/concurrency and source-readiness contract checks | PASS with the supported package-scoped Node/tsx commands: exactly-once inventory and source/run identity regressions retained; six source/contract tests passed. |
| Workflow-wide check | FAIL on inherited `.replit` topology: Project includes `test:client` as well as `release:standard`; checker requires only the standard aggregate. This task did not edit `.replit`. The release owner owns runner topology and the inherited aggregate run; no timeout/gate change was made here. Changed GitHub workflow syntax is separately checked below. |
| First actionlint invocation | NOT REACHED: path supplied relative to repository rather than the package working directory. Corrected to `../.github/workflows/release-check.yml`; not a workflow syntax finding. |
| Extended isolated API set | 111 PASS / 1 FAIL out of 112. New opted-out-retry fixture wrongly sent unsupported capture flags (403), then an unsupported premix `mixes` key (400). With valid `candidates`, the changed request correctly returned 409 because the hash covers the whole body, including capture options. The assertion now requires 409 and checks the unchanged retry against its original receipt. No server validation or hash boundary was relaxed. Other 111 passes remain valid; final focused result is recorded below. |
| Clean tracked checkout without private inputs | Expected FAIL: required runtime audit inputs are absent. This negative gate remains enforced; tracking the private pair was not approved. |
| Fresh export plus approved private-directory delivery | PASS: the exact local runtime pair was staged with the production pin, the fingerprint matched `075cc2a0…`, Git binding stayed unavailable, cleanup removed the pair, and the subsequent missing-input check failed as required. No network, secret read, Git tracking or substitution. |
| Protected-input / identity regression | PASS: 27 tests in the initial focused loader/identity selection, including synthetic offline corruption, oversize, symlink, retry, permission and safe-error cases. Later workflow assertions are recorded separately, not retroactively added to this count. |
| CI input-access metadata | PASS, read-only: upstream repository metadata is public, main is protected, the existing environment's only custom branch policy is `main` of type `branch`, and its expected input-secret name exists. No secret contents, protection changes, or remote execution. |
| Inherited local release lock | An automatically started local `release:standard` run held the validation lock for 76 seconds of the focused check's wait. The exact workflow was confirmed and stopped; it began before these edits and cannot certify this tree. The separately assigned full-browser task was not changed. |
| Initial workflow-consumer assertion | FAIL: the test expected a trailing newline omitted by its own section slice. Corrected the assertion to accept a newline or the end of the slice, without relaxing the command or access guards. The earlier 40 passing cases remain separately measured. |
| Final private-delivery / artifact contracts | PASS: 41 Node tests; all seven newly wired job sections assert the main guard, protected-versus-unprivileged environment selection, step-local secret reference, cleanup, and preservation of existing job conditions. The existing pinned artifact extraction/provenance contracts also passed. |
| Final changed-workflow syntax | PASS: actionlint on `ci.yml`, `release-check.yml`, and `department-navigation.yml`, followed by `git diff --check`, in the same successful pinned-wrapper invocation. This is not a remote execution or a pass for the separately failing global `.replit` topology check. |
| Inherited running `release:standard` | Not this task's certification: it sampled an intermediate worktree during these edits. Its API typecheck/clean-start failures included the not-yet-generated diagnostic export and intermediate health-test typings; those are not independent baseline regressions and were addressed by codegen/focused compiler checks. It also reported the prepared-identity issue and reached container smoke before being stopped. No passing release result or source-bound certification is inferred from that mixed attempt. |
| Final opted-out capture contract | PASS: corrected focused integration flow, 1 passed / 33 deliberately unselected. Valid changed capture returns 409; unchanged retry returns the original receipt; no case is collected. This does not retrospectively turn either failed fixture invocation into a passing run. |
| Final API route typecheck | PASS after the corrected fixture. Direct calculator and scripts compiler checks also passed. These scoped results are not a substitute for the required full-workspace completion check. |
| Changed GitHub workflow syntax | PASS with the pinned `github-actionlint` executable and the package-relative workflow path. No remote workflow was triggered. Global `.replit` topology failure remains separate. |
| Readiness script test command | Correct Vitest invocation exited 0; no individual case summary was emitted in the retained command output, so no test count is invented. Six source-readiness/identity Node contract tests independently passed. |
| Gold client selection | PASS: 1 file, 2 tests. No UI behavior or retention control was changed. |
| Final `pnpm run check:api-generated` | PASS: toolchain/shell checks, regenerated-output comparison, generated Zod tests (6 passed), and forced generated client/Zod declaration builds. The conditional toolchain smoke separately selected one of its six cases; it is not counted as another complete six-case run. |
| Application-stage development startup and public requests | PASS at the application-repair fingerprint `23aa086d…`: normal API workflow build/restart, port 8080, startup ready, public alias/status allowlists through the development proxy, unauthenticated diagnostics 401, and a screenshot of minimal public health JSON. Startup also logged a nonblocking identity-sequence diagnostic-unavailable warning and pre-existing master-data-health findings. The subsequent private-input CLI/workflow changes do not change the health handler, but this is not a new whole-build or production-readiness certification for `075cc2a0…`. |
| Final whitespace / patch check | PASS: `git diff --check`. No private audit file was tracked. |
| First task completion attempt | Code review PASS; required `bash scripts/src/run-release-node.sh pnpm run typecheck` FAIL at the calculator's config precheck. Its API/scripts/mockup siblings were cancelled, not independently diagnosed as compiler failures. No validation was skipped. |
| Obsolete intermediate repair | Confirmed `.local/build-identity/web-stage-start.json` was ignored, had the old `production-source-v3` policy and `mode: publish`, failed the current validator, and was distinct from actual prepared/expected/sealed source records. No build or release process was active. Archived only that intermediate under a recoverable ignored filename; no source guard, policy, prepared Publish record, or evidence pin was rewritten. |
| Config-loading confirmation after archival | PASS: the real `check:vite-config-loading` command loaded both Vite configurations under bundle, runner and native loaders and checked all three config files' extensions. The full required typecheck is retried by the task-completion check; its recorded outcome there is authoritative, not inferred from this narrower pass. |

### Supported focused commands

These are checks, not permission to run production operations:

```sh
pnpm --filter @workspace/api-spec run codegen
pnpm --filter @workspace/api-server run typecheck:routes
pnpm --filter @workspace/run-calculator exec tsc -p tsconfig.json --noEmit
pnpm --filter @workspace/scripts exec tsc -p tsconfig.json --noEmit
pnpm --filter @workspace/scripts exec node --test \
  src/build-source-identity.test.mjs src/test-results.test.mjs
pnpm --filter @workspace/scripts exec node --test \
  src/restore-reviewed-build-inputs.test.mjs src/test-results.test.mjs
pnpm --filter @workspace/scripts exec tsx --test \
  src/release-concurrency-stress.test.mts src/source-readiness-contract.test.mts
pnpm --filter @workspace/scripts exec github-actionlint \
  -ignore SC2034 ../.github/workflows/ci.yml \
  ../.github/workflows/release-check.yml \
  ../.github/workflows/department-navigation.yml
```

The isolated API run covers import operations, health, URL/redirect/cancellation,
read authorization inventory, parser error handling, station activity, Brix and
authentication. Cost and HTTP-security tests were an earlier independent
passing selection. No production load test, fresh remote CI, or full browser
release was run.

## Handoff and evidence validity

The repairs change production API source and generated contracts. Any old
source-bound build identity, readiness capture, clean-start/build artifact or
release handoff for the pre-repair fingerprint does not certify these repairs.
The release owner must obtain new appropriately scoped build/startup/API
evidence after integration. The explicit-download workflow repair also needs a
future authorized remote run to prove the GitHub integration; local fixtures
are not a claimed remote success.

Final workflow SHA-256 identities:

- CI: `4e91192f8acf79ccf4cc0e905544db26ea43931d3a784eadcb3ad5e79f619c77`
- Release: `d37488fdcbc117540d57229f606ce27b2af66c6a417567454cf422611cf41dfc`
- Department: `4059fe2428d4d79681cf05435102f94d37375209ff26a93c15e9f0870e9df1c4`

The fresh-export check used `git archive HEAD` at
`22f4cf61f` with the changed input loader overlaid before invoking its offline
directory mode. Production source bytes were compared against the current
worktree fingerprint; workflow wiring was verified separately by the 41-case
contract selection and actionlint, not represented as executed in that export.
The exported fixture was removed afterward. Neither private file is tracked.

Existing full-browser partial passes cannot be silently transferred to a new
source revision. That certification and its unresolved failures stay with its
release owner. This task does not extend budgets, remove required tests,
weaken artifact provenance, or make published evidence optional.

The source-input decision was obtained: restricted CI/build delivery was
approved on 2026-10-24, not restoring the files to tracked source.
The protected environment was discovered and reused; no new secret, environment
configuration, repository protection, or remote run was created. Future runs
may create ordinary non-secret `unprivileged-ci` job-environment records; these
are not application publication. The main-only branch policy independently
prevents a PR from selecting the protected environment.

Untrusted PR compilation retains a prerequisite conflict: the current build
requires operational input bytes that the retained policy does not authorize
PR code to receive. It is not silently fixed by widening access, disabling
checks, fabricating evidence, or replacing approved bytes. Accountable owner:
repository/data owner, with the release owner for future certification.
Next action, if successful unprivileged PR builds are required: approve a
separate code-check/protected-packaging design or a different reviewed-code
access boundary. Neither was inferred from the restricted-delivery approval
or claimed implemented here.

The existing evidence-boundary decision explicitly records that restoring the
production report to tracked source would reverse an intentional data cleanup.
For that reason, **restricted, hash-verified build-input delivery is preferred
to tracking the audit directory**. A new input mechanism must preserve the
current exact-byte pins, source fingerprints and release provenance; it cannot
fabricate a Git binding or waive missing inputs.

The only two runtime files under consideration were independently compared with
historical main, with no content copied into this report:

| File | Bytes | SHA-256 | Historical bytes |
|---|---:|---|---|
| `source-library-reconciliation-2026-08-26.json` | 193520 | `1d8a2a3ddda96c32959e43fdcd901f3a14308bf12bc4d65ef4e2e3ce12505294` | identical |
| `source-library-reconciliation-2026-08-26.sha256` | 65 | `91b480e47b7a3ecb7cc5ab124ab43d57d463cdeb10709e01072ab4f1740940b5` | identical |

Automatically surfaced unbound deployment-log excerpts were not used to
attribute a production incident or certify this checkout. That would require
the separate deployment/revision evidence boundary.
