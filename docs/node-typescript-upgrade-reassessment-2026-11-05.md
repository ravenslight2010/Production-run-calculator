# Node.js and TypeScript upgrade reassessment

| Research date | 2026-11-05 |
|---|---|
| Repository revision reviewed | `4ee3d72898dd5529dde0867d165729d41fc72efe` |
| Current lockfile SHA-256 | `d103dfa4b08910fa7b095739c62ada16acc3af7b840238fe04df288c658c9d83` |
| Scope | Read-only upstream and repository readiness assessment |

This report makes separate decisions for the Node.js runtime and TypeScript compiler. It
does not authorize a runtime/compiler promotion, dependency update, deployment, or
production-readiness decision. No runtime or compiler pins, dependencies, lockfile,
workflow, deployment configuration, or authoritative release evidence were changed.

## Decisions at a glance

| Candidate | Recommendation | Bounded next action |
|---|---|---|
| Node 26 | **Do not promote yet; retain Node 24 as the project baseline.** Node 26 has entered LTS, but the comparison workflow and retained result are stale, two checks failed on both runtimes without retained causes, and Replit deployment support remains unconfirmed. | After the announced November 11 security releases, use a separately approved advisory comparison with then-current, age-qualified Node 24 and Node 26 patches. Preserve bounded sanitized failure diagnostics and resolve the shared failures before interpreting compatibility. |
| TypeScript 7 | **Keep TypeScript 6.0.3 authoritative and TypeScript 7.0.2 as the isolated CLI pilot.** TypeScript 7.1 now has a beta programmatic API with documented exports, but it is not stable, some legacy API coverage is missing, and TypeDoc still declares support only through TypeScript 6.0.x. | Reassess after the planned TypeScript 7.1 stable release and stable API documentation; first map every current API consumer and verify a peer-clean TypeDoc/plugin/Orval graph. Any migration requires its own approval. |

These decisions are independent. Node 26's LTS status does not qualify this repository's
runtime or deployment. TypeScript 7.1's beta API does not change the compiler authority or
make TypeScript 7 stable.

## Node.js runtime

### Official release and security status on 2026-11-05

The live Node.js releases page, schedule, and release notes report:

| Line | Latest release shown | Phase on 2026-11-05 | Schedule / support date |
|---|---|---|---|
| 27 | `27.0.0-alpha.0.0.0` | Alpha; not a production candidate | Schedule lists the new annual-cycle line; do not treat its planned dates as a release. |
| 26 | `26.13.0` (released 2026-10-28) | Active LTS, codename Lithium | LTS began 2026-10-28; Maintenance planned 2027-10-20; EOL 2029-04-30. |
| 24 | `24.22.2` (released 2026-10-28) | Maintenance LTS, codename Krypton | Maintenance began 2026-10-20; EOL 2028-04-30. |
| 22 | `22.23.4` (released 2026-10-21) | Maintenance LTS, codename Jod | EOL 2027-04-30. |
| 20 | `20.20.2` | EOL | EOL 2026-04-30. |

The releases page says production applications should use Active LTS or Maintenance LTS.
The prior October 14 assessment's planned Node 26 LTS transition has occurred: release
`26.13.0` explicitly marks that transition. The October 21 security release was published
for the 26.x, 24.x, and 22.x lines. Its HIGH-severity fixes include DNS NUL-byte handling
(CVE-2026-105482), TLS hostname verification issues (including CVE-2026-105483 and
CVE-2026-106069), and a Brotli decoder memory-safety issue (CVE-2026-111497); the notice
also lists medium- and low-severity fixes and dependency updates.

As of this research date, Node has separately announced new 26.x, 24.x, and 22.x security
releases **on or shortly after 2026-11-11**, with HIGH as the highest severity on each
line. The announcement does not yet list the CVEs or patched versions. The latest October
patches are therefore not a substitute for refreshing the baseline after those releases.

