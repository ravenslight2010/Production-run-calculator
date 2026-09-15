# TypeScript 7 Migration Research

**Assessment date:** 2026-09-15  
**Current compiler:** TypeScript 6.0.3  
**Compared compiler:** TypeScript 7.0.2  
**Recommendation:** **Pilot TypeScript 7 in parallel; do not replace TypeScript 6 yet.**

## Executive summary

The native TypeScript 7 command-line compiler is compatible with the repository's current
TypeScript projects and is substantially faster in this isolated comparison:

- The 35-project shared-library build completed without diagnostics under both compilers.
- The API server, web client, mockup sandbox, and scripts typechecked without diagnostics
  under both compilers.
- TypeScript 7 accepted the repository's project-reference, declaration-only, bundler
  resolution, and `allowImportingTsExtensions` configurations.
- Representative elapsed times improved from 11.82s to 2.97s for a forced shared-library
  build and from 50.76s to 3.73s for the web-client typecheck. These are single local runs,
  not a benchmark suitable for capacity planning.

The production toolchain should not switch yet for three reasons:

1. TypeScript 7.0 deliberately has no stable programmatic API. Its root `typescript` export
   exposes version information, not the TypeScript 6 parser/traversal/transpile API used by
   seven repository files.
2. The current TypeDoc 0.28.20 peer range ends at TypeScript 6.0.x. TypeDoc is pulled in by
   Orval, so replacing the root compiler would make the resolved code-generation toolchain
   unsupported even though Orval itself does not declare a TypeScript peer.
3. TypeScript 7 produces textual declaration differences concentrated in generated API/Zod
   declarations and database declarations. The fail-closed contract comparison now
   classifies equivalent formatting changes and pins every reviewed non-formatting change
   to the exact TypeScript 6 and TypeScript 7 output hashes. Any new or changed semantic
   output still blocks promotion.

Microsoft explicitly recommends running TypeScript 7 side-by-side with the
`@typescript/typescript6` compatibility package for tools that still need the old API.
This repository should first add a non-gating TypeScript 7 lane while retaining 6.0.3 as
the authoritative compiler and API package.

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

The root `tsconfig.json` references 35 shared libraries. The comparison build reported 36
projects in scope and 35 built projects after transitive references were included.

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

TypeScript 7.0's root module cannot replace any consumer that currently calls the
TypeScript 6 compiler API. The TypeScript 7 package does expose `typescript/unstable/*`
entry points, but Microsoft labels the API unstable and says a stable, different API is
planned for TypeScript 7.1 or later. Rewriting against unstable entry points is not an
acceptable production migration path.

| Consumer | TypeScript 6 API use | TypeScript 7 disposition |
| --- | --- | --- |
| `scripts/src/check-evaluation-report-retention.mts` | Parse source, AST node types and guards, traversal | Keep on TypeScript 6 compatibility API. Later evaluate a stable TypeScript 7 AST/parser API. |
| `artifacts/run-calculator/e2e/validate-browser-spec-syntax.ts` | Parse diagnostics, diagnostic flattening, filesystem read | Keep on TypeScript 6. A CLI/subprocess syntax check is a possible later isolation strategy. |
| `artifacts/run-calculator/src/freezerDomainIsolation.test.ts` | TSX parse and AST traversal | Keep test tooling on TypeScript 6 until a stable native AST API exists. |
| `artifacts/run-calculator/src/blankRunValueSync.test.ts` | Parse and evaluate AST literals | Keep test tooling on TypeScript 6 until a stable native AST API exists. |
| `artifacts/run-calculator/src/runValueStampGuard.test.ts` | TSX parse and AST traversal | Keep test tooling on TypeScript 6 until a stable native AST API exists. |
| `artifacts/run-calculator/src/applyCaseUpdateChoices.web.test.ts` | TSX parse/traversal and `transpileModule` | Keep on TypeScript 6. `transpileModule` has no stable TypeScript 7.0 root equivalent. |
| `artifacts/run-calculator/scripts/check-vite-config-loading.mjs` | `preProcessFile` for import discovery | Keep on TypeScript 6 for the pilot. The import scanner can later be replaced or isolated; it is not safe to assume the native unstable AST is compatible. |

The current direct-consumer smoke covered the retention checker, Vite config loading, and
all four AST-based client test files: 29 tests passed.

## Official TypeScript 7 compatibility findings

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

## Isolated comparison

### Method

- Installed `typescript@7.0.2` under `/tmp`, outside the workspace.
- Copied tracked working files to `/tmp` without `.git`, build output, or the pnpm store.
- Linked the existing dependency installation read-only for module resolution.
- Ran TypeScript 6 from the workspace and TypeScript 7 from the temporary package.
- Cleaned and rebuilt temporary project outputs before each declaration capture.
- Did not modify `package.json`, `pnpm-lock.yaml`, tracked declarations, or the production
  compiler installation.

The comparison ran on Linux x86-64 with Node 24.13.0, pnpm 11.5.2, 8 reported processors,
an Intel Xeon Platinum 8581C host CPU, and 16,400,840 KiB reported memory. The compact
machine-readable record is
[`docs/evidence/typescript-7-comparison-2026-09-15.json`](evidence/typescript-7-comparison-2026-09-15.json).

