# TypeScript 7 Migration Research

**Background comparison date:** unresolved; latest reassessment: 2026-10-15 (see final section)
**Current compiler:** TypeScript 6.0.3  
**Compared compiler:** TypeScript 7.0.2  
**Recommendation:** **Keep TypeScript 6 authoritative; retain TypeScript 7 only as the parallel CLI pilot.**

## Comparison evidence identities

Run-specific claims in this report must be read against the exact evidence identity below.
The filename date, report prose date, and a matching aggregate count do not establish that
two artifacts came from the same run.

| ID | Retained artifact and source identity | Evidence it supports | Limits |
| --- | --- | --- | --- |
| **H-72383** | [`docs/evidence/typescript-7-comparison-2026-09-15.json`](evidence/typescript-7-comparison-2026-09-15.json), SHA-256 `9b26918612dff8f0f8d8d0b7629ac0524a3f195a9b45258a17be10894d275739`; source revision `72383c601448d234b7813451618c293ebdca7ac8`; artifact capture date `2026-09-21`; Node `24.20.0`; TypeScript `6.0.3` vs `7.0.2`. | Its named command exit codes, diagnostic counts, elapsed times, declaration totals, and package totals. | The filename says 2026-09-15, but that is not the capture date. It does not identify the report's claimed 2026-09-16 run or Node `24.13.0`; no source-bundle hash, raw diff, or per-file contract report is retained for this identity. |
| **A-63cfd** | [`release-evidence-archive/stale-full-2026-09-14/evidence/typescript-7-comparison.json`](../release-evidence-archive/stale-full-2026-09-14/evidence/typescript-7-comparison.json), SHA-256 `1858af0cf86c6dfa25fc6a8da696f6de9e3016bb4ba54fe7725d73f9bf0b5de4`; source revision `63cfd77eef883cba583636e6fc4c72fa37cc24a6`; TypeScript `6.0.3` vs `7.0.2`; runner image `unknown`. | This separate artifact's command outcomes, runner details, 795 declarations per compiler, and 217 changed paths. | It is not H-72383. It has no capture date or Node version and cannot establish H-72383's environment or contract classifications. |
| **R-testsha** | [`release-evidence/typescript-7-comparison.json`](../release-evidence/typescript-7-comparison.json), SHA-256 `28da2c9be10f711d9eef805dafd698bc92a5a3c0bd3d0a57cd67853b2f80caeb`; source identity `test-sha256:6c3f05086161635b2e9c417090a3c06291abb692760dd6c251c905b3d068ee43`; TypeScript `6.0.3` vs `7.0.2`. | This artifact's command outcomes, runner identity, 983 declarations per compiler, and 282 changed paths. | The source identity is not a Git revision and this JSON has no capture timestamp or Node version. |
| **C-858078** | [`docs/evidence/typescript-7-declaration-contracts-current.json`](evidence/typescript-7-declaration-contracts-current.json), SHA-256 `251574261e7752208d67a47b927c06156c8e3da2e4488ab7c4fddd3b379d3b48`; captured `2026-10-15T11:26:57Z`; source revision `858078ed44c8838cedfa80b40c4950ac42b668e2`; source-bundle SHA-256 `3468d08570540775d10b5df16eb43ea0318545ded502e1ebfac822f47fb722a7`. | Its retained per-file classifications: 983 files per compiler, 282 changed, 273 formatting-only, 9 approved semantic, 0 unexplained. | Its source identity differs from R-testsha. It does not prove that R-testsha's command results and this report's classifications came from one comparison. |
| **AP-8d043** | [`docs/evidence/typescript-7-declaration-approvals.json`](evidence/typescript-7-declaration-approvals.json), SHA-256 `8d043fd34bc52104a73ab2964ef1bedbcd5dc0fe9b18a38d37b1bfb39d35e02c`. | The retained exact-output-hash approval entries and their recorded reasons. | This file alone does not establish which comparison produced either side's declaration; use it only with the matching source identity in a comparison report. |
| **RA-RESOURCE** | [`docs/typescript-7-resource-approval-evidence.json`](typescript-7-resource-approval-evidence.json), SHA-256 `7697f0789ce5097f6e7e8d95beade78116de1eb25fad345226064b403b73ae0b`. | Its three resource-measurement summaries, source revisions, workflow run IDs, report hashes, and reviewed limits. | It is resource-threshold evidence, not compiler compatibility or declaration-classification evidence for H-72383. |
| **AUD-7ad2** | The report describes a 2026-09-16 audit at revision `7ad2e471a5fc5a9b08348f9743244696f44b68a1`, but its detailed comparison output was under `/tmp` and is not retained. That commit is not available in the local Git object database. | None of its unretained run-specific outcomes can be independently verified here. | Mark its compiler results, declaration totals, environment, and run recommendation **unresolved**. Neither A-63cfd nor H-72383 is a substitute. |

The retained-summary command checks count agreement only. It is not proof of compiler
execution, source identity, runtime metadata, or contract classification.

## Executive summary

The compact historical comparison H-72383 (filename dated 2026-09-15; artifact capture
dated 2026-09-21) records successful TypeScript 6.0.3 and TypeScript 7.0.2 checks and lower
candidate elapsed times for its named commands. This is a report of that artifact's results,
not a general compatibility or performance claim:

- Its forced shared-library project build and six named `--noEmit` checks reported exit code
  0 and zero diagnostics under both compilers. The 35-project scope claim is not recorded
  in this compact artifact.
- Its API server, run calculator, mockup sandbox, scripts, AI evaluation, and corpus harness
  checks reported exit code 0 and zero diagnostics under both compilers.
- Its generated API client/Zod forced build reported exit code 0 and zero diagnostics under
  both compilers. The broader claim about acceptance of specific TypeScript configuration
  options is not established by this summary.
- For the named run-calculator `--noEmit` check, H-72383 records 43.998 seconds under
  TypeScript 6 and 2.710 seconds under TypeScript 7. The earlier 50.76/3.73-second
  web-client figures are **unresolved**: no retained comparison artifact here supports them.

The production toolchain should not switch yet for three reasons:

1. TypeScript 7.0 deliberately has no stable programmatic API. Its root `typescript` export
   exposes version information, not the TypeScript 6 parser/traversal/transpile API used by
   eleven repository files.
2. The current TypeDoc 0.28.20 peer range ends at TypeScript 6.0.x. TypeDoc is pulled in by
   Orval, so replacing the root compiler would make the resolved code-generation toolchain
   unsupported even though Orval itself does not declare a TypeScript peer.
3. TypeScript 7 produces textual declaration differences concentrated in generated API/Zod
   declarations and database declarations. The fail-closed contract comparison now
   classifies equivalent formatting changes and pins every reviewed non-formatting change
   to the exact TypeScript 6 and TypeScript 7 output hashes in retained report C-858078.
   That classification is for C-858078's source identity only; H-72383's historical
   classifications remain unresolved. Any new or changed semantic output still blocks
   promotion.

Microsoft explicitly recommends running TypeScript 7 side-by-side with the
`@typescript/typescript6` compatibility package for tools that still need the old API.
This repository should first add a non-gating TypeScript 7 lane while retaining 6.0.3 as
the authoritative compiler and API package. This recommendation is a conservative tooling
decision, not a conclusion from one comparison run: historical command evidence is H-72383,
the retained resource thresholds are RA-RESOURCE, and the later API/TypeDoc assessments are
separately dated in the reassessment sections below. The historical declaration-contract
claim remains unresolved as described under H-72383.

### Editor language-service gate

The checked-in editor configuration names `node_modules/typescript/lib` as the workspace SDK,
which resolves to the authoritative `typescript@6.0.3` workspace package. In an open Replit
editor session, the promotion smoke additionally verifies that the live
`typescript-language-server` process actually launched its `tsserver` child from that exact
workspace path. The separately named `typescript-native` TypeScript 7 CLI alias is not an
editor SDK.

Run the repeatable editor smoke before any TypeScript 7 promotion:

```bash
pnpm run check:editor-typescript
```

An intentional promotion attempt must use:

```bash
pnpm run release:check:typescript-7-promotion
```

That release mode replaces the advisory comparison step with a fail-closed promotion gate.
The gate invokes `pnpm run check:editor-typescript` and records the selected editor SDK
path, resolved SDK version, and smoke outcome in
`release-evidence-typescript-7-promotion/typescript-7-comparison.json`. A failed diagnostic
or definition-navigation assertion makes the promotion command fail. Promotion checkpoints
resume with the same promotion command and always rerun the live editor proof. Standard and
full release checks continue to run the TypeScript 7 comparison as advisory only.

Run the command from an open Replit editor session. The smoke fails unless the configured SDK
resolves to TypeScript 6.0.3 and a live editor language-server child uses that exact
`tsserver.js`. It then starts the same SDK in a disposable strict TypeScript project, confirms
an expected semantic diagnostic, and confirms go-to-definition navigation into a second
source file. This check is a promotion prerequisite, not evidence that the advisory
TypeScript 7 CLI is ready to become the editor service.

## Repository compiler coupling

### Compiler commands and project modes

The root package pins `typescript: ~6.0.3` as the authority and installs TypeScript 7 under
the `typescript-native` alias. Both packages expose a binary named `tsc`, so authoritative
commands must not rely on pnpm's shared `.bin/tsc` link. They invoke
`node_modules/typescript/bin/tsc` explicitly for:

- `--build` for the root project-reference graph.
- `--build --force` for generated API declarations and selected prerequisite libraries.
- `-p ... --noEmit` for the API server, web client, mockup sandbox, scripts, and two
  standalone library checks.

The root `tsconfig.json` references 35 shared libraries. The earlier report says the
comparison build had 36 projects in scope and built 35 after transitive references; those
run-specific project totals are **unresolved** because H-72383 does not record them and the
run report that was said to contain them is not retained.

Shared libraries use `composite: true`, `declarationMap: true`,
`emitDeclarationOnly: true`, and an explicit `rootDir`/`outDir`. The repository contains 39
such composite/declaration-only configurations. Application and script projects use
`noEmit` where appropriate.

The shared base configuration explicitly sets the TypeScript 7-sensitive defaults:

- `module: "esnext"`
- `target: "es2022"`
- `moduleResolution: "bundler"`
- `types: []`
- `alwaysStrict: true`
- `customConditions: ["workspace"]`

No repository tsconfig uses the removed `target: "es5"`, `moduleResolution: "node"`,
`moduleResolution: "classic"`, `baseUrl`, `module: "amd"`, `module: "umd"`,
`module: "system"`, or `module: "none"` settings. TypeScript 7 still lists
`downlevelIteration` in CLI help, but the repository does not set it.

Three projects use `allowImportingTsExtensions`; each also satisfies TypeScript 7's
requirement by using `moduleResolution: "bundler"` with either `noEmit` or
`emitDeclarationOnly`.

The repository does not use `tsc --watch` in package scripts. Vite owns the interactive
development workflow. TypeScript 7's rebuilt watcher is therefore not a migration gate,
though editor validation remains a later pilot concern.

### Generated API and declaration checks

`check:api-generated` combines:

1. the API specification generated-file check,
2. API Zod tests, and
3. forced declaration builds for `api-client-react` and `api-zod`.

The compiler-neutral generated-file check and API Zod tests passed under the current
workspace. The exact TypeScript 7 forced-build command for the two generated packages also
passed without diagnostics in the isolated copy.

### Direct `typescript` module consumers

As reassessed on 2026-10-15, TypeScript 7.0.2's root module cannot replace any consumer
that currently calls the TypeScript 6 compiler API. The npm `latest` tag remains 7.0.2;
`next` points to `7.1.0-dev.20261013.1`. The 7.0 package exposes `typescript/unstable/*`
entry points, but Microsoft labels the API unstable and describes a different API for
TypeScript 7.1. Rewriting against unstable or development APIs is not an acceptable
production migration path.

