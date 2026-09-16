# TypeScript 7 Migration Research

**Assessment date:** 2026-09-16
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
   nine repository files.
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
| `scripts/src/compare-declaration-contracts.mts` | Scanner, source-file parsing, declaration AST inspection, import preprocessing | Keep on TypeScript 6 compatibility API. The declaration comparison is itself a migration safeguard, so it must not move to an unstable parser while it is the evidence source. |
| `artifacts/run-calculator/e2e/validate-browser-spec-syntax.ts` | Parse diagnostics, diagnostic flattening, filesystem read | Keep on TypeScript 6. A CLI/subprocess syntax check is a possible later isolation strategy. |
| `artifacts/run-calculator/src/freezerDomainIsolation.test.ts` | TSX parse and AST traversal | Keep test tooling on TypeScript 6 until a stable native AST API exists. |
| `artifacts/run-calculator/src/blankRunValueSync.test.ts` | Parse and evaluate AST literals | Keep test tooling on TypeScript 6 until a stable native AST API exists. |
| `artifacts/run-calculator/src/runValueStampGuard.test.ts` | TSX parse and AST traversal | Keep test tooling on TypeScript 6 until a stable native AST API exists. |
| `artifacts/run-calculator/src/applyCaseUpdateChoices.web.test.ts` | TSX parse/traversal and `transpileModule` | Keep on TypeScript 6. `transpileModule` has no stable TypeScript 7.0 root equivalent. |
| `artifacts/run-calculator/src/e2eIsolation.test.ts` | TS parsing, AST traversal, call-expression and lexical-binding inspection | Keep test tooling on TypeScript 6 until a stable native AST API exists; this guard protects browser fixture database isolation. |
| `artifacts/run-calculator/scripts/check-vite-config-loading.mjs` | `preProcessFile` for import discovery | Keep on TypeScript 6 for the pilot. The import scanner can later be replaced or isolated; it is not safe to assume the native unstable AST is compatible. |

The current direct-consumer smoke covers the retention checker, declaration-contract
comparison, browser syntax validation, Vite config loading, and all five AST-based client
test files behind the TypeScript 6 boundary.

## Official TypeScript 7 compatibility findings

The exact TypeScript 7 version assessed here is **7.0.2**, the latest stable TypeScript 7
release in Microsoft's release metadata as of 2026-09-16. Its package root exports only
version metadata; the parser, AST, scanner, visitor, and related programmatic surfaces are
under `typescript/unstable/*`. TypeScript 7.1.0 is still a beta, and Microsoft's 7.1
iteration plan lists 2026-11-10 as the planned stable release date. Therefore no stable
TypeScript 7 programmatic API version is supported yet, and the nine consumers remain on
the exact TypeScript 6.0.3 boundary below. The official compiler API wiki also warns that
its current examples describe TypeScript 6 and earlier and that TypeScript 7.1 will have a
different API.

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

The reproduction derives declaration totals and package categories in its `summary.json`,
then fails if the retained JSON or the counts below do not match. The advisory release lane
runs the same check against its freshly generated disposable declaration manifests, so
contract growth cannot leave both retained artifacts consistently stale. A secondary
retained-artifact consistency check can run without repeating the compiler comparison:

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

The advisory release lane captures one cold and one warm measurement for every TypeScript
6/7 comparison check and aggregates up to five prior successful, revision-bound CI
artifacts. Promotion requires at least three distinct revisions.


### Resource-limit approval

On 2026-09-15, maintainers reviewed three distinct schema-v3, revision-bound measurement
sets from successful GitHub Actions resource-capture jobs. All three used the supported
Linux x64 `ubuntu24@20260907.300.1` image with 4 logical CPUs and 16 GiB of memory. The
exact reports are cryptographically referenced, and their resource summaries are retained,
in [`docs/typescript-7-resource-approval-evidence.json`](typescript-7-resource-approval-evidence.json).
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
Classify each of the nine consumers against that API. Consumers without a stable
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
explicit compatibility evidence covering all nine consumers and an intentional update to
the boundary's version assertion.

Remove this boundary only after Microsoft publishes a stable TypeScript 7 JavaScript API
and migration guidance, every consumer has been migrated to that API, and the retention,
browser syntax, Vite import, and five AST-based safeguards pass against it.

### Stage 4 — switch the root compiler

Replace the root compiler only after:

- TypeDoc broadens its peer range to TypeScript 7 and Orval's resolved TypeDoc/plugin graph
  installs without overrides or ignored peer failures.
- All nine direct consumers have stable replacements or an explicitly maintained
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
- the five AST-based tests listed in the direct-consumer table
- `docs/evidence/typescript-7-comparison-2026-09-15.json`
- `docs/evidence/reproduce-typescript-7-comparison.sh`

Official and package evidence:

- [Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
  — native compiler release, compatibility conditions, removed options, side-by-side
  TypeScript 6 package, API status, parallel build controls, and editor limitations.
- [TypeScript releases](https://github.com/microsoft/TypeScript/releases)
  — 7.0.2 is the latest stable TypeScript 7 release at this reassessment.
- [TypeScript 7.1 iteration plan](https://github.com/microsoft/TypeScript/issues/63703)
  — 7.1 is still in beta, with stable release planned for 2026-11-10.
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

# Fresh revision-bound blocker audit

**Audit date:** 2026-09-16
**Assessed revision:** `7ad2e471a5fc5a9b08348f9743244696f44b68a1`
**Authoritative compiler:** TypeScript 6.0.3
**Candidate compiler:** TypeScript 7.0.2
**Decision:** **NO-GO for replacing the root compiler.** Keep TypeScript 6.0.3 authoritative, keep TypeScript 7.0.2 in its explicit native alias, and continue the advisory lane.

This section supersedes older status, count, and revision statements in this document where
they conflict with the assessed revision. It is an audit and remediation plan, not approval to
change `package.json`, `pnpm-lock.yaml`, or the editor SDK.

## Decision summary

The CLI language-checking result is encouraging but is not a promotion result:

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

The audit ran the existing isolated reproduction with output under
`/tmp/typescript-7-audit-repro-7ad2e471`. It copied the tracked source into a disposable
checkout, installed/used the candidate outside the authoritative workspace, emitted into the
disposable tree, and checked the working-tree boundary. No candidate declaration or build
metadata was written to the repository. The comparison's current report was also generated
outside the repository at `/tmp/ts7-audit-7ad2e471.json`; its final retained-summary check
correctly rejected the stale 2026-09-15 retained count.

The lower-level reproduction's current result was:

| Check | TypeScript 6.0.3 | TypeScript 7.0.2 | Audit interpretation |
| --- | --- | --- | --- |
| Root shared-library build | Pass | Pass | CLI compatibility evidence |
| Scripts, API server, run calculator, mockup, AI evaluation, corpus no-emit matrix | Pass | Pass | Full reproduction builds required library references first |
| Generated API client/Zod forced build | Pass | Pass | No generated-build blocker |
| Normalized diagnostics | Matching | Matching | No compiler-specific diagnostic drift |
| Declaration files | 719 | 719 | Includes `.d.ts`, `.d.mts`, and `.d.cts` |
| Textually changed declarations | — | 204 | 2 API client, 142 API Zod, 60 database |
| Declaration contract | — | Pass | 195 formatting-only, 9 exact-hash-approved semantic, 0 unexplained |

The separate `scripts/src/compare-typescript-7.mts` measurement report uses a narrower
declaration manifest that filters only `.d.ts`. It therefore reports 718 on each side and
fails the run-calculator no-emit pair before the prerequisite library is built. The extra
file in the full reproduction is:

```text
lib/corpus-harness/dist/verify-chunk-split.d.mts
```

The two tools must agree on the extension set and project prerequisites before any report can
be used as promotion evidence. The 2026-09-15 retained JSON remains historical evidence for
revision `4a42e35e`; it is not a current result for this audit.

### Compiler coupling inventory

The root package and lockfile currently preserve the intended isolation:

- `typescript: ~6.0.3` is authoritative.
- `typescript-native: npm:typescript@7.0.2` is a separately named candidate.
- Authoritative scripts invoke `node_modules/typescript/bin/tsc` explicitly.
- The TypeScript 6 API package resolves `typescript-api-v6: npm:typescript@6.0.3` and
  asserts both package metadata and runtime version.
- The workspace requires Node `>=24` and pnpm `>=11`; the assessed environment was Node
  24.13.0 and pnpm 11.5.2.
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

The following checks were run while preparing this audit:

- The isolated full reproduction completed successfully at the assessed revision and produced
  the declaration-contract result recorded above. Its output remains under `/tmp` and is not
  release evidence.
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