### Repository contracts and package declarations

| Evidence | Current state | Interpretation |
|---|---|---|
| `.nvmrc` and CI/release pins | `.nvmrc` is `24.21.0`; `.github/workflows/ci.yml` and `.github/workflows/release-check.yml` pin `24.21.0`. | Node 24 remains the tested project baseline, but the exact patch is behind the current official `24.22.2`. |
| Container | `Dockerfile` pins `node:24.21.0-slim` by digest and checks its version against `.nvmrc`. | The container remains on Node 24.21.0. This does not establish what runtime a Replit deployment currently uses. |
| Replit workspace/deployment | `.replit` selects `nodejs-24` and configures an Autoscale build and Node run command. | This is configuration evidence for Node 24, not proof of an exact deployed patch. |
| Root engine contract | `package.json` declares Node `>=24` and pnpm `>=12`; pnpm is pinned to `12.8.1`. | The broad engine range admits Node 26 but is not a compatibility guarantee or promotion gate. |
| Locked tooling metadata | Current locked versions include Vite `8.3.4` (`^20.19.0 || >=22.12.0`), Vitest `5.0.5` (`^22.12.0 || ^24.0.0 || >=26.0.0`), esbuild `0.28.2` (`>=18`), and Rolldown `1.2.12` (`^20.19.0 || >=22.12.0`). | These declared ranges admit Node 26 for these packages. They do not qualify the whole dependency graph, native binaries, app behavior, deployment, or production workload. |
| Current shell | `node --version` returned `v24.22.1`; this differs from `.nvmrc`. | This is a local workspace observation only. It is not CI, deployment, or production runtime evidence. |
| Advisory workflow | `.github/workflows/node-compatibility-advisory.yml` and `scripts/src/node-compatibility-advisory.mjs` still compare Node `24.21.0` with `26.10.0`. | The lane does not test the current exact patches and remains advisory-only. |

The current package declarations reduce one compatibility concern but do not supersede
execution evidence. In particular, the workflow must exercise fresh installs and the
platform-specific build packages on its intended runner.

### Retained Node comparison and qualification boundary

The October 6 retained Node comparison is
[`node-26-compatibility-comparison-2026-10-06.json`](node-26-compatibility-comparison-2026-10-06.json),
SHA-256 `feda0095e9d09e0a122298177ad627f024139afc02d65b584bab915d980cfa83`. It records
GitHub Actions run `37506619630`, attempt 1, source revision
`6a18a7d85e7150ac0e56500bc47696724f1b3a02`, Node `24.21.0` versus `26.10.0`, and lockfile
SHA-256 `251d67bf080b4e0c8015913bc3f66e8229af0e8763325cfa723c93629e9e3f13`. The current
lockfile hash is different, and neither tested runtime is the current patch.

Frozen install, typecheck, database creation/schema application, and API integration shard
1 passed on both versions. The run-calculator budget test and production build both failed
with `EXIT_CODE_1` on both versions. The workflow deleted the command output, so the causes
are **unknown**. This is neither evidence of a Node-26-only regression nor a clean
qualification result. The responsible role is the Node advisory workflow maintainer; the
next comparison should retain bounded, sanitized failure diagnostics and resolve or explain
both common failures before the results are interpreted.

GitHub-hosted advisory results are not Replit or production evidence. Replit documentation
describes workspace modules in `.replit` and deployment build/run configuration separately,
but does not confirm a Node 26 workspace module or Node 26 Autoscale runtime support.
**Replit Node 26 deployment support remains unknown.** Production qualification has not
been performed.

### November 5 execution record and readiness decision

The latest official exact patches available on 2026-11-05 are Node `24.22.2` and `26.13.0`,
both released on 2026-10-28. They have been available longer than the repository's
24-hour package release-age window; that pnpm policy applies to npm packages, not Node
runtime binaries. Node's official notice announces new 24.x and 26.x security releases on
or shortly after 2026-11-11, with HIGH as the highest severity, but does not yet publish
the patched versions. The advisory inputs were therefore left unchanged: selecting the
then-current post-release patches now would be premature, and the October versions are
not a substitute.