| Consumer | TypeScript 6 API use | TypeScript 7 disposition |
| --- | --- | --- |
| `scripts/src/check-evaluation-report-retention.mts` | Parse source, inspect AST node types and guards, traverse nodes | Keep on TypeScript 6.0.3; no stable TypeScript 7 parser/traversal API is published. |
| `scripts/src/compare-declaration-contracts.mts` | Scanner, source-file parsing, declaration AST inspection, import preprocessing and module resolution | Keep on TypeScript 6.0.3; this comparator is migration evidence and must not depend on an unstable parser. |
| `artifacts/run-calculator/e2e/validate-browser-spec-syntax.ts` | Parse source and diagnostics, flatten diagnostic text, compiler filesystem access | Keep on TypeScript 6.0.3; no stable equivalent has been documented and exported. |
| `artifacts/run-calculator/src/freezerDomainIsolation.test.ts` | TSX parsing, AST traversal and node guards | Keep test tooling on TypeScript 6.0.3. |
| `artifacts/run-calculator/src/blankRunValueSync.test.ts` | Parse and evaluate AST literals; traverse nodes and inspect syntax kinds | Keep test tooling on TypeScript 6.0.3. |
| `artifacts/run-calculator/src/runValueStampGuard.test.ts` | TSX parsing, AST traversal, function/accessor/import/identifier inspection | Keep test tooling on TypeScript 6.0.3. |
| `artifacts/run-calculator/src/applyCaseUpdateChoices.web.test.ts` | TSX parsing and traversal; `transpileModule` | Keep on TypeScript 6.0.3; no stable TypeScript 7 root equivalent for `transpileModule` is published. |
| `artifacts/run-calculator/src/e2eIsolation.test.ts` | Parse source; inspect AST calls, imports, lexical bindings and syntax nodes | Keep test tooling on TypeScript 6.0.3; this guard protects browser fixture database isolation. |
| `artifacts/run-calculator/src/contexts/__tests__/useLiveRun-allowed-callers.test.ts` | Parse source; inspect imports and call expressions; traverse AST nodes | Keep test tooling on TypeScript 6.0.3. |
| `artifacts/api-server/src/lib/sharedDiagnosticPersistence.architecture.test.ts` | Parse source; inspect function-like declarations, calls, bindings and property nodes; traverse AST | Keep test tooling on TypeScript 6.0.3. |
| `artifacts/run-calculator/scripts/check-vite-config-loading.mjs` | `preProcessFile` import discovery | Keep on TypeScript 6.0.3 until a documented stable replacement or independently validated non-compiler scanner is selected. |

This current inventory contains eleven source files importing
`@workspace/typescript-api-v6`, rather than the nine captured by the 2026-10-14 inventory.
The two additional imports are the calculator's `useLiveRun` allowed-callers test and the
API server's shared-diagnostic persistence architecture test. The focused checks cover the
retention checker, declaration-contract comparison, browser syntax validation, Vite config
loading, all six AST-based calculator tests, and the API-server architecture test.

## Official TypeScript 7 compatibility findings

The exact TypeScript 7 version assessed here is **7.0.2**, the latest stable TypeScript 7
release in Microsoft's release metadata and npm's `latest` tag as of 2026-10-15. Its package
root exports only version metadata; the parser, AST, scanner, visitor, and related
programmatic surfaces are under `typescript/unstable/*`. npm's `next` tag is
`7.1.0-dev.20261013.1`, not a stable API release. Microsoft's 7.1 iteration plan lists API
stabilization work and 2026-11-24 as the planned stable release date. Therefore no stable
TypeScript 7 programmatic API version is available yet, and the eleven current consumers
remain on the exact TypeScript 6.0.3 boundary below. The official compiler API wiki also
warns that its current examples describe TypeScript 6 and earlier and that TypeScript 7.1
will have a different API.

Microsoft describes TypeScript 7.0 as command-line compatible with TypeScript 6.0 when
TypeScript 6 uses stable type ordering and does not suppress deprecations. The repository
does not set `ignoreDeprecations`, and TypeScript 6.0.3 reports stable type ordering as the
default.

TypeScript 7 makes TypeScript 6 deprecations hard errors. The removed options and defaults
documented in the 7.0 announcement were checked against repository tsconfigs; no configured
option blocks the tested projects.

One command-line behavior needs to remain in the migration checklist: when the current
directory contains a tsconfig, TypeScript 7 does not accept source file paths unless
`--ignoreConfig` is passed. Current production scripts use `--build` or `-p`, so they do
not hit this restriction. Ad-hoc developer commands and future scripts should still be
audited.

TypeScript 7 adds native platform packages as optional dependencies. The tested
`typescript@7.0.2` package selected the Linux x64 binary successfully under the repository's
Node 24 environment. A later lockfile change must retain the required platform package in
CI and deployment installations; dependency-pruning policy must not remove all native
optional packages.

### Approved native runner matrix

The release workflows currently approve one runner architecture for the TypeScript 7
candidate:

| Platform | Architecture | Native package | Release jobs |
| --- | --- | --- | --- |
| Linux | x64 | `@typescript/typescript-linux-x64@7.0.2` | CI codegen bridge; standard release check; full release check |

The lockfile currently enumerates these 20 TypeScript 7 optional native packages, all at
`7.0.2`:

```text
@typescript/typescript-aix-ppc64
@typescript/typescript-darwin-arm64
@typescript/typescript-darwin-x64
@typescript/typescript-freebsd-arm64
@typescript/typescript-freebsd-x64
@typescript/typescript-linux-arm
@typescript/typescript-linux-arm64
@typescript/typescript-linux-loong64
@typescript/typescript-linux-mips64el
@typescript/typescript-linux-ppc64
@typescript/typescript-linux-riscv64
@typescript/typescript-linux-s390x
@typescript/typescript-linux-x64
@typescript/typescript-netbsd-arm64
@typescript/typescript-netbsd-x64
@typescript/typescript-openbsd-arm64
@typescript/typescript-openbsd-x64
@typescript/typescript-sunos-x64
@typescript/typescript-win32-arm64
@typescript/typescript-win32-x64
```

The comparison harness validates that the package records and the
`typescript@7.0.2` optional-dependency snapshot contain the same complete set. In its
disposable frozen install it then resolves the native package for the current approved
runner, verifies the native executable exists and has the candidate version, and separately
asserts `Version 6.0.3` for the authoritative compiler and `Version 7.0.2` for the candidate.
An unapproved platform/architecture fails before any TypeScript 7 build instead of allowing
the wrapper to silently fall back to an incorrect or missing binary. The retained comparison
report records the approved matrix, selected native package, native package version, binary
path, and complete lockfile package inventory under its runner evidence.

## Isolated comparison

### Method

The bullets below describe the currently retained reproduction procedure. They do not by
themselves establish that historical comparison H-72383 used the same exact inputs or
sequence; the historical run has no retained source-bundle hash or command log.

- Installed `typescript@7.0.2` under `/tmp`, outside the workspace.
- Copied tracked working files to `/tmp` without `.git`, build output, or the pnpm store.
- Linked the existing dependency installation read-only for module resolution.
- Ran TypeScript 6 from the workspace and TypeScript 7 from the temporary package.
- Cleaned and rebuilt temporary project outputs before each declaration capture.
- Did not modify `package.json`, `pnpm-lock.yaml`, tracked declarations, or the production
  compiler installation.

The retained compact record is H-72383. It identifies Linux x86-64, Node 24.20.0,
pnpm 11.5.2, 8 reported processors, an Intel Xeon Platinum 8581C host CPU, and
16,400,840 KiB reported memory. Its `capturedAt` is 2026-09-21 even though the filename
contains 2026-09-15. The report's earlier description of a 2026-09-16 run on Node 24.13.0
is **unresolved**: no retained run identifier or source bundle links those details to H-72383.
The exact artifact identity and integrity hash are recorded above.

The exact executable comparison sequence is retained in
[`reproduce-typescript-7-comparison.sh`](evidence/reproduce-typescript-7-comparison.sh).
It creates and enters a disposable repository copy, installs TypeScript 7 outside the
workspace, runs every comparison command with separate output/exit/timing files, captures
both declaration trees, writes sorted per-file SHA-256 manifests, and retains the complete
recursive diff:

```bash
bash docs/evidence/reproduce-typescript-7-comparison.sh /tmp/typescript-7-comparison-evidence
```

Each run writes a separate disposable `summary.json` alongside the comparison output. It
records the capture timestamp, Git revision and SHA-256 of the exact normalized source bundle,
both compiler versions, declaration totals, per-package changed-file counts, and the
declaration-contract status and classification totals. Before reporting success, the
reproduction verifies that the summary matches the current source bundle, captured
declaration trees, diff, and contract report, including zero unexplained semantic changes.
Only after those checks pass, it retains the compact per-file report at
[`docs/evidence/typescript-7-declaration-contracts-current.json`](evidence/typescript-7-declaration-contracts-current.json).
That report carries the same source revision and source-bundle SHA-256 as its run summary,
each changed path's classification and exact baseline/candidate hashes, approval reasons,
category totals, and a SHA-256 integrity envelope. The checker validates the envelope,
identity, and classification totals against the fresh summary before retaining the report.
Compiler build trees stay in the disposable comparison output under `/tmp`; they are not
copied into the retained report. The reproduction does not compare fresh counts with, or
overwrite, the historical 2026-09-15 JSON or its prose.

The retained-artifact consistency check compares only that historical JSON with the historical
counts documented below. It can run without repeating the compiler comparison:

```bash
bash docs/evidence/reproduce-typescript-7-comparison.sh --check-retained-summary
```

This consistency check reads declaration counts and categories only. It deliberately does
not compare elapsed times, which remain single-machine observations rather than stable
benchmark claims.

The original full 13,723-line diff is not committed because it duplicates generated
output. The retained script deterministically regenerates the evidence structure and all
declaration contents; diff headers contain temporary paths and timestamps, so the compact
record intentionally does not claim that the raw diff itself is byte-stable.

The reproduction now also runs the fail-closed declaration contract comparator. It compares
clean trees by relative path, reports `api-client-react`, `api-zod`, `db`, and other
declarations independently, and writes JSON plus Markdown review reports. Quote-delimiter
changes in string literal tokens are classified as formatting-only. Every other changed,
added, or removed declaration is semantic drift and blocks the run unless an optional
approval file pins the exact baseline and candidate SHA-256 values with a review reason.
Both declaration trees and the report directory must be outside the repository; the
comparator refuses authoritative workspace paths.

The reproduction uses the reviewed approvals in
[`typescript-7-declaration-approvals.json`](evidence/typescript-7-declaration-approvals.json).
An approval is deliberately invalidated if either compiler's complete file output changes.

For an already-captured pair of disposable trees:

```bash
pnpm --filter @workspace/scripts run check:declaration-contracts -- \
  /tmp/baseline-declarations \
  /tmp/candidate-declarations \
  /tmp/declaration-contract-report
```

An approval file has schema version 1 and an `approvals` array. Each entry contains `path`,
`baselineSha256`, `candidateSha256`, and `reason`. A hash is `null` only when that side is
absent for an approved addition or removal. Approvals are therefore invalidated by any
later output change rather than becoming a broad path allowlist.


### Semantic declaration review — historical claims unresolved

The report's historical prose says that nine changes not covered by formatting
normalization were reviewed against their source contracts:

- The generated API client aggregate changes string-literal delimiters in query and mutation
  key tuple types. The literal values and tuple structure are unchanged.
- The generated API Zod aggregate emits direct `zod.*` names where TypeScript 6 emits the
  equivalent `zod.z.*` namespace alias, and reorders members in structural object types.
- Seven database schema declarations change a quote delimiter and reorder members in
  structural Zod object types.

Those per-file descriptions, the claimed bidirectional checks, and the asserted approval
reasons are **unresolved for H-72383**. Its raw declaration-contract report and exact source
inputs are not retained. The separately retained A-63cfd run has a different source revision;
the newer C-858078 classification report has a different source revision and source bundle.
Neither can validate or replace H-72383's historical contract-owner conclusions.

### Results — H-72383

The outcomes and timing below are the values in H-72383; elapsed times are single-run
observations, not general performance claims.