The exact executable comparison sequence is retained in
[`reproduce-typescript-7-comparison.sh`](evidence/reproduce-typescript-7-comparison.sh).
It creates and enters a disposable repository copy, installs TypeScript 7 outside the
workspace, runs every comparison command with separate output/exit/timing files, captures
both declaration trees, writes sorted per-file SHA-256 manifests, and retains the complete
recursive diff:

```bash
bash docs/evidence/reproduce-typescript-7-comparison.sh /tmp/typescript-7-comparison-evidence
```

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


### Semantic declaration review

The nine changes not covered by formatting normalization were reviewed against their source
contracts:

- The generated API client aggregate changes string-literal delimiters in query and mutation
  key tuple types. The literal values and tuple structure are unchanged.
- The generated API Zod aggregate emits direct `zod.*` names where TypeScript 6 emits the
  equivalent `zod.z.*` namespace alias, and reorders members in structural object types.
- Seven database schema declarations change a quote delimiter and reorder members in
  structural Zod object types.

For each complete module, both the TypeScript 6 declaration namespace extends the
TypeScript 7 namespace and the TypeScript 7 namespace extends the TypeScript 6 namespace.
That bidirectional check passed when consumed by both compilers. These are intentional
emitter differences, not public contract regressions, so each file has an exact
baseline/candidate SHA-256 approval and a file-specific reason. The disposable reproduction
passes with 195 formatting-only changes, 9 approved semantic changes, and no unexplained
semantic drift.

### Results

| Check | TypeScript 6.0.3 | TypeScript 7.0.2 |
| --- | ---: | ---: |
| Forced shared-library project build | Pass, 11.82s | Pass, 2.97s |
| Scripts `--noEmit` | Pass, 3.31s | Pass, 0.69s |
| API server `--noEmit` | Pass, 8.97s | Pass, 1.63s |
| Web client `--noEmit` | Pass, 44.00s | Pass, 2.71s |
| Mockup sandbox `--noEmit` | Pass, 4.16s | Pass, 0.77s |
| AI evaluation library `--noEmit` | Pass, 0.40s | Pass, 0.10s |
| Corpus harness library `--noEmit` | Pass, 0.80s | Pass, 0.16s |
| Generated API client/Zod forced build | Pass | Pass |
| Diagnostic count in checks above | 0 | 0 |
| Declaration file count | 719 | 719 |
| Declaration files with textual differences | baseline | 204 |
| Declaration contract comparison | baseline | Pass (195 formatting-only, 9 approved semantic, 0 unexplained) |

The declaration differences break down as:

- 2 `api-client-react` generated declarations,
- 142 `api-zod` generated declarations, and
- 60 database schema declarations.

There were 2,664 removed and 2,664 added diff lines. Inspected database differences were
double-quote to single-quote changes in string literal types. Generated API declarations
also changed some quoted literal renderings to template-literal or single-quoted forms.
The two builds typechecked successfully. Formatting normalization accounts for 195 changed
files, and exact hash-pinned review accounts for the remaining 9. A production switch must
continue to block any new declaration output until it is fixed or receives the same
contract-owner review.

The original timings are representative only. The advisory release lane now captures one
cold and one warm measurement for every TypeScript 6/7 comparison check and aggregates up
to five prior successful, revision-bound CI artifacts. Promotion requires at least three
distinct revisions. The provisional process budgets are a candidate elapsed-time ratio of
at most 1.25, candidate peak-RSS ratio of at most 1.25, 60 seconds per candidate check, and
1,048,576 KiB peak RSS per candidate process tree. These thresholds are intentionally
marked unapproved: violations are reported as advisory regressions, and promotion remains
ineligible if any retained revision breaches them or until maintainers explicitly approve
the thresholds in code and documentation.

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
Classify each of the seven consumers against that API. Consumers without a stable
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
explicit compatibility evidence covering all seven consumers and an intentional update to
the boundary's version assertion.

Remove this boundary only after Microsoft publishes a stable TypeScript 7 JavaScript API
and migration guidance, every consumer has been migrated to that API, and the retention,
browser syntax, Vite import, and four AST-based safeguards pass against it.

### Stage 4 — switch the root compiler

Replace the root compiler only after:

- TypeDoc broadens its peer range to TypeScript 7 and Orval's resolved TypeDoc/plugin graph
  installs without overrides or ignored peer failures.
- All seven direct consumers have stable replacements or an explicitly maintained
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
8. The retention checker, browser-spec syntax validator, Vite config loader, and four
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
- `artifacts/api-server/package.json`
- `artifacts/run-calculator/package.json`
- `artifacts/run-calculator/tsconfig.json`
- `artifacts/run-calculator/scripts/check-vite-config-loading.mjs`
- `artifacts/run-calculator/e2e/validate-browser-spec-syntax.ts`
- the four AST-based tests listed in the direct-consumer table
- `docs/evidence/typescript-7-comparison-2026-09-15.json`
- `docs/evidence/reproduce-typescript-7-comparison.sh`

Official and package evidence:

- [Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
  — native compiler release, compatibility conditions, removed options, side-by-side
  TypeScript 6 package, API status, parallel build controls, and editor limitations.
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