The authorized GitHub Actions read found a November 5 advisory run
([`41966901422`](https://github.com/ravenslight2010/Production-run-calculator/actions/runs/41966901422),
attempt 1). Its retained artifact was captured at `2026-11-05T04:32:22.484Z` and records
source revision `fc9d38ee6c32a46e8c7e095010375f66cf4ed2e4` and lockfile SHA-256
`d103dfa4b08910fa7b095739c62ada16acc3af7b840238fe04df288c658c9d83`, which matches the
current lockfile. It still compared Node `24.21.0` with `26.10.0`, not the current patches.
Install, typecheck, database creation/schema, and API integration shard 1 passed on both
versions; `run-calculator-budget` and `production-build` failed on both. The artifact
retains only exit codes and measurements; the workflow deletes command output. This is one
same-run comparison on a different source revision with stale runtime inputs, not either
of the two required clean successful candidate comparisons. The task revision reviewed
here is `d58368fd3cf947e3bbedad1045eef4429ab99da6`.

Task-scoped local verification used the current revision and lockfile:

| Check | Result | Evidence and boundary |
|---|---|---|
| `CI=true bash scripts/src/run-release-node.sh pnpm run typecheck` | **PASS** | Ran with the pinned Node `24.21.0` and pnpm `12.8.1`; Node 24 coverage remains present in CI and release workflows. |
| `node --test scripts/src/node-compatibility-advisory.test.mjs` | **PASS** | Four harness tests passed under the workspace's Node `24.22.1`; this validates helper logic only, not either runtime comparison. |
| `pnpm --filter @workspace/run-calculator run test:budget` | **FAIL** | One test failed: the paused packaging-drain case expected 64 total cases but received 63. This is a common product/test failure, not evidence of a Node-specific incompatibility. Its `useAutoTrack.ts` surface overlaps active Task #3795 (phone controls after background wake); do not modify that shared code in this task. Task #3795's owner should resolve or classify the failing case, then the comparison can be rerun. |
| `pnpm run build` with the advisory's production environment | **FAIL locally; hosted cause unknown** | The local run stopped before compilation because the workspace's ignored prepared-source record did not match the current source fingerprint. That workspace-only identity issue does not explain the clean hosted run, whose command output was discarded. The hosted build failure remains unresolved; the Node advisory workflow maintainer owns retaining bounded, sanitized diagnostic summaries and explaining it. No source identity was refreshed as release preparation is outside this task. |
| Complete standard release suite | **NOT RUN** | This task makes no runtime or release-evidence changes. The retained standard state is dated 2026-10-24 and already records failed gates; it is not a current pass. A full release rerun is not substituted for the missing post-security-release comparison. |

Replit's official configuration documentation describes Nix-managed packages. A targeted
Replit documentation search returned only conditional Node 26 capability (“if supported
by the channel”), not confirmation for this app. The authorized available-module list in
this workspace showed Node 20, 22, and 24 (currently Node 24.22.1) but no Node 26 module.
The deployment documentation reviewed does not establish a Node 26 option for this app's
Autoscale deployment. No production deployment was queried, consistent with the task's
access boundary.
**Replit Node 26 deployment support is therefore unknown, not supported or unsupported.**

**Dated readiness recommendation: NO-GO for Node 26 promotion.** Node 26 is officially
Active LTS, but this repository has no two clean passing comparisons on current exact
patches, the shared budget-test failure is unresolved by its owning task, the hosted build
failure has no retained cause, and Replit deployment support is unverified. Keep the
authoritative Node 24 pins and required Node 24 coverage. After the announced November 11
security releases, the Node advisory workflow maintainer should recheck the official
patches and release-age status, update only the advisory inputs, retain bounded sanitized
diagnostics, explain shared failures, and obtain two clean hosted comparisons on one
revision and lockfile. Complete applicable release checks and obtain authoritative Replit
runtime evidence before any separately approved promotion.

Before any separately approved Node 26 promotion:

1. Wait for the announced November 11 security updates and select the then-current, exact
   Node 24 and Node 26 patches after checking the repository's release-age requirement.
2. Refresh the advisory comparison on one source revision and current lockfile; retain
   bounded sanitized diagnostics for failures and explain the two shared failures.
3. Obtain at least two clean successful hosted comparisons and pass the complete required
   release suite without weakening the Node 24 baseline.
4. Obtain authoritative evidence for the selected Node version in the Replit deployment
   build/runtime, or keep that support explicitly unresolved.
5. Only in a separately approved promotion change, align the runtime pins, container image,
   CI/release checks, and evidence contracts together, with a tested Node 24 rollback path.

## TypeScript compiler and programmatic API

### Official release and API status on 2026-11-05

Microsoft's release list identifies **TypeScript 7.0.2** as the latest stable compiler
release; the 7.1 beta is marked a pre-release. The npm registry reports
`latest=7.0.2`, `beta=7.1.0-beta`, and `next=7.1.0-dev.20261104.1`. The repository's current
stable authority, TypeScript `6.0.3`, is also still present on Microsoft's release list.

TypeScript 7.1 materially changes the API picture since the October 15 assessment:

- The official 7.1 beta package now exports programmatic entry points such as
  `typescript/sync`, `typescript/async`, `typescript/ast`, `typescript/fs`, and
  `typescript/path`; these are no longer under the 7.0 `typescript/unstable/*` paths.
- In the TypeScript team's October 9 API-status discussion, Microsoft says it believes the
  beta's exposed APIs are stable and forward-compatible, while explicitly reserving the
  possibility of breaking changes before 7.1 stable.
- That discussion says watch/incremental/solution-builder APIs will not land as stable in
  7.1, notes that some utility and program/checker APIs are missing, and says complete
  API-difference documentation is expected by stable release.
- The iteration plan schedules a 7.1 release candidate for November 10 and stable release
  for November 24, 2026. Those are planned dates, not published releases.

Accordingly, “no programmatic API exists” is no longer an accurate current statement.
However, as of November 5 the API is a beta, its final documentation and coverage mapping
are incomplete, and current consumers have not been shown to map to the stable 7.1 surface.
The API migration blocker is **reduced but not cleared**.

### Repository boundary, ecosystem support, and comparison evidence

| Evidence | Current state | What it does and does not establish |
|---|---|---|
| Compiler authority and pilot | Root `package.json` declares `typescript: ~6.0.3` and `typescript-native: npm:typescript@7.0.2`; the lockfile matches. | TypeScript 6 remains the compiler authority; TypeScript 7.0.2 is a separate CLI candidate. No 7.1 dependency change was made. |
| Programmatic API consumers | The October 15 report identified eleven source files behind `@workspace/typescript-api-v6`. A fresh source search on this revision finds fourteen consumer modules. Three additional consumers are `artifacts/run-calculator/scripts/check-as-any-budget.mjs`, `artifacts/run-calculator/scripts/check-home-deferred-boundary.mjs`, and `artifacts/run-calculator/src/homeDayOverlayQueue.test.ts`. Existing operations include parsing and AST traversal, diagnostics, preprocessing, module resolution, and `transpileModule`. | The boundary still protects existing consumers. Beta export names alone do not establish a compatible replacement for every operation. The October inventory is stale and should not be treated as complete. |
| TypeDoc peer contract | Current `typedoc@0.28.20` registry metadata declares `typescript` peers through `6.0.x` only. It is still the registry's latest TypeDoc release. | A strict peer-clean promoted toolchain cannot use this TypeDoc release with TypeScript 7.1. Prior isolated testing also found TypeDoc 0.28.20 failed at runtime with TypeScript 7.0.2; that is direct evidence for 7.0.2 only, not a test of the 7.1 beta. |
| Orval and plugins | The lockfile uses Orval `8.43.0`, TypeDoc `0.28.20`, Markdown plugin `4.14.0`, and coverage plugin `4.0.3`. Current registry metadata lists Orval `8.46.0`; it declares TypeDoc `^0.28.19` and Markdown plugin `^4.10.0`, but no direct TypeScript peer. | Orval's own metadata does not remove TypeDoc's TypeScript peer constraint. The current latest Orval graph has not been shown to make TypeDoc compatible with TypeScript 7. |
| Historical TypeScript comparison | H-72383 is the retained 2026-09-21 comparison at revision `72383c601448d234b7813451618c293ebdca7ac8`, TypeScript 6.0.3 versus 7.0.2; artifact SHA-256 `9b26918612dff8f0f8d8d0b7629ac0524a3f195a9b45258a17be10894d275739`. | It supports only its recorded command results. It does not establish current 7.1 API behavior or link to later declaration classifications. |
| Declaration contracts | C-858078 is captured 2026-10-15 at revision `858078ed44c8838cedfa80b40c4950ac42b668e2`, source-bundle SHA-256 `3468d08570540775d10b5df16eb43ea0318545ded502e1ebfac822f47fb722a7`, artifact SHA-256 `251574261e7752208d67a47b927c06156c8e3da2e4488ab7c4fddd3b379d3b48`. It classifies 282 changed files as 273 formatting-only, 9 approved semantic, and 0 unexplained semantic. | This classification applies only to C-858078's inputs. It is not linked to the compiler command results in the separate R-testsha artifact. |
| Current retained comparison | `release-evidence/typescript-7-comparison.json`, SHA-256 `28da2c9be10f711d9eef805dafd698bc92a5a3c0bd3d0a57cd67853b2f80caeb`, reports TypeScript 7.0.2 and `ADVISORY_DRIFT`; its source identity is `test-sha256:6c3f05086161635b2e9c417090a3c06291abb692760dd6c251c905b3d068ee43`, not a Git revision, and it has no capture timestamp. Its recorded measured commands exited 0. | This is a successful set of recorded commands but not clean, independently revision-bound promotion evidence; `ADVISORY_DRIFT` is not a pass and is not proof of compiler incompatibility. |
| Latest standard-check state | `release-evidence/release-check-state.json`, SHA-256 `693c230c5e4593515d3f09539f5bb66f965952568362351ce685ea1666f867f3`, is dated `2026-10-24T16:00:22.245Z` and records source identity `test-sha256:673cdbfdcbfb54c74190f74081ea95f79b23895bbdc7f9a5aa56f0e32921062a`. It records the TypeScript 7 advisory comparison as `BLOCKED` by a failed run-calculator typecheck. | The failure cause is not in this state record. It blocks that run's comparison; it does not show a TypeScript-specific error. The accountable role is the maintainer of the blocked release-check evidence; next action is to resolve or explain the prerequisite typecheck and rerun the comparison on a source-identified revision. |
| Promotion checkpoint | `release-evidence-typescript-7-promotion/release-check-checkpoint.md` is an `INCOMPLETE / NO-GO` checkpoint dated 2026-09-16, not a current promotion result. It records a source-library preflight failure: a partial fixture had 3 of 68 expected pool rows and 3 of 25 expected aliases. | That database fixture blocked downstream promotion gates. It is not evidence of compiler incompatibility or a current promotion attempt. The accountable role is the source-library reconciliation evidence maintainer; the next action is a valid source-library preflight if that promotion checkpoint is ever resumed. |

The root project has additional compiler comparison and isolated-codegen checks, but their
results must remain bound to their own revision and artifact identities. In particular,
the R-testsha compiler results, C-858078 declaration classifications, historical H-72383
results, and older promotion checkpoint must not be combined as if they were one current
successful promotion run.

The independent editor SDK gate, approved-runner history, and promotion-mode full release
gates also remain separate evidence requirements. A passing TypeScript 7 CLI comparison is
not editor proof or a production compiler qualification.

### TypeScript next decision point

Do not promote TypeScript 7 or migrate API consumers on the beta. Reassess after the stable
7.1 package and its promised API documentation are actually published. Before a separately
approved migration:

1. Map all fourteen current TypeScript 6 API consumer modules operation-by-operation against stable 7.1
   exports, explicitly identify unsupported helpers, and prove the needed behavior with
   focused tests or keep those consumers isolated on TypeScript 6.
2. Resolve TypeDoc peer support and run a clean strict-peer install plus TypeDoc/plugin/
   Orval generation and runtime smokes. Do not treat Orval's lack of a direct TypeScript
   peer as TypeDoc compatibility.
3. Produce a fresh compiler comparison and declaration-contract report from the same
   source bundle and revision, with exact output hashes and zero unexplained declaration
   changes. Keep the existing TypeScript 6 authority until all checks are reviewed.
4. Complete the live editor SDK check, supported-runner coverage, and the full
   separately-approved promotion gates. A blocked check remains blocked until rerun.

## Source record and limits

Official sources checked 2026-11-05:

- [Node.js Releases](https://nodejs.org/en/about/previous-releases) — current release-line
  patches/status and production LTS guidance.
- [Node.js release schedule](https://github.com/nodejs/Release/blob/main/schedule.json) —
  phase and EOL dates; schedule is live and planned milestones can change.
- [Node.js 26.13.0](https://nodejs.org/en/blog/release/v26.13.0),
  [24.22.2](https://nodejs.org/en/blog/release/v24.22.2), and
  [22.23.4](https://nodejs.org/en/blog/release/v22.23.4) release notes.
- [October 21, 2026 security releases](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)
  and [announced November 11, 2026 security releases](https://nodejs.org/en/blog/vulnerability/november-2026-security-releases).
- [Replit App Configuration](https://docs.replit.com/features/project-setup/configuration)
  and [Deployment types](https://docs.replit.com/features/publishing/deployment-types);
  documentation search and the available Node module list did not verify Node 26
  deployment support for this app.
- [Microsoft TypeScript releases](https://github.com/microsoft/TypeScript/releases),
  [TypeScript 7.1 beta announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/),
  [API status discussion](https://github.com/microsoft/TypeScript/issues/64709), and
  [7.1 iteration plan](https://github.com/microsoft/TypeScript/issues/63703).
- [TypeScript npm dist-tags](https://registry.npmjs.org/-/package/typescript/dist-tags)
  and [`typescript@7.1.0-beta` package metadata](https://registry.npmjs.org/typescript/7.1.0-beta).
- [`typedoc@0.28.20`](https://registry.npmjs.org/typedoc/0.28.20) and
  [`orval@8.46.0`](https://registry.npmjs.org/orval/8.46.0) registry metadata.
- [Replit configuration docs](https://docs.replit.com/features/project-setup/configuration)
  and [deployment types](https://docs.replit.com/features/publishing/deployment-types).
  The queried docs distinguish workspace configuration from deployment configuration but
  do not establish Node 26 support for this app's deployment.

Repository evidence reviewed includes `.nvmrc`, `package.json`, `pnpm-lock.yaml`,
`pnpm-workspace.yaml`, `.replit`, `Dockerfile`, the Node advisory workflow and script,
the retained Node comparison, the TypeScript migration report and comparison artifacts,
the TypeScript API boundary/compiler comparison code, and current release-check evidence.
Current package metadata and live upstream pages are point-in-time observations, not
immutable attestations. Where artifact identity, failure output, or deployment evidence is
missing, this report leaves the result unresolved rather than inferring success or failure.