| Check | TypeScript 6.0.3 | TypeScript 7.0.2 |
| --- | ---: | ---: |
| Forced shared-library project build | Pass, 11.82s | Pass, 2.97s |
| Scripts `--noEmit` | Pass, 3.31s | Pass, 0.69s |
| API server `--noEmit` | Pass, 8.97s | Pass, 1.63s |
| Run calculator `--noEmit` | Pass, 44.00s | Pass, 2.71s |
| Mockup sandbox `--noEmit` | Pass, 4.16s | Pass, 0.77s |
| AI evaluation library `--noEmit` | Pass, 0.40s | Pass, 0.10s |
| Corpus harness library `--noEmit` | Pass, 0.80s | Pass, 0.16s |
| Generated API client/Zod forced build | Pass | Pass |
| Diagnostic count in checks above | 0 | 0 |
| Declaration file count | 795 | 795 |
| Declaration files with textual differences | baseline | 217 |
| Declaration contract comparison | — | **Unresolved:** prose claims 196 formatting-only, 9 approved semantic, 0 unexplained; raw report not retained |

The declaration differences break down as:

- 2 `api-client-react` generated declarations,
- 150 `api-zod` generated declarations, and
- 65 database schema declarations.

H-72383 records 2,664 removed and 2,664 added diff lines. The prose's descriptions of
inspected database and generated API differences, and its claim that 196 formatting-only plus
9 approved semantic changes were classified, remain **unresolved** because no per-file
contract report for H-72383 is retained. The 12-file gap between those claimed 205
classifications and the artifact's 217 textual changes is not reconciled. A separate archived comparison at
`release-evidence-archive/stale-full-2026-09-14/evidence/typescript-7-comparison.json` reports
217 changed paths with an unknown runner image in A-63cfd, but it names source revision
`63cfd77eef883cba583636e6fc4c72fa37cc24a6`, not the historical JSON's
`72383c601448d234b7813451618c293ebdca7ac8`. The correction note records that only six of
the nine approval entries match both sides of A-63cfd; this partial overlap does not resolve
the missing H-72383 per-file classification report. Do not describe these counts as
non-additive or claim that all changed declarations have zero unexplained semantic drift from
the available evidence. Re-run the comparison on an identifiable approved runner and retain
its revision-bound summary and per-file classification before relying on those claims. A
production switch must continue to block any new declaration output until it is fixed or
receives the same contract-owner review.

**Historical correction status (2026-10-15):** The retained JSON named
`typescript-7-comparison-2026-09-15.json` records source revision
`72383c601448d234b7813451618c293ebdca7ac8`, 217 textually changed files, and package counts
that sum to 217. The historical prose's contract totals remain 196 formatting-only plus 9
approved semantic changes (205 total). The 12-file gap cannot be reconciled because the named
source commit and raw per-file comparison report are unavailable. The retained JSON remains
unchanged; the source-bound evidence review and integrity hash are in
[`docs/evidence/typescript-7-comparison-2026-09-15-correction.md`](evidence/typescript-7-comparison-2026-09-15-correction.md).
Do not treat the retained-summary consistency check as independent confirmation of the
historical classifications or change the contract-owner conclusion without the missing
revision-bound evidence and approval.

The advisory release lane captures one cold and one warm measurement for every TypeScript
6/7 comparison check and aggregates up to five prior successful, revision-bound CI
artifacts. The approved budgets and three reviewed measurement summaries below are
RA-RESOURCE, not H-72383 evidence. Promotion requires at least three distinct revisions.


### Resource-limit approval

On 2026-09-15, maintainers reviewed three distinct schema-v3, revision-bound measurement
sets from successful GitHub Actions resource-capture jobs. All three used the supported
Linux x64 `ubuntu24@20260907.300.1` image with 4 logical CPUs and 16 GiB of memory. The
exact reports are cryptographically referenced, and their resource summaries are retained,
in [`docs/typescript-7-resource-approval-evidence.json`](typescript-7-resource-approval-evidence.json).
The retained summaries identify source revisions `305fafc03977cb3cbe1082b6b526dfefcadbd4ac`,
`f76eb757dd18112eac8a616e66bfd08c09fd6261`, and
`7b0fe2d72de5f51d812e3e3b348bbc9b01c48831`, along with workflow run IDs and report SHA-256
values. The table and approved budgets below are from RA-RESOURCE, not from the historical
comparison H-72383.
The comparison command verifies that file's exact compact schema and SHA-256 integrity
envelope before doing any compiler work. The schema permits only provenance, runner details,
approved budgets, and cold/warm maxima; it rejects command output, source payloads, and other
artifact contents.

| Source revision | Highest cold candidate time | Highest warm candidate time | Highest elapsed ratio | Highest cold candidate RSS | Highest warm candidate RSS | Highest RSS ratio |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `305fafc03977cb3cbe1082b6b526dfefcadbd4ac` | 3,273 ms | 3,545 ms | 0.250 | 844,048 KiB | 907,260 KiB | 1.040 |
| `f76eb757dd18112eac8a616e66bfd08c09fd6261` | 3,708 ms | 3,708 ms | 0.250 | 875,712 KiB | 869,536 KiB | 1.053 |
| `7b0fe2d72de5f51d812e3e3b348bbc9b01c48831` | 2,003 ms | 2,011 ms | 0.244 | 890,492 KiB | 921,160 KiB | 1.041 |

The provisional limits are approved unchanged: 1.25 elapsed ratio, 1.25 peak-RSS ratio,
60,000 ms candidate elapsed time, and 1,048,576 KiB candidate peak RSS. The reviewed
maxima were 0.250 elapsed ratio, 1.053 peak-RSS ratio, 3,708 ms candidate elapsed time,
and 921,160 KiB candidate peak RSS. The ratio limits preserve protection against
relative regressions while the absolute limits provide fail-closed ceilings for unusually
fast baselines.

The code approval flag is now enabled. This approval does not bypass evidence checks.
Runner hardware fingerprints differed across the three ephemeral hosts, so the retained
trend correctly resets rather than combining those histories. Promotion remains ineligible
until at least three distinct compatible retained revisions are present, the current
comparison acceptance gates pass, and every retained revision is within all four approved
limits. Any retained over-limit revision keeps `resourceBudgetsMet` and `eligible` false.

## Ecosystem readiness

| Tool | Resolved version | TypeScript 7 status |
| --- | ---: | --- |
| TypeDoc | 0.28.20 | **Blocked:** peer range is TypeScript 5.0.x through 6.0.x. The current npm release has the same ceiling. |
| Orval | 8.32.0 | No TypeScript peer, but depends on TypeDoc and its plugins. Current npm 8.33.0 still depends on TypeDoc 0.28.x, so a patch upgrade does not remove the blocker. |
| TypeDoc markdown/coverage plugins | 4.13.0 / 4.0.3 | Coupled to TypeDoc 0.28.x; validate as a unit with TypeDoc. |
| Vite | 8.3.0 | No TypeScript peer constraint. Its bundle/runner/native config-loader smoke passed with the current API fallback. |
| Vitest | 5.0.0 | No TypeScript peer constraint; its declared Vite range includes Vite 8. The direct compiler-API tests passed while using TypeScript 6. |
| tsx | 4.23.13 | No TypeScript peer constraint; scripts run through tsx successfully with the TypeScript 6 API fallback. |
| Drizzle Kit / Drizzle ORM | 0.31.10 / 0.45.2 | No direct TypeScript peer constraint in the resolved metadata. TypeScript 7 emitted changed text for database declarations, so declaration review is still required. |

There is no ESLint or `@typescript-eslint` installation in this workspace.

### Code generation and documentation compatibility gate

**Audit date:** 2026-09-16
**Decision:** **Do not claim native TypeScript 7 support for TypeDoc yet.**

The latest published versions remain TypeDoc 0.28.20, `typedoc-plugin-markdown`
4.13.0, `typedoc-plugin-coverage` 4.0.3, and Orval 8.33.0. TypeDoc still declares
only TypeScript 5.x and 6.0.x peers; both plugins declare a TypeDoc 0.28.x peer,
and Orval 8.33.0 still resolves this dependency family. No published TypeDoc or
plugin release provides a TypeScript 7 peer path, so the repository does not
silence the peer warning or add an override.

The supported bridge for a future root compiler switch is explicit and local to
`@workspace/api-spec`:

- the API-spec package pins `typescript@6.0.3` as TypeDoc's peer compiler;
- TypeDoc and both plugins remain resolved through Orval's locked dependency graph;
- `pnpm --filter @workspace/api-spec run check:toolchain` loads both plugins and
  runs a disposable TypeDoc smoke with the pinned TypeScript 6 compiler;
- `pnpm install --frozen-lockfile --strict-peer-dependencies` remains the
  peer-clean installation gate.

This bridge lets a disposable root TypeScript 7 compiler run generated API
declaration checks without pretending that TypeDoc itself supports TypeScript 7.
The root `typescript` package therefore remains TypeScript 6.0.3 until TypeDoc
and its plugin family publish an explicit TypeScript 7-compatible release path.
When that happens, rerun the smoke, Orval generation, generated API checks, and
declaration contract comparison before removing the local compatibility pin.

The bridge now has a dedicated CI regression lane:

```bash
pnpm run check:typescript-7-codegen-bridge
```

The check copies the current source into a temporary checkout, installs that
checkout with both `--frozen-lockfile` and `--strict-peer-dependencies`, and
asserts TypeScript 7.0.2 for the root candidate binary separately from
TypeScript 6.0.3 for the API-spec package. It then runs the TypeDoc/plugin smoke,
the Orval freshness check, and the TypeScript 7 generated API declaration build.
All generated files and build metadata stay in the temporary checkout. The check
also compares the authoritative workspace status before and after cleanup and
fails if the lane changes it. The CI job has a hard timeout and does not alter
the authoritative TypeScript 6 compiler or promote TypeScript 7.

## Staged and reversible upgrade sequence

### Stage 0 — retain the current authority

Keep `typescript@6.0.3` and its explicit package binary authoritative. The existing
TypeScript 6 release checks remain authoritative.

### Stage 1 — add a non-gating parallel native lane

The release check now implements this stage as an advisory comparison:

1. Add TypeScript 7 under a distinct alias and invoke both compiler binaries by explicit
   package paths so pnpm binary linking cannot silently select either one.
2. Keep `typescript` resolving to 6.0.3 for all existing JavaScript API consumers and
   TypeDoc/Orval.
3. Create a disposable checkout/copy for every native emitting build. Link or install the
   frozen dependencies there, and direct every TypeScript 7 `--build --force` invocation
   at that disposable tree. Do not run native emitting builds in the authoritative
   workspace because project configs fix their own output and build-info paths.
4. Run native `--build --force` and every application and standalone-library `--noEmit`
   check after the TypeScript 6 checks.
5. Store normalized diagnostics, declaration manifests/diffs, and timing summaries from
   the disposable tree.

Every standard and full release check retains
`typescript-7-comparison.json`. Candidate diagnostic or declaration drift is reported as
`ADVISORY_DRIFT` and does not change the TypeScript 6 release decision. Containment failures
(including a changed authoritative working tree or missing evidence) still fail closed.
The alias is resolved from the frozen pnpm lockfile, and the evidence records whether the
current platform/architecture is in the supported runner list.

**Rollback:** delete the disposable tree and remove the alias and parallel command. The
lane must prove `git status --short` is unchanged before and after it, so no TypeScript 7
declarations or build metadata can survive rollback.

### Stage 2 — make native CLI results release-gating

Proceed only when:

- TypeScript 6 and 7 diagnostic sets are identical for all project builds and no-emit
  checks.
- The generated API checks pass before and after the native CLI checks.
- Declaration differences are zero, or every changed declaration category has a reviewed
  semantic-equivalence rule and an approved baseline update.
- CI proves the native binary installs on every supported runner architecture.
- Repeated measurements show the selected `--checkers`/`--builders` settings stay within
  the documented cold/warm release memory/process budgets for at least three revisions,
  and those thresholds have been explicitly approved.

**Rollback:** return the native lane to advisory status; TypeScript 6 remains authoritative.

### Stage 3 — separate or migrate programmatic consumers

Do not start until Microsoft publishes a stable TypeScript 7 API and migration guidance.
Classify each of the eleven consumers against that API. Consumers without a stable
replacement must stay in a TypeScript 6-isolated package or process.

The programmatic consumers import `@workspace/typescript-api-v6`, not `typescript`
directly. That boundary resolves the exact alias `typescript-api-v6@npm:typescript@6.0.3`
and asserts both the runtime API version and resolved package metadata. This keeps source
parsing, traversal, diagnostics, and transpilation on the repository's validated 6.0.3 API
without constraining which separately named binary supplies the TypeScript 7 CLI.

Run `pnpm run check:typescript-api-v6` to verify the JavaScript API boundary and reject new
direct `typescript` imports; the normal typecheck runs this gate. Assert the TypeScript 7
CLI's separately selected binary and version in its own migration gate; do not infer either
compiler from the other's package resolution.

The official `@typescript/typescript6` compatibility package is currently 6.0.2, while this
repository uses 6.0.3. Do not silently downgrade the API consumers. A downgrade requires
explicit compatibility evidence covering all eleven consumers and an intentional update to
the boundary's version assertion.

Remove this boundary only after Microsoft publishes a stable TypeScript 7 JavaScript API
and migration guidance, every consumer has been migrated to that API, and the retention,
browser syntax, Vite import, six AST-based calculator safeguards, and API-server architecture
guard pass against it.

### Stage 4 — switch the root compiler

Replace the root compiler only after:

- TypeDoc broadens its peer range to TypeScript 7 and Orval's resolved TypeDoc/plugin graph
  installs without overrides or ignored peer failures.
- All eleven direct consumers have stable replacements or an explicitly maintained
  TypeScript 6 isolation boundary.
- The full standard release check passes with the new lockfile.
- Clean-install, generated-file, declaration, Vite config-loader, unit-test, and editor
  smoke gates pass.

**Rollback condition:** any diagnostic drift, unexplained declaration drift, native binary
installation failure, Orval/TypeDoc peer failure, editor regression, or release-budget
regression restores the previous `package.json` and lockfile together.

## Acceptance gates for a future implementation

1. Frozen pnpm install succeeds with no new peer-resolution exceptions.
2. `tsc --version` is asserted separately for the TypeScript 6 API compiler and native
   compiler so binary selection cannot drift.
3. The complete root project-reference build passes under both compilers.
4. Scripts, API server, run calculator, mockup sandbox, AI evaluation library, and corpus
   harness no-emit checks pass under both.
5. Diagnostic files are normalized and compared by code, file, position, and message.
6. All emitted declaration paths and contents are compared from clean temporary outputs.
7. `check:api-generated`, API Zod tests, Orval generation/check mode, and generated
   declaration builds pass.
8. The retention checker, browser-spec syntax validator, Vite config loader, and five
   AST-based tests pass through the intended TypeScript 6 isolation boundary.
9. Vite build, Vitest, tsx scripts, Drizzle schema tooling, and TypeDoc/Orval smoke checks
   pass without hidden TypeScript peer overrides.
10. Representative cold and warm timings are repeated in CI with peak memory captured;
    parallel worker settings stay within release budgets.
11. The editor explicitly selects the intended language service and completes a
    diagnostics/navigation smoke test with `pnpm run check:editor-typescript`. This must pass
    before TypeScript 7 is promoted from the advisory CLI alias or selected as the editor
    language service.
12. Reverting `package.json` and `pnpm-lock.yaml` restores the prior release checks without
    generated-file cleanup.

## Evidence

Repository evidence:

- `package.json`
- `pnpm-lock.yaml`
- `tsconfig.json`
- `tsconfig.base.json`
- `scripts/package.json`
- `scripts/tsconfig.json`
- `scripts/src/check-evaluation-report-retention.mts`
- `scripts/src/compare-declaration-contracts.mts`
- `artifacts/api-server/package.json`
- `artifacts/run-calculator/package.json`
- `artifacts/run-calculator/tsconfig.json`
- `artifacts/run-calculator/scripts/check-vite-config-loading.mjs`
- `artifacts/run-calculator/e2e/validate-browser-spec-syntax.ts`
- `artifacts/run-calculator/src/e2eIsolation.test.ts`
- the six AST-based calculator tests and API-server architecture test listed in the
  direct-consumer table
- `docs/evidence/typescript-7-comparison-2026-09-15.json`
- `docs/evidence/reproduce-typescript-7-comparison.sh`

Official and package evidence:

- [Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
  — native compiler release, compatibility conditions, removed options, side-by-side
  TypeScript 6 package, API status, parallel build controls, and editor limitations.
- [TypeScript releases](https://github.com/microsoft/TypeScript/releases)
  — 7.0.2 is the latest stable TypeScript 7 release at this reassessment.
- [TypeScript 7.1 iteration plan](https://github.com/microsoft/TypeScript/issues/63703)
  — API stabilization is planned; the current scheduled stable release is 2026-11-24.
- [Using the Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)
  — official warning that the current API documentation describes TypeScript 6 and earlier
  and that TypeScript 7.1 will have a different API.
- [TypeScript 7 staging repository](https://github.com/microsoft/typescript-go)
  and [compatibility changes](https://github.com/microsoft/typescript-go/blob/main/CHANGES.md)
  — native implementation and tracked TypeScript 6/7 behavior differences.
- [`typescript@7.0.2` package metadata](https://www.npmjs.com/package/typescript/v/7.0.2)
  — `tsc` binary, native optional platform packages, and `typescript/unstable/*` exports.
- [`@typescript/typescript6` package metadata](https://www.npmjs.com/package/@typescript/typescript6)
  — compatibility compiler/API package and current 6.0.2 version.
- [`typedoc@0.28.20` package metadata](https://www.npmjs.com/package/typedoc/v/0.28.20)
  — TypeScript peer range ending at 6.0.x.
- [`orval` package metadata](https://www.npmjs.com/package/orval)
  — current TypeDoc/plugin dependency family and absence of a direct TypeScript peer.

---

# Fresh revision-bound blocker audit — run findings unresolved

**Audit date:** 2026-09-16
**Assessed revision:** `7ad2e471a5fc5a9b08348f9743244696f44b68a1`
**Authoritative compiler:** TypeScript 6.0.3
**Candidate compiler:** TypeScript 7.0.2
**Decision:** **NO-GO for replacing the root compiler.** Keep TypeScript 6.0.3 authoritative, keep TypeScript 7.0.2 in its explicit native alias, and continue the advisory lane.

**Run-evidence status:** The full comparison output and command report cited in this section
were kept only under `/tmp` and are not retained. The assessed commit is also absent from the
local Git object database. Therefore the 2026-09-16 compiler outcomes, declaration totals,
runtime details, and run-specific recommendation below are **unresolved**, despite the
original report's wording. They are not verified by H-72383, A-63cfd, R-testsha, or
C-858078; these artifacts have different source identities. The NO-GO remains the safe
decision because the missing run evidence cannot establish promotion readiness; it does not
revise any historical contract-owner conclusion.

This section supersedes older status, count, and revision statements in this document where
they conflict with the assessed revision. It is an audit and remediation plan, not approval to
change `package.json`, `pnpm-lock.yaml`, or the editor SDK.

## Decision summary

The original audit described an encouraging CLI language-checking result, but that result is
**unresolved** without its retained source-bound report and is not a promotion result:

- The safe disposable reproduction at the assessed revision completed both compiler builds,
  both no-emit matrices, generated API builds, and declaration contract comparison without
  unexplained declaration drift.
- TypeScript 6 and TypeScript 7 produced the same normalized diagnostic set in the comparison
  matrix. The full reproduction's seven no-emit projects passed under both compilers.
- The current comparison command has a harness precondition defect: its direct no-emit matrix
  does not build `lib/recipe-guide-import` before checking the run calculator, so both
  compilers report the same `TS6305` missing-output diagnostic in that one matrix entry.
  This is not evidence of a TypeScript 7 language incompatibility, but it makes the comparison
  ineligible until the harness is corrected.
- The retained declaration-count contract is inconsistent across two trusted tools. The
  comparison manifest counts 718 `.d.ts` files; the reproduction and declaration-contract
  manifest count 719 files because they also include
  `lib/corpus-harness/dist/verify-chunk-split.d.mts`. The retained 2026-09-15 summary and
  prose still describe 719 without making the extension rule explicit. This is an evidence
  blocker, not a declaration semantic regression.
- The TypeScript 6 JavaScript API boundary currently covers **nine** import sites, not the
  seven sites listed in the earlier report. Two current consumers were omitted from that
  inventory: `scripts/src/compare-declaration-contracts.mts` and
  `artifacts/run-calculator/src/e2eIsolation.test.ts`.
- TypeScript 7 still has no stable replacement for those compiler-API consumers. TypeDoc
  0.28.20's resolved peer range ends at TypeScript 6.0.x, and Orval 8.32.0 resolves TypeDoc
  and both TypeDoc plugins. These are true ecosystem/toolchain blockers.
- The editor proof is a verification prerequisite and is currently unavailable in this
  non-editor process: `pnpm run check:editor-typescript` failed because no live
  `typescript-language-server` process was present. The checked-in SDK still correctly
  selects TypeScript 6.0.3.
- The checked-in promotion checkpoint is not current evidence. It is explicitly an incomplete
  checkpoint for revision `86882b30563fe938a5f7ef256ffa4ce3ed075cf7`, while this audit assesses
  `7ad2e471`. It reports a database preflight failure and missing history, but it must not be
  read as a result for the current revision. Tasks 2260 and 2261 address separate release
  infrastructure/evidence concerns; task 2265 addresses stopped-release resume guidance.

The recommendation remains fail-closed: a clean CLI comparison does not authorize promotion
when API compatibility, TypeDoc support, editor proof, evidence binding, or release gates are
missing.

## Current comparison and evidence reconciliation

### Safe reproduction

The audit report says it ran the existing isolated reproduction with output under
`/tmp/typescript-7-audit-repro-7ad2e471`. It copied the tracked source into a disposable
checkout, installed/used the candidate outside the authoritative workspace, emitted into the
disposable tree, and checked the working-tree boundary. No candidate declaration or build
metadata was written to the repository. The comparison's current report was also generated
outside the repository at `/tmp/ts7-audit-7ad2e471.json`; its final retained-summary check
was reported to reject the stale retained count. These execution and result details are
**unresolved** because neither the output nor the comparison report was retained.

The lower-level reproduction's reported result was:

| Check | TypeScript 6.0.3 | TypeScript 7.0.2 | Audit interpretation |
| --- | --- | --- | --- |
| Root shared-library build | **Unresolved** (reported pass) | **Unresolved** (reported pass) | Source output not retained |
| Scripts, API server, run calculator, mockup, AI evaluation, corpus no-emit matrix | **Unresolved** (reported pass) | **Unresolved** (reported pass) | Source output not retained |
| Generated API client/Zod forced build | **Unresolved** (reported pass) | **Unresolved** (reported pass) | Source output not retained |
| Normalized diagnostics | **Unresolved** (reported matching) | **Unresolved** (reported matching) | Source output not retained |
| Declaration files | **Unresolved** (reported 729) | **Unresolved** (reported 729) | `.d.ts`, `.d.mts`, and `.d.cts` scope was reported, not independently verified |
| Textually changed declarations | — | **Unresolved** (reported 205) | Package counts were also reported, not retained |
| Declaration contract | — | **Unresolved** (reported pass) | 196 formatting-only, 9 exact-hash-approved semantic, 0 unexplained were reported; report not retained |

The audit says the separate `scripts/src/compare-typescript-7.mts` measurement report used a narrower
declaration manifest that filters only `.d.ts`. It therefore reports 718 on each side and
fails the run-calculator no-emit pair before the prerequisite library is built. The extra
file in the full reproduction is:

```text
lib/corpus-harness/dist/verify-chunk-split.d.mts
```

These 718/719 and prerequisite details are **unresolved** for AUD-7ad2 because the
measurement report and reproduction output are unavailable. The two tools must agree on the
extension set and project prerequisites before any report can be used as promotion evidence.
The 2026-09-15 retained JSON H-72383 identifies source revision
`72383c601448d234b7813451618c293ebdca7ac8`, not `4a42e35e`; it is historical evidence for
that recorded revision only, not a result for AUD-7ad2.

### Compiler coupling inventory

The root package and lockfile currently preserve the intended isolation:

- `typescript: ~6.0.3` is authoritative.
- `typescript-native: npm:typescript@7.0.2` is a separately named candidate.
- Authoritative scripts invoke `node_modules/typescript/bin/tsc` explicitly.
- The TypeScript 6 API package resolves `typescript-api-v6: npm:typescript@6.0.3` and
  asserts both package metadata and runtime version.
- The workspace requires Node `>=24` and pnpm `>=11`; the audit prose reports Node 24.13.0
  and pnpm 11.5.2 for AUD-7ad2. The run's actual runtime metadata is **unresolved** because
  its environment report was not retained. H-72383 instead records Node 24.20.0.
- The TypeScript 7 lockfile entry retains native optional packages for all listed platforms.
  The supported release runner contract currently admits Linux x64 only, and the assessed
  Linux x64 runner was supported.
- The repository has 45 `tsconfig*.json` files; the root reference graph builds the shared
  libraries, while application and script projects use explicit no-emit checks. Existing
  configs do not use the removed legacy settings identified in the earlier research.

The current direct TypeScript JavaScript-API consumers are:

1. `scripts/src/check-evaluation-report-retention.mts`
2. `scripts/src/compare-declaration-contracts.mts`
3. `artifacts/run-calculator/e2e/validate-browser-spec-syntax.ts`
4. `artifacts/run-calculator/scripts/check-vite-config-loading.mjs`
5. `artifacts/run-calculator/src/applyCaseUpdateChoices.web.test.ts`
6. `artifacts/run-calculator/src/blankRunValueSync.test.ts`
7. `artifacts/run-calculator/src/e2eIsolation.test.ts`
8. `artifacts/run-calculator/src/freezerDomainIsolation.test.ts`
9. `artifacts/run-calculator/src/runValueStampGuard.test.ts`

They all resolve through `@workspace/typescript-api-v6`. The boundary check passed for the
current workspace; none should be rewritten against TypeScript 7's unstable entry points as
part of this audit.

## Blocker matrix

Severity uses **P0** for a direct promotion blocker, **P1** for a required evidence or
ecosystem prerequisite, and **P2** for a release-runner issue that must be resolved before a
promotion attempt can produce trustworthy evidence but is not compiler compatibility.

| ID | Classification and exact boundary | Evidence source | Severity | Smallest proposed fix | Acceptance check | Order / dependency | Rollback |
| --- | --- | --- | --- | --- | --- | --- | --- |
| B1 | **Stable programmatic API missing.** Nine consumers need parser, AST traversal, diagnostics, preprocessing, or `transpileModule`. TypeScript 7.0's root API cannot replace the TypeScript 6 API, and its unstable entry points are not an approved migration target. | Current import inventory; `lib/typescript-api-v6`; official TypeScript 7 announcement | P0 | Keep the nine consumers behind the TypeScript 6 boundary. Reassess only after a stable TypeScript 7 API and migration guidance exist; migrate each consumer with focused tests, or isolate any remaining consumer in a process/package. | Boundary check passes; all nine consumer tests pass against the selected stable API; no direct bypasses; TypeScript 7 CLI remains independently version-asserted. | Upstream TypeScript 7 stable API; before root switch. | Restore the `@workspace/typescript-api-v6` imports and TypeScript 6 alias. |
| B2 | **TypeDoc peer incompatibility.** Resolved TypeDoc 0.28.20 declares `typescript: 5.0.x ... 6.0.x`; Orval 8.32.0 resolves TypeDoc 0.28.x plus markdown/coverage plugins. A root TypeScript 7 switch would make the documentation/code-generation graph unsupported. | `pnpm-lock.yaml`; resolved package metadata; TypeDoc npm metadata and issue 3098 | P0 | Wait for a TypeDoc/plugin release that supports TypeScript 7, or obtain an explicitly supported compatibility arrangement. Do not silence the peer warning or rely on an override. | Frozen install has no TypeDoc/TypeScript peer exception; Orval generation and TypeDoc/plugin smoke pass with TypeScript 7; generated API checks remain clean. | Upstream TypeDoc and plugin support; after B1 plan is settled. | Restore the prior package and lockfile together. |
| B3 | **Comparison harness precondition.** `compare-typescript-7.mts` checks `artifacts/run-calculator` before building its referenced `lib/recipe-guide-import`, producing matching `TS6305` diagnostics under both compilers. | Current disposable `/tmp/ts7-audit-7ad2e471.json`; `artifacts/run-calculator/tsconfig.json`; `lib/recipe-guide-import/tsconfig.json` | P1 | Make the matrix build the referenced `recipe-guide-import` project before the application no-emit check, or add the missing reference to the shared prerequisite set. Keep both compiler paths identical. | Fresh comparison has zero command failures and the same normalized diagnostics for every pair; the full reproduction and comparison command agree. | Before another promotion evidence capture; independent of B1/B2. | Revert only the harness prerequisite change; keep TypeScript 6 authoritative. |
| B4 | **Declaration evidence contract drift.** The comparison manifest counts only `.d.ts` (718); the reproduction counts `.d.ts`, `.d.mts`, and `.d.cts` (719). The retained 2026-09-15 JSON and prose are revision-bound and use the broader count. | `scripts/src/compare-typescript-7.mts`; `docs/evidence/reproduce-typescript-7-comparison.sh`; current disposable output; retained JSON | P1 | Define one shared extension policy and use it in both manifests, then regenerate the current disposable evidence and update retained evidence only through its existing evidence-review path. Do not hand-edit counts. | Current summary, Markdown, approvals, and contract report agree on source revision, extension policy, file totals, category totals, and hashes; authoritative `git status` remains unchanged. | Before B6 promotion evidence; pair with B3 so the same run is being compared. | Discard disposable output and retain the prior authoritative evidence; do not broaden approvals. |
| B5 | **Editor proof unavailable in this environment.** The editor SDK setting correctly resolves `node_modules/typescript/lib` and TypeScript 6.0.3, but the smoke failed because no live `typescript-language-server` process was present. | `.vscode/settings.json`; `scripts/src/check-editor-typescript-service.mjs`; `pnpm run check:editor-typescript` result | P1 | Run the existing smoke from an open Replit editor session. Do not point the editor at the native alias during the pilot. | Live language server child uses the exact workspace TypeScript 6 `tsserver.js`; diagnostic and definition-navigation fixture assertions pass. | Required for any promotion attempt; not required to keep the advisory CLI lane. | Keep the TypeScript 6 editor SDK and rerun later. |
| B6 | **Revision/history evidence incomplete.** The current local comparison has one current revision and no compatible prior history. Approved resource evidence has three older revisions, but the promotion validator needs current, revision-bound retained artifacts and compatible runner history. | Current comparison report: `distinctRevisionCount: 1`; `docs/typescript-7-resource-approval-evidence.json`; `fetch-typescript-7-history.sh` | P1 | Collect successful CI comparison artifacts for the exact current revision and at least the configured minimum distinct compatible revisions; reject malformed, duplicate, or incompatible runner records. | History is revision-bound, same runner class, complete for cold/warm modes, within all four budgets, and promotion reports `repeatedEvidenceMet: true` and `resourceBudgetsMet: true`. | After B3/B4; depends on CI artifact availability, not on changing compiler code. | Keep promotion ineligible and discard incomplete history. |
| B7 | **Promotion checkpoint is stale/incomplete.** Checked-in checkpoint is explicitly `INCOMPLETE CHECKPOINT`, revision `86882b3`, retained evidence not updated, and reports a database preflight failure plus blocked dependents. It is not evidence for `7ad2e47`. | `release-evidence-typescript-7-promotion/release-check-checkpoint.md`; `release-check-state.json` | P2 | Rerun or resume the release check under the current revision after release-infrastructure tasks finish. Preserve the checkpoint's fail-closed status until a fresh retained report exists. | Fresh checkpoint/report names the current exact revision, includes all reached gates, has linked evidence, and passes the evidence allowlist. | Tasks 2260, 2261, and 2265 address release preflight/retry, evidence guidance, and stopped-run resume behavior; do not duplicate them here. | Use the existing resume/regenerate command; never treat an incomplete checkpoint as a pass. |
| B8 | **Native platform installation is constrained but not currently failing.** TypeScript 7 uses native optional platform packages; the current lockfile contains them and Linux x64 is the supported runner. Other architectures are not release-approved. | `pnpm-lock.yaml`; TypeScript 7 package metadata; workflow runner contract; current runner fingerprint | P1 verification prerequisite | Keep the supported-runner allowlist explicit and prove frozen installation on every architecture the project intends to support before expanding it. | Frozen install resolves the correct native binary on every approved runner; unsupported architectures fail closed rather than silently using a different compiler. | Before broadening CI/platform support; not a reason to switch the current root package on Linux x64. | Remove the candidate lane or restore the previous lockfile if native installation is incomplete. |
| B9 | **Non-TypeScript release gates remain separate blockers.** Source-library database access, signing/evidence history, browser, and other release shards are release prerequisites, not compiler compatibility findings. | Stale checkpoint gate table; current task list and release workflow | P2 | Resolve through the existing release-hardening tasks and rerun the complete promotion command. Do not weaken or relabel those gates as TypeScript evidence. | A fresh promotion run reaches the TypeScript gate with database, signing, evidence, and dependent release gates independently green. | After the release-hardening tasks; independent of B1/B2 but required for a real promotion decision. | Keep TypeScript 6 authoritative and retain the failed/incomplete evidence. |

## Existing work mapping and bounded remediation queue

The audit does not create duplicate work:

| Existing work | Matrix coverage | Audit treatment |
| --- | --- | --- |
| Task 2260 — retry temporary database drops before blocking a release | B7/B9 | Release-runner infrastructure. It does not resolve TypeScript API or TypeDoc compatibility. |
| Task 2261 — keep release evidence tests aligned with operator guidance | B4/B6/B7 | Evidence contract and operator guidance. It does not authorize changing the compiler. |
| Task 2265 — keep restart guidance actionable when a release stops partway | B7 | Resume/checkpoint usability. It does not make stale evidence current. |

The remaining task-ready gaps are:

1. **Align the two comparison declaration manifests and build prerequisites.** Scope only
   `compare-typescript-7.mts`, the reproduction helper, and their focused tests. Acceptance is
   one disposable current-revision run with matching extension totals, no `TS6305`, and
   unchanged authoritative status. This is B3/B4, not a root compiler switch.
2. **Refresh revision-bound TypeScript 7 evidence after the comparison contract is corrected.**
   Scope only the existing evidence workflow and its retained artifact review. Acceptance is
   a complete current-revision report with the approved cold/warm history and no stale count or
   hash. This is B6, not an approval to promote.
3. **Reassess the nine API consumers after a stable TypeScript 7 API is published.** Scope the
   compatibility boundary and consumer tests; do not use unstable 7.0 entry points. Acceptance
   is a consumer-by-consumer migration or an explicitly maintained isolation boundary. This is
   B1 and is upstream-dependent.
4. **Reassess TypeDoc/Orval as one dependency family after TypeDoc support lands.** Acceptance
   requires peer-clean frozen installation, TypeDoc/plugin smoke, Orval generation, and
   generated declaration checks. This is B2 and is upstream-dependent.

## Ordered promotion path

1. Keep TypeScript 6.0.3 authoritative and keep the editor on its workspace SDK.
2. Correct B3 and B4 without changing compiler authority; rerun the disposable comparison and
   declaration contract checks.
3. Keep all nine JavaScript-API consumers on the TypeScript 6 boundary until a stable native
   API exists. Do not trade a passing CLI check for unstable API usage.
4. Wait for and validate TypeDoc/plugin support (B2), then run the full Orval/API/declaration
   checks with a frozen install.
5. Obtain live editor proof (B5), compatible revision-bound resource history (B6), and a
   fresh release checkpoint after B7/B9 are resolved by their owners.
6. Only then perform a separately approved root package/lockfile change and rerun every
   rollback-sensitive acceptance gate. Any diagnostic drift, unexplained declaration drift,
   peer failure, editor regression, native installation failure, stale evidence, or release
   gate failure returns the repository to the current TypeScript 6 state.

## External compatibility evidence and recheck boundary

- Microsoft's [TypeScript 7 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
  documents side-by-side TypeScript 6 compatibility and the transition package. The
  [official release list](https://github.com/microsoft/TypeScript/releases) still identifies
  7.0.2 as the latest stable TypeScript 7 release, while the
  [7.1 iteration plan](https://github.com/microsoft/TypeScript/issues/63703) still marks
  7.1 as beta with a planned 2026-11-10 stable release. The
  [compiler API guide](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)
  warns that its current API describes TypeScript 6 and earlier and that TypeScript 7.1
  will have a different API. No stable TypeScript 7 programmatic API is available at this
  reassessment, so the nine consumers remain on TypeScript 6.0.3.
- The resolved `typedoc@0.28.20` package metadata in `pnpm-lock.yaml` declares a peer range
  ending at `6.0.x`. TypeDoc's [TypeScript 7 support issue](https://github.com/TypeStrong/typedoc/issues/3098)
  explains that the API rewrite requires TypeDoc-specific work; the issue status must be
  rechecked before any future promotion.
- The resolved `orval@8.32.0` metadata has no direct TypeScript peer but depends on
  `typedoc`, `typedoc-plugin-coverage`, and `typedoc-plugin-markdown`. Therefore an Orval
  version bump alone is not evidence that the TypeDoc boundary is removed.
- The native candidate's package metadata and lockfile show platform-specific optional
  packages. The supported-runner allowlist and frozen-install check, not the presence of
  package names alone, are the acceptance evidence.

These external package and upstream statuses are time-sensitive. Recheck them at the start
of any implementation task; this audit records the boundary observed on 2026-09-16 and does
not promise future TypeScript, TypeDoc, Orval, editor, or runner behavior.

## Explicit non-goals

- Do not replace the root `typescript` dependency or edit the lockfile as part of this audit.
- Do not select TypeScript 7 as the editor SDK.
- Do not rewrite the nine API consumers against unstable TypeScript 7 entry points.
- Do not weaken declaration, resource, editor, release-evidence, database, signing, or
  revision-binding gates.
- Do not treat the stale incomplete checkpoint, a local comparison, or a CLI-only pass as
  production promotion approval.

## Audit verification record

The following checks were reported as run while preparing this audit:

- The isolated full reproduction was reported as successful at the assessed revision and as
  producing the declaration-contract result above. Its output remains under `/tmp` and is
  not retained; the compiler results and classification are **unresolved** as stated above.
- The comparison harness's native runner contract enumerated all 20 TypeScript 7 optional
  packages, selected `@typescript/typescript-linux-x64@7.0.2`, rejected a simulated Linux
  arm64 runner, and passed its focused contract tests.
- `bash docs/evidence/reproduce-typescript-7-comparison.sh --check-retained-summary` passed
  against the historical retained summary. This validates the historical artifact's internal
  count/prose consistency; it does not make that artifact current.
- `pnpm --filter @workspace/scripts exec tsx --test ./src/compare-typescript-7.test.mts ./src/compare-declaration-contracts.test.mts`
  passed all 18 focused comparison/contract tests.
- `pnpm run check:typescript-api-v6` passed all 12 boundary tests and reported zero direct
  import bypasses.
- `pnpm run check:editor-typescript` failed as expected in this non-editor process because no
  live language server was available. This remains B5.
- `pnpm --filter @workspace/scripts exec tsx --test ./src/release-evidence.test.mts`
  failed its operator-guidance assertion for standard verification of a full evidence
  directory. That failure is release-evidence work already covered by Task 2261 (B7/B9);
  this audit does not alter the test or guidance.

The failed checks are intentionally retained in the audit record. A future promotion report
must distinguish these unavailable or infrastructure-blocked prerequisites from compiler
diagnostics instead of collapsing them into a TypeScript compatibility result.

---

# Fresh reassessment — 2026-10-14

**Assessment date:** 2026-10-14
**Authoritative compiler:** TypeScript 6.0.3
**Installed candidate:** TypeScript 7.0.2 (`typescript-native`)
**Recommendation:** **Keep the existing advisory comparison and TypeScript 6 authority. No additional TypeScript 7 adoption step is justified yet.**

**Comparison attribution:** This is a dated research assessment, not a retained comparison
run. No 2026-10-14 compiler-comparison report is identified for its run-specific statements.
R-testsha is explicitly described below as not used or regenerated for this assessment, and
its source identity differs from C-858078. Treat any compiler-comparison outcomes attributed
to this assessment as **unresolved**. The ecosystem and repository-boundary observations are
separate from comparison-run evidence.

This section supersedes earlier statements in this document about the latest published
versions, the current comparison harness, and unresolved B3/B4 findings. It is a research
update, not an approval to change compiler, dependencies, CI, editor settings, or retained
release evidence.

## Current upstream status

The official TypeScript release list identifies **7.0.2** as the latest stable TypeScript 7
release and **6.0.3** as the current TypeScript 6 release. The 7.0.2 release is dated
2026-08-20. The npm `latest` tag is also 7.0.2. npm's `next` tag resolves to
`7.1.0-dev.20261014.1`, which is a development build, not a stable release.

TypeScript 7.0.2 still does not provide a stable JavaScript compiler API at the package
root: its root export is version metadata, while programmatic entry points are under
`typescript/unstable/*`. Microsoft's Compiler API wiki, edited 2026-08-17, still warns that
its examples describe TypeScript 6.0 and earlier and that TypeScript 7.1 has a different
API. The 7.1 iteration plan lists API stabilization work, but its current schedule places
the stable release on **2026-11-24**, after this assessment date. A development package or
planned milestone is not released stable API support. The nine existing compiler-API
consumers therefore remain behind the pinned TypeScript 6.0.3 compatibility boundary.

TypeScript 7.0.2 publishes 20 native platform packages. This repository's release contract
continues to approve Linux x64 only; the comparison checks the resolved native binary and
version and rejects unapproved runners. Package availability for other operating systems
and architectures is not CI or release evidence for those platforms.

## Published ecosystem metadata

The following is a read-only check of the current lockfile and published npm package
metadata on 2026-10-14. “Latest” means the registry's stable `latest` tag. A missing
TypeScript peer range means only that the package does not declare one; it is not an
upstream TypeScript 7 compatibility statement.

| Tool | Workspace-resolved version | Latest stable published version | Published compatibility relevant to TypeScript 7 |
| --- | ---: | ---: | --- |
| `typescript` / `typescript-native` | 6.0.3 / 7.0.2 | 7.0.2 | Root `typescript` package exports version metadata and `unstable/*` API entry points only. Keep the candidate under its explicit alias. |
| `@typescript/typescript6` | Not used; repository API boundary pins `typescript@6.0.3` | 6.0.2 | Microsoft's side-by-side compatibility package is older than the repository's exact API pin; do not silently replace or downgrade the current boundary. |
| TypeDoc | 0.28.20 | 0.28.20 | Its published TypeScript peer range ends at `6.0.x`; this remains a direct blocker to making TypeScript 7 the compiler seen by TypeDoc. |
| `typedoc-plugin-markdown` | 4.13.0 | 4.14.0 | Both declare TypeDoc `0.28.x`; the plugin release notes tie its compatibility to TypeDoc releases. Neither declares a TypeScript 7 support path. |
| `typedoc-plugin-coverage` | 4.0.3 | 4.0.3 | Declares TypeDoc `0.28.x`; it must be qualified alongside TypeDoc, not treated as independently supporting TypeScript 7. |
| Orval | 8.40.0 | 8.43.0 | Latest published metadata declares TypeDoc `^0.28.19` and markdown plugin peers, but no direct TypeScript peer. Updating Orval alone does not remove TypeDoc's TypeScript 6 ceiling. |
| Vite | 8.3.2 | 8.3.4 | No TypeScript peer declaration. Existing config-loader/build smokes remain the meaningful repository evidence. |
| Vitest | 5.0.3 | 5.0.4 | No TypeScript peer declaration; its Vite peer range includes Vite 8. This does not qualify compiler-API consumers. |
| `tsx` | 4.23.13 / 4.23.15 | 4.23.15 | No TypeScript peer declaration; it depends on esbuild. Existing script execution does not establish a TypeScript 7 API contract. |
| Drizzle Kit / Drizzle ORM | 0.31.11 / 0.45.3 | 0.31.11 / 0.45.4 | Neither declares a direct TypeScript compiler peer. Prior declaration output differences remain relevant and still need exact comparison; absence of a peer is not declaration-equivalence evidence. |

The TypeDoc compatibility check remains intentionally strict: `@workspace/api-spec` pins
TypeScript 6.0.3 for TypeDoc, checks the resolved TypeDoc/plugin versions and peer metadata,
and runs a disposable documentation smoke. The separate TypeScript 7 codegen bridge keeps
that toolchain isolated while checking candidate-generated API declarations. The newer
Orval and markdown-plugin stable releases do not change this boundary.

### Independent verification on 2026-10-14

- `pnpm run check:typescript-api-v6` passed all 12 boundary tests and reported TypeScript
  API version 6.0.3 with zero direct-import bypasses.
- `pnpm run check:typescript-7-codegen-bridge` passed. Its disposable frozen install used
  `--strict-peer-dependencies` without overrides or suppressed peer warnings, resolved
  TypeScript 6.0.3 for the API-spec package and TypeScript 7.0.2 for the candidate CLI,
  smoke-tested the locked TypeDoc 0.28.20 / markdown plugin 4.13.0 / coverage plugin 4.0.3
  combination, ran Orval 8.40.0 generation freshness checks, and built generated API
  declarations with the TypeScript 7 CLI.
- A separate disposable strict-peer install of TypeScript 7.0.2 with the current registry
  latest TypeDoc 0.28.20, markdown plugin 4.14.0, coverage plugin 4.0.3, and Orval 8.43.0
  failed with `ERR_PNPM_PEER_DEP_ISSUES` for TypeDoc's unmet TypeScript peer. No peer
  override or warning suppression was used. This is direct evidence that the latest
  published documentation/codegen graph still cannot install with TypeScript 7 as its
  compiler peer.
- No TypeScript 7 promotion command was run, and the repository package manifests and
  lockfile were not changed.

## Repository state and existing coverage

The active pins remain `typescript: ~6.0.3` and `typescript-native: npm:typescript@7.0.2`.
The root typecheck and JavaScript API consumers continue to use the explicit TypeScript 6
binary/package. The editor SDK remains `node_modules/typescript/lib`; its smoke checks the
live language-server child, an expected diagnostic, and cross-file definition navigation.
The smoke is invoked by the separate promotion attempt, not by the advisory comparison.

The existing advisory comparison already covers:

- A frozen disposable install and explicit version checks for both compiler binaries.
- A forced root project-reference build under TypeScript 6 and TypeScript 7, with declarations
  captured from clean disposable outputs.
- Cold and warm comparison for the root build and six `--noEmit` projects: scripts, API
  server, run calculator, mockup sandbox, AI evaluation, and corpus harness.
- The `recipe-guide-import` prerequisite build under each compiler before the application
  no-emit checks.
- Normalized diagnostic comparison, declaration file/path/hash manifests, timing and peak
  RSS measurements, runner/native package identity, and bounded historical trend checks.
- A candidate declaration build for the generated API client and Zod packages. The separate
  CI codegen bridge also performs a strict frozen install, TypeDoc/plugin smoke, generated
  API freshness check, and TypeScript 7 declaration build in a disposable checkout.

The comparison's fixed resource contract requires cold and warm measurements, at least
three distinct compatible revisions for promotion, and approved limits of 1.25 for elapsed
time and peak-RSS ratios, 60,000 ms candidate elapsed time, and 1,048,576 KiB candidate
peak RSS. These approved thresholds are retained in RA-RESOURCE. Approval of these thresholds is not proof that current revision-bound history
meets them. Standard and full release modes run the comparison as advisory; a separate
promotion mode adds the live TypeScript 6 editor proof and requires the comparison's
diagnostic, declaration, resource, and evidence gates.

Two previously recorded harness defects are resolved in the current source:

- The measurement command now builds `lib/recipe-guide-import` for each compiler before
  checking the run calculator; the reproduction and focused test assert the prerequisite
  ordering.
- Both comparison and reproduction include `.d.ts`, `.d.mts`, and `.d.cts` declarations;
  the focused test asserts the same extension set.

The focused current harness test passed on 2026-10-14:

```text
pnpm --filter @workspace/scripts exec tsx --test ./src/compare-typescript-7.test.mts
23 tests passed
```

This tests the comparison contracts; it does not run a new compiler comparison or produce
release evidence. At task start, the worktree already contained edits to
`release-evidence/typescript-7-comparison.json` and `scripts/src/release-check.mts` as well
as unrelated application/test edits. The retained comparison artifact R-testsha identifies
its source with a `test-sha256:` value rather than a commit revision and has no capture
timestamp. It is not fresh, independently revision-bound promotion evidence, and it was not
used or regenerated for this assessment. Its identity must not be joined to C-858078's
declaration classifications.
The checked-in promotion checkpoint remains an incomplete checkpoint for an older revision;
it is not a current promotion result. The historical 2026-09-16 clean reproduction remains
**unresolved** as comparison evidence because its detailed output is not retained; it cannot
be used to support results for that assessed tree or today's worktree.

The prior B3/B4 implementation gaps are therefore marked **resolved in source and focused
tests**. C-858078 provides revision-bound per-file classifications for its recorded source
identity, but its identity does not match R-testsha. A complete current comparison tying
compiler command results and classifications to one source identity is **not established**.
The stable TypeScript 7 API and TypeDoc peer blockers remain. The editor proof, compatible
revision history, and full promotion decision also remain separate gates; none is inferred
from an unrelated comparison artifact.

## Incremental options considered

| Option | Additional coverage beyond the current lane | Compatibility and trust boundary | CI, editor, declarations, platform, evidence, and rollback |
| --- | --- | --- | --- |
| Keep the existing advisory matrix and TypeDoc bridge (**recommended**) | None added; it already compares the root build and six project checks, generated declarations, and toolchain bridge. | Preserves TypeScript 6 as authority and keeps all nine compiler-API consumers on its explicit boundary. TypeDoc continues to use its declared supported compiler. | Retains existing cold/warm, declaration, native-runner, and evidence checks. Editor remains TypeScript 6. Roll back only by removing the isolated candidate lane and alias; production build and editor remain unchanged. |
| Add another TypeScript 7 CI lane for the same six projects or generated API declarations | No meaningful new checks; it duplicates the current comparison or codegen bridge. | Risks giving a duplicate check a different status or trusting a narrower pass without the TypeScript 6 pair. | Adds CI time and maintenance without reducing declaration/API risk. It creates another result to bind to source revisions and runner identity. Rollback means removing the duplicate job. |
| Expand the comparison to every standalone package or add another native-only spot check | Some package-specific granularity, but the existing project-reference build already covers the 35-library graph and the no-emit matrix covers the major apps/scripts. No uncovered failure mode was identified in this research. | Could expose package-specific effects, but would not resolve unstable API consumers or TypeDoc's unsupported peer range. | Adds substantial repeated work and new timing/RSS history requirements; expands the native-package runner evidence surface. Any future expansion should name a demonstrated gap first and retain the same containment and report checks. |
| Use TypeScript 7.1 development builds for compiler APIs or the editor | Potential early feedback only; the current CLI lane does not validate TypeScript 7.1's changed API or language service. | Development-build API stability and downstream support are unproven. Moving compiler-API users or editor SDK would create a separate trust boundary, not an incremental production improvement. | Requires new API consumer tests, editor diagnostics/navigation proof, toolchain compatibility, and candidate output review. Revert the experimental package/SDK together; do not mix it into normal builds. |
| Promote the TypeScript 7 CLI or editor now | No meaningful coverage beyond the existing matrix. | Unacceptable: stable API guidance and TypeDoc peer support are missing, and current evidence is not a clean current-revision promotion result. | Would cross package, generated declaration, native platform, editor, and release-evidence gates. Not authorized by a successful CLI comparison; rollback would require restoring package and lockfile together and returning the editor to TypeScript 6. |

## Recommendation and next decision point

**Do not add another TypeScript 7 check or change compiler authority now.** The current
advisory lane already gives the useful incremental CLI coverage, and the CI bridge protects
the one TypeScript 6-only code-generation toolchain. A second partial check would duplicate
that coverage without resolving the actual blockers.

Reassess the next adoption step only after both upstream conditions are published:

1. Microsoft releases TypeScript 7.1 stable with stable API documentation and package exports
   for the operations required by the nine current consumers; and
2. TypeDoc publishes a TypeScript 7 peer range, with compatible plugin and Orval metadata
   that permits a frozen strict-peer install without overrides or silenced warnings.

At that point, the bounded next step is a new disposable comparison against the exact stable
TypeScript 7.1 version. Before any promotion proposal, require: the full existing project and
generated-code matrices; consumer-by-consumer API tests or explicit TypeScript 6 isolation;
clean TypeDoc/plugin/Orval installation and smokes; exact declaration manifests and reviewed
semantic differences; supported-runner native installation; current compatible cold/warm
history; and the live editor SDK proof. Keep all normal builds and editor settings on
TypeScript 6 until a separate promotion decision passes the complete repository gates.

If any new candidate diagnostics, unexplained declaration differences, peer/install errors,
unsupported runner, resource regression, editor failure, stale evidence, or unrelated release
gate failure appears, keep or restore the isolated advisory state. Do not use this research
or a single successful CLI run as promotion approval.

## Sources and method

Official TypeScript status:

- [TypeScript releases](https://github.com/microsoft/TypeScript/releases) — stable release
  list and the 2026-08-20 TypeScript 7.0.2 release.
- [Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
  — native compiler, package/API arrangement, and side-by-side TypeScript 6 guidance.
- [Using the Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)
  — current API-version warning, edited 2026-08-17.
- [TypeScript 7.1 iteration plan](https://github.com/microsoft/TypeScript/issues/63703)
  — API stabilization work and scheduled 2026-11-24 stable release; a plan is not a release.
- [TypeScript npm metadata](https://www.npmjs.com/package/typescript) — `latest` 7.0.2 and
  `next` development version at the time of the registry check.

Published package metadata:

- [`typedoc@0.28.20`](https://www.npmjs.com/package/typedoc/v/0.28.20) and
  [`typedoc-plugin-markdown@4.14.0`](https://www.npmjs.com/package/typedoc-plugin-markdown/v/4.14.0)
  — TypeScript and TypeDoc peer metadata.
- [`typedoc-plugin-coverage@4.0.3`](https://www.npmjs.com/package/typedoc-plugin-coverage/v/4.0.3)
  and [`orval@8.43.0`](https://www.npmjs.com/package/orval/v/8.43.0) — coupled plugin and
  generator peer metadata.
- [`@typescript/typescript6`](https://www.npmjs.com/package/@typescript/typescript6) —
  current compatibility package version.
- [`vite@8.3.4`](https://www.npmjs.com/package/vite/v/8.3.4),
  [`vitest@5.0.4`](https://www.npmjs.com/package/vitest/v/5.0.4),
  [`tsx@4.23.15`](https://www.npmjs.com/package/tsx/v/4.23.15),
  [`drizzle-kit@0.31.11`](https://www.npmjs.com/package/drizzle-kit/v/0.31.11), and
  [`drizzle-orm@0.45.4`](https://www.npmjs.com/package/drizzle-orm/v/0.45.4) — published peer
  and dependency metadata for the materially relevant surrounding toolchain.

Repository evidence reviewed read-only:

- Root compiler pins, lockfile, TypeScript API boundary, TypeDoc toolchain check, and editor
  SDK setting.
- `scripts/src/compare-typescript-7.mts`, its resource/native contracts, focused tests,
  release-check wiring, and CI workflows.
- `lib/api-spec/check-typescript-7-bridge.sh` and the historical migration report/checkpoint.

No compiler comparison, retained evidence refresh, dependency or lockfile change, CI change,
editor change, or promotion attempt was made for this reassessment. The only task change is
this dated report section.

## Fresh reassessment on 2026-10-15

**Assessed base revision:** `5ae27910553ff568f77d0d71c50fc89ac102ccf8`

**Decision:** **Keep TypeScript 6.0.3 authoritative.** Neither upstream blocker is cleared.
No adoption plan or promotion attempt is authorized by this reassessment.

### Official API and registry status

- Microsoft's [TypeScript releases](https://github.com/microsoft/TypeScript/releases)
  identifies **7.0.2** as the latest stable TypeScript 7 release. The npm `latest` tag
  and `typescript@7.0.2` package metadata also report 7.0.2.
- Microsoft's [TypeScript 7.0 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
  states that 7.0 does not ship a programmatic API. Its
  [Compiler API guide](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API),
  last edited 2026-08-17, warns that the guide describes TypeScript 6.0 and earlier and
  that TypeScript 7.1 will have a different API.
- The npm registry's [`typescript` dist-tags](https://registry.npmjs.org/-/package/typescript/dist-tags)
  list `latest` as 7.0.2 and `next` as `7.1.0-dev.20261013.1`; the latter is a development
  build, not a stable release. Microsoft's
  [7.1 iteration plan](https://github.com/microsoft/TypeScript/issues/63703) lists API
  stabilization as planned work and 2026-11-24 as the scheduled stable release date.
- The published `typescript@7.0.2` export map exposes its root version metadata and API
  subpaths under `typescript/unstable/*`; it does not publish stable replacements for the
  parser, AST, scanner, traversal, diagnostics, preprocessing, and transpilation operations
  required by the eleven inventoried consumers. The API blocker remains. No migration was
  attempted in a disposable tree because there is no stable API candidate; development and
  `unstable/*` entry points are outside this task's allowed scope.
- Registry metadata for the current latest toolchain is:

  | Package | Published version | Relevant peer metadata |
  | --- | --- | --- |
  | `typedoc` | 0.28.20 | `typescript` peer range ends at `6.0.x` |
  | `typedoc-plugin-markdown` | 4.14.0 | `typedoc: 0.28.x` |
  | `typedoc-plugin-coverage` | 4.0.3 | `typedoc: 0.28.x` |
  | `orval` | 8.43.0 | `typedoc: ^0.28.19`, `typedoc-plugin-markdown: ^4.10.0`; no direct TypeScript peer |

  Sources: [TypeDoc registry metadata](https://registry.npmjs.org/typedoc),
  [Markdown plugin metadata](https://registry.npmjs.org/typedoc-plugin-markdown),
  [coverage plugin metadata](https://registry.npmjs.org/typedoc-plugin-coverage), and
  [Orval metadata](https://registry.npmjs.org/orval), checked 2026-10-15. The TypeDoc
  [TypeScript 7 tracking issue](https://github.com/TypeStrong/typedoc/issues/3098) remains
  relevant; package metadata and runtime checks, rather than issue discussion alone, decide
  compatibility.

### Disposable install and smoke results

All candidate dependency installation, generated files, and smoke output were confined to
temporary directories outside the workspace. No peer override or ignored-warning setting was
used. The sandbox allowed only the required `esbuild` build script so pnpm could install the
packages; that allowance was not added to the repository.

- A fresh lockfile resolution with the latest TypeScript 7 / TypeDoc / plugin / Orval graph
  and `--strict-peer-dependencies` failed with `ERR_PNPM_PEER_DEP_ISSUES`: TypeDoc 0.28.20
  requires a TypeScript peer from 5.0.x through 6.0.x, but the selected TypeScript is 7.0.2.
- For clarity, a frozen install against a lockfile previously generated without strict peer
  resolution did exit successfully. It is **not** peer-clean evidence: `pnpm peers check`
  on that installed graph failed with the same unmet TypeDoc peer. Do not treat the frozen
  install's exit status alone as satisfying the strict-peer gate.
- Running TypeDoc 0.28.20 and both plugins against TypeScript 7.0.2 failed before document
  generation with `TypeError: Cannot read properties of undefined (reading
  'PropertyDeclaration')`. This is a direct runtime incompatibility, not merely a peer-range
  warning. The same TypeDoc/plugin smoke under the retained TypeScript 6.0.3 toolchain passed
  in the existing bridge check.
- Orval 8.43.0's CLI runtime smoke passed, and it generated 797 TypeScript files from the
  project OpenAPI configuration into a disposable output directory. The initial isolated
  generation attempt lacked the config's `custom-fetch.ts` fixture; copying that input into
  the disposable output and following `check-generated.sh`'s setup made the smoke pass.
- `pnpm run check:typescript-7-codegen-bridge` passed in its disposable repository copy:
  the frozen strict-peer install kept TypeScript 6.0.3 with TypeDoc/plugins and TypeScript
  7.0.2 as the separate candidate CLI; the TypeDoc/plugin smoke, Orval 8.42.0 generation
  freshness check, API Zod test, and TypeScript 7 generated declaration builds passed.
  This validates the current isolated arrangement; it does not show TypeDoc compatibility
  with TypeScript 7.

### Repository boundary checks and decision

- `pnpm run check:typescript-api-v6` passed all 12 tests and reported API version 6.0.3
  with zero direct-import bypasses. The source inventory now has eleven importers; the
  two missing from the 2026-10-14 table are the calculator's
  `useLiveRun-allowed-callers.test.ts` and the API server's
  `sharedDiagnosticPersistence.architecture.test.ts`.
- Consumer-specific verification passed on the unchanged code:
  - `pnpm --filter @workspace/scripts run test:evaluation-report-retention`: 12 focused
    tests passed, the retention check passed, and the benchmark-report privacy test suite
    passed.
  - `pnpm --filter @workspace/scripts run test:declaration-contracts` passed.
  - The API server's `sharedDiagnosticPersistence.architecture.test.ts` passed all 12 tests.
  - The six calculator AST tests passed: 6 files and 56 tests total.
  - Vite config import tests passed all 3 tests; the config smoke checked 3 config files
    and loaded both Vite configs with the bundle, runner, and native loaders.
  - `pnpm --filter @workspace/run-calculator run check:e2e:syntax` passed for 39 browser
    spec files.
- All consumers remain behind the TypeScript 6.0.3 boundary. These checks establish that
  the existing isolation still works; they do not establish compatibility with a future
  TypeScript 7 API.
- The disposable TypeScript 7 generated API declaration builds also passed through the
  existing bridge.
- **Not reached:** live editor diagnostics/navigation and approved-runner promotion evidence.
  Those are later adoption gates; the API and TypeDoc blockers already prevent an adoption
  recommendation, and no promotion command was run.
- Root compiler authority, editor SDK, package manifests, lockfile, and release gates were
  not changed. TypeScript 6.0.3 remains authoritative; TypeScript 7.0.2 remains only the
  separately named advisory candidate.

Reassess only after Microsoft publishes a stable TypeScript 7 API for all eleven consumer
operations and TypeDoc, its plugins, and Orval publish a compatible graph. At that point,
open a separate bounded adoption task covering API-consumer migration/isolation, strict
frozen install, TypeDoc/plugin and Orval generation/runtime smokes, declaration comparison,
editor proof, and approved-runner evidence. This reassessment does not authorize that work.

### Independent qualification rerun — 2026-10-15

This qualification subsection records reported disposable-install and tool-smoke results,
not a TypeScript comparison run. The transcript/logs for the individual install and runtime
outcomes are not retained here; the assertions below remain reported findings rather than
independently verified run evidence. Do not use them to fill missing compiler-comparison
metadata for H-72383, AUD-7ad2, R-testsha, or C-858078.

At 2026-10-15 09:50 UTC, npm `latest` metadata still resolved to TypeDoc 0.28.20,
`typedoc-plugin-markdown` 4.14.0, `typedoc-plugin-coverage` 4.0.3, and Orval 8.43.0.
TypeDoc's peer range still ends at TypeScript 6.0.x. The TypeDoc 0.28.20 release notes
describe API and rendering additions/fixes but no TypeScript 7 support. Markdown 4.14.0
release notes describe rendering fixes and explicitly report no public option or type
changes. Coverage 4.0.3's changelog covers the TypeDoc 0.28 update and coverage-output
fixes, not TypeScript 7 support. Orval 8.43.0 release notes list generator fixes/features
but do not change the TypeDoc peer boundary.

The latest overall Orval release, 8.43.0, was published at 2026-10-14 17:57 UTC, less
than the workspace's 24-hour minimum release age at the time of this rerun. It was not
installed or tested again; the safety hold was not bypassed. Orval 8.42.0 was the newest
release older than the 24-hour hold and was used for the fresh smoke.

Fresh disposable qualification results:

- A fresh `pnpm install --lockfile-only --strict-peer-dependencies` with TypeScript 7.0.2
  and the latest TypeDoc/plugin graph failed because TypeDoc 0.28.20 rejects TypeScript 7.
- On the same graph, a lockfile first created without strict resolution was accepted by
  `pnpm install --frozen-lockfile --strict-peer-dependencies`, but the independent
  `pnpm peers` audit failed on TypeDoc's TypeScript peer. A frozen install's exit status
  alone therefore does not prove its package graph is peer-clean. The TypeScript 7 codegen
  bridge now runs `pnpm peers` immediately after frozen installation to enforce that
  independent check.
- A peer-clean disposable install of TypeDoc 0.28.20, Markdown plugin 4.14.0, coverage
  plugin 4.0.3, TypeScript 6.0.3, and Orval 8.42.0 passed `pnpm peers`. TypeDoc and both
  plugins generated Markdown and a coverage SVG under TypeScript 6.0.3.
- In that disposable install only, redirecting TypeDoc's peer link to the separately
  installed TypeScript 7.0.2 candidate reproduced a runtime failure before documentation
  generation: `TypeError: Cannot read properties of undefined (reading
  'PropertyDeclaration')`. No workspace package link, manifest, lockfile, or compiler
  authority was changed.
- Orval 8.42.0 ran against the project's OpenAPI config and generated 797 TypeScript files;
  its generated client and Zod directories matched the checked-in API declarations. Orval
  8.43.0 remains untested in this rerun because of the 24-hour release-age restriction.
- The checked-in `check:api-generated` gate passed, as did the disposable TypeScript 7
  codegen bridge (including generated API declaration builds), declaration-contract tests,
  and the TypeScript 6 API-boundary check. These passes validate the current isolated
  arrangement, not TypeDoc compatibility with TypeScript 7.


### Current declaration comparison

The report describes a disposable comparison that ran both full shared-library builds, all
six no-emit project checks, and generated API declaration builds under TypeScript 6.0.3 and
TypeScript 7.0.2. The matching retained compiler-results artifact R-testsha records command
successes, 983 declaration files per compiler, and 282 changed paths. It does not record a
capture timestamp or Git revision, and the report says it was not used or regenerated for
the 2026-10-14 assessment. Do not attribute it to that date.

Three existing exact-hash approvals no longer matched the current generated output. After
reviewing the changed TypeScript representations and confirming bidirectional compatibility
under both compilers, the approval file was updated for those same three paths; no new
approval paths were added. The retained per-file report C-858078 records 273
formatting-only files, 9 approved semantic files, and 0 unexplained semantic changes for
source revision `858078ed44c8838cedfa80b40c4950ac42b668e2` and source-bundle SHA-256
`3468d08570540775d10b5df16eb43ea0318545ded502e1ebfac822f47fb722a7`. However, C-858078's
source identity differs from R-testsha's `test-sha256:` identity. Therefore, the claim that
the 983/282 compiler run and the 273/9/0 classification are one comparison is **unresolved**;
the retained artifacts support each result only under its own recorded identity.

The report says the full reproduction's final retained-summary check rejected its current
totals against H-72383 (795 files and 217 changed files). This check's outcome for the
unretained reproduction is **unresolved**; running the retained-summary check now can only
verify H-72383's internal count agreement and cannot prove the reported rejection or the
classification. H-72383 remains historical and was not overwritten. The full comparison
output, summary, and compiler build trees for the reported run were disposable under `/tmp`.
The compact
per-file declaration-contract report for the latest successful fresh comparison is retained
separately at
[`docs/evidence/typescript-7-declaration-contracts-current.json`](evidence/typescript-7-declaration-contracts-current.json);
its revision and source-bundle hash identify C-858078's exact classification inputs. Its
source identity does not match R-testsha; therefore it cannot establish the compiler
commands or aggregate comparison results attributed to R-testsha. Retaining this report
does not refresh or replace the historical summary and does not change the TypeScript 6
authority or the TypeScript 7 adoption decision.

**Decision remains NO-GO for TypeScript 7 adoption.** This is a conservative decision based
on the separately dated stable-API and TypeDoc compatibility assessments, the TypeScript 6
boundary checks reported below, and the unresolved comparison-run linkage above—not a
conclusion that C-858078 proves R-testsha's compiler results. TypeScript 6.0.3 remains
authoritative; do not change dependency versions or bypass the release-age policy as part of
this task.

### Stable compiler API reassessment — 2026-10-15

This is an upstream/API assessment, not a compiler-comparison run. Its no-adoption
recommendation is based on the published TypeScript release/export metadata linked below
and the current repository consumer inventory; it does not infer API compatibility from
H-72383, A-63cfd, R-testsha, or C-858078.

**Decision:** No stable TypeScript 7 programmatic API is published for the operations used
by this repository's eleven consumers. Keep every consumer behind the TypeScript 6.0.3
boundary. No migration was attempted because there is no stable candidate; no development
build or `typescript/unstable/*` entry point was used.

The current Microsoft [release list](https://github.com/microsoft/TypeScript/releases)
still identifies TypeScript 7.0.2 as the latest stable 7.x release. The npm
[dist-tags](https://registry.npmjs.org/-/package/typescript/dist-tags) report `latest` as
7.0.2 and `next` as `7.1.0-dev.20261013.1`. Microsoft's
[7.0 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
explicitly says 7.0 does not ship with an API. The official
[Compiler API guide](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)
still warns that it describes TypeScript 6.0 and earlier and that 7.1 will have a different
API.

The published [`typescript@7.0.2` export map](https://registry.npmjs.org/typescript/7.0.2)
exports the package root as `./lib/version.cjs`; programmatic subpaths are explicitly named
`typescript/unstable/*` (including sync, async, AST, scanner, visitor, and filesystem
surfaces). These exports do not meet the task's stable-API requirement for parsing, AST
inspection/traversal, diagnostics, preprocessing, module resolution, or `transpileModule`.
The existing eleven-consumer inventory above therefore remains unchanged: no consumer has
a supported stable replacement, including the `preProcessFile` use in Vite config import
discovery.

Verification on the unchanged boundary:

- `pnpm run check:typescript-api-v6` passed all 12 boundary tests and reported API version
  6.0.3 with zero direct-import bypasses.
- The evaluation-report retention tests/check and benchmark-report privacy tests passed;
  the declaration-contract comparison tests passed.
- All six calculator AST test files passed (56 tests total); the Vite config import tests
  passed (3 tests), the config-loading check passed, and browser-spec syntax validation
  passed for 39 files.
- The API-server shared-diagnostic persistence architecture test passed (12 tests).

The package boundary, consumers, root compiler, lockfile, editor SDK, and release gates were
not changed. These checks confirm the existing TypeScript 6 isolation; they do not prove
compatibility with a future TypeScript 7 API. Reassess only after Microsoft publishes stable
API documentation and package exports for the operations above.
